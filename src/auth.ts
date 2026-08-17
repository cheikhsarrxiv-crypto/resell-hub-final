import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { loginSchema } from '@/lib/validations';
import prisma from '@/lib/prisma';

export const authConfig: NextAuthConfig = {
  // ✅ Utiliser UNIQUEMENT JWT, pas PrismaAdapter
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
    error: '/auth/error',
  },
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
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string;
        session.user.workspaceId = token.workspaceId as string | undefined;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
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
