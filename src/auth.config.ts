import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-Runtime-safe base config — used by BOTH the full server-side
 * config (src/auth.ts) and the lightweight instance middleware.ts uses.
 *
 * Deliberately contains NO providers and NO Prisma calls: middleware.ts
 * runs in the Edge Runtime (Next.js 14 gives middleware no other choice —
 * there is no Node.js middleware runtime option before Next.js 15.2), and
 * neither bcryptjs (Node-only APIs: process.nextTick, setImmediate) nor
 * @prisma/client (native engine binary) can run there. Importing src/auth.ts
 * directly from middleware.ts — which it used to do — pulled the
 * Credentials provider's `import bcrypt from 'bcryptjs'` into the Edge
 * bundle. That produced only a build-time warning while NEXTAUTH_SECRET
 * was unset (NextAuth's assertConfig bailed out before exercising that
 * code path); once the secret was set, NextAuth actually initializes the
 * provider graph on every request, and bcryptjs's Node APIs don't exist
 * in the Edge sandbox — hence MIDDLEWARE_INVOCATION_FAILED.
 *
 * The `jwt` callback (which does a Prisma workspace lookup, but only
 * when `user` is present — i.e. only right after a real sign-in) is
 * intentionally NOT here; it lives only in src/auth.ts, which is never
 * loaded by middleware. When middleware reads an existing session, the
 * default (no-op) jwt callback just passes the already-encoded token
 * through unchanged, and the session callback below shapes it from that
 * token — no DB access needed.
 */
export const authConfig: NextAuthConfig = {
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
    error: '/auth/error',
  },
  providers: [],
  callbacks: {
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
};
