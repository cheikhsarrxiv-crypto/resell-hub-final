import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { loginSchema } from '@/lib/validations';
import prisma from '@/lib/prisma';
import { authConfig as baseAuthConfig } from '@/auth.config';
import { provisionUser } from '@/lib/auth/provisionUser';
import { isReservedAdminEmail } from '@/lib/admin';

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

          // Google OAuth chantier — a Google-only account has no
          // password at all (the column is nullable). Never call
          // bcrypt.compare against null: it would throw instead of
          // simply rejecting the attempt, and would otherwise let
          // someone probe for Google-only accounts via the error shape.
          // A Google-only account simply cannot sign in with a password
          // yet — same user-facing "invalid credentials" outcome as any
          // other failed login.
          if (!user.password) {
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
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    ...baseAuthConfig.callbacks,
    // Google OAuth chantier — runs for every provider, but only ever
    // branches on account?.provider === 'google'; the Credentials path
    // (account.provider === 'credentials') returns true immediately and
    // is otherwise completely untouched by this callback.
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'google') {
        return true;
      }

      // Google sets this on every standard OAuth consent — this is the
      // proof of mailbox ownership the whole linking decision rests on.
      // Refusing without it means no user is ever created or modified
      // from an unverified Google email.
      if (!profile?.email || profile.email_verified !== true) {
        console.error('[Auth] Google sign-in rejected — email missing or not verified by Google');
        return false;
      }

      if (isReservedAdminEmail(profile.email)) {
        console.error('[Auth] Google sign-in rejected — reserved admin email');
        return false;
      }

      const existing = await prisma.user.findUnique({
        where: { email: profile.email },
        select: { id: true },
      });

      if (existing) {
        // Link only — never touches password/workspace/subscription/
        // email on the existing row. The jwt callback below re-resolves
        // this same id by email independently, so this mutation is
        // defense-in-depth, not the only guarantee.
        user.id = existing.id;
        return true;
      }

      const { user: created } = await provisionUser({
        email: profile.email,
        name: profile.name ?? profile.email.split('@')[0],
        password: null,
        preVerifiedEmail: true,
      });
      user.id = created.id;
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        // Google OAuth chantier — the signIn callback above already
        // resolved (existing account) or created (new account) the
        // canonical User row for this Google identity. Re-reading it by
        // email here — instead of trusting that user.id mutated in
        // signIn survives into this callback unchanged — is the only
        // extra DB read on the Google path, and makes the "same
        // User.id" guarantee independent of any object-identity
        // assumption between the two callbacks.
        let resolvedUserId = user.id as string;
        if (account?.provider === 'google' && user.email) {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { id: true },
          });
          if (dbUser) {
            resolvedUserId = dbUser.id;
          }
        }

        token.id = resolvedUserId;
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
          where: { userId: resolvedUserId },
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
