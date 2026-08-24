import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Protected API routes that need ownership verification
const protectedApiRoutes = [
  '/api/products',
  '/api/orders',
  '/api/fulfillment',
  '/api/analytics',
  '/api/listings',
  '/api/marketplaces',
];

// Routes an authenticated-but-unverified user must still be able to reach
// (the verify page and /api/email/verify are fully public above, since the
// emailed link may be opened before any login).
const emailVerificationExemptRoutes = ['/api/email/resend-verification'];

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

  // Require a verified email for everything else. A fresh DB read (not a
  // value cached in the JWT) so verifying from another tab/device takes
  // effect on the very next request instead of waiting for a new login.
  if (!emailVerificationExemptRoutes.includes(pathname)) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { emailVerified: true },
    });

    if (!user?.emailVerified) {
      if (pathname.startsWith('/api')) {
        return NextResponse.json(
          { error: 'Email verification required' },
          { status: 403 }
        );
      }
      return NextResponse.redirect(new URL('/verify-email', request.url));
    }
  }

  // API routes: Verify workspace ownership
  if (pathname.startsWith('/api')) {
    const workspaceId = request.nextUrl.searchParams.get('workspaceId');

    // Check if workspace ownership is needed
    const needsOwnershipCheck = protectedApiRoutes.some(route =>
      pathname.startsWith(route)
    );

    if (needsOwnershipCheck && workspaceId) {
      try {
        // Verify user owns this workspace
        const workspace = await prisma.workspace.findFirst({
          where: {
            id: workspaceId,
            userId: session.user.id,
          },
        });

        if (!workspace) {
          return NextResponse.json(
            { error: 'Workspace not found or access denied' },
            { status: 403 }
          );
        }
      } catch (error) {
        console.error('Middleware error:', error);
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and next internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
