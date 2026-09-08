import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { loginSchema } from '@/lib/validations';
import prisma from '@/lib/prisma';
import { authConfig as baseAuthConfig } from '@/auth.config';

// Full config — Node.js runtime only (API routes, server components).
// Never import this file from middleware.ts: the Credentials provider
// pulls in bcryptjs, and the jwt callback below calls Prisma, neither of
// which can run in the Edge Runtime middleware is stuck with on Next.js
// 14. middleware.ts uses its own lightweight NextAuth(authConfig)
// instance built from src/auth.config.ts instead.
export const authConfig: NextAuthConfig = {
  ...baseAuthConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          const result = loginSchema.safeParse(credentials);

          if (!result.success) {
            return null;
          }

          // Brute-force protection now happens one layer up, in
          // src/app/api/auth/[...nextauth]/route.ts, before this handler
          // (and its Prisma/bcrypt work) ever runs — see that file for why.
          const user = await prisma.user.findUnique({
            where: { email: result.data.email },
          });

          if (!user) {
            return null;
          }

          const isPasswordValid = await bcrypt.compare(
            result.data.password,
            user.password
          );

          if (!isPasswordValid) {
            return null;
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
          };
        } catch (error) {
          console.error('Auth error:', error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    ...baseAuthConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;

        // Explicit issuance stamp (rather than relying on NextAuth's
        // implicit `iat`) so an already-issued JWT can be invalidated
        // later by comparing it against User.passwordChangedAt — see the
        // re-validation branch below.
        token.tokenIssuedAt = Date.now();

        // Populate workspaceId (most recently created workspace, same
        // convention as GET /api/workspaces + useWorkspace()) so that
        // server-side routes relying on session.user.workspaceId (e.g.
        // eBay OAuth connect) operate on the user's real workspace
        // instead of falling back to the literal string 'default'.
        const workspace = await prisma.workspace.findFirst({
          where: { userId: user.id as string },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        token.workspaceId = workspace?.id;
        return token;
      }

      // No `user` here means this is an existing session, not a fresh
      // sign-in — NextAuth just re-decoded a previously issued token.
      // Sessions are otherwise stateless (JWT strategy, no server-side
      // session store), so this is the only place a password change can
      // ever invalidate a token that's already out in a cookie. One
      // extra indexed lookup per request for existing sessions is the
      // accepted cost of being able to do that at all.
      if (!token.id) {
        return token;
      }

      const dbUser = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: { passwordChangedAt: true },
      });

      const tokenIssuedAt = typeof token.tokenIssuedAt === 'number' ? token.tokenIssuedAt : 0;

      if (dbUser?.passwordChangedAt && dbUser.passwordChangedAt.getTime() > tokenIssuedAt) {
        // Password changed after this token was issued (this also
        // catches tokens issued before this field existed, which carry
        // no tokenIssuedAt claim at all — treated as issued at time 0,
        // so any real passwordChangedAt invalidates them). Returning an
        // empty object strips token.id/email/name/workspaceId; the
        // session callback in auth.config.ts then leaves
        // session.user.id undefined, which every existing
        // `!session?.user?.id` guard in the app already treats as
        // unauthenticated — no other code needs to change.
        return {};
      }

      return token;
    },
  },
  events: {
    async signIn({ user }) {
      console.log(`[Auth] User signed in: ${user.email}`);
    },
    async signOut() {
      console.log(`[Auth] User signed out`);
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
