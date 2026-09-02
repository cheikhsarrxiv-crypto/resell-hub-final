import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { loginSchema } from '@/lib/validations';
import prisma from '@/lib/prisma';
import { rateLimiter } from '@/lib/ratelimit';
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

          // Brute-force protection: signup already rate-limits by IP, but
          // login had no limit at all — an attacker could try unlimited
          // passwords against one email. Same generic failure (null) as
          // every other rejection path below, so this never reveals
          // whether the limit or the password was the actual reason.
          const rateLimitResult = await rateLimiter.checkLogin(result.data.email);
          if (!rateLimitResult.success) {
            return null;
          }

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
