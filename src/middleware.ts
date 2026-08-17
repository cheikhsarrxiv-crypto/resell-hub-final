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

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const session = await auth();

  // Public routes
  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/signup' ||
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
