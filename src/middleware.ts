import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authConfig } from '@/auth.config';

// A separate, Edge-safe NextAuth instance — NOT the one exported from
// src/auth.ts. That file imports the Credentials provider (bcryptjs,
// Node-only APIs) and its jwt callback calls Prisma; both crash the Edge
// Runtime middleware is required to run in on Next.js 14
// (MIDDLEWARE_INVOCATION_FAILED). This instance only decodes/reads the
// already-issued JWT session cookie — no bcrypt, no Prisma.
const { auth } = NextAuth(authConfig);

// Routes an authenticated-but-unverified user must still be able to reach
// (the verify page and /api/email/verify are fully public above, since the
// emailed link may be opened before any login).
// NOTE: email-verification and workspace-ownership enforcement used to
// live here too, via direct Prisma calls — removed for the same Edge
// Runtime reason. They now live server-side (Node.js runtime, where
// Prisma actually works): workspace ownership was already independently
// re-checked in every protected API route via
// getVerifiedWorkspaceId/verifyWorkspaceAccess (src/lib/security.ts), so
// removing it here is not a regression. Email verification is now
// enforced in src/lib/security.ts's requireAuth()/verifyWorkspaceAccess()
// for API routes, and in src/app/dashboard/layout.tsx for pages.

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const session = await auth();

  // Public routes — reachable with no session at all. /verify-email and
  // /api/email/verify must be here (not just exempt below): the emailed
  // link can be opened before the user ever logs in.
  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/verify-email' ||
    pathname === '/api/email/verify' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/_next')
  ) {
    // Redirect authenticated users away from login
    if (session?.user?.id && (pathname === '/login' || pathname === '/signup')) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  // Protected routes - require authentication
  if (!session?.user?.id) {
    // API endpoints: return 401
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Pages: redirect to login
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and next internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
