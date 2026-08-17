import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

/**
 * CRITICAL: Verify that the user owns the workspace
 * Call this in EVERY API route that accesses workspace data
 */
export async function verifyWorkspaceAccess(workspaceId: string): Promise<string> {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    // Verify ownership
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        userId: session.user.id, // ✅ CRITICAL: Check user owns workspace
      },
    });

    if (!workspace) {
      throw new Error('Workspace not found or unauthorized');
    }

    return workspace.id;
  } catch (error) {
    throw error;
  }
}

/**
 * Get workspace ID from request and verify access
 */
export async function getVerifiedWorkspaceId(request: NextRequest): Promise<string> {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');

  if (!workspaceId) {
    throw new Error('Workspace ID required');
  }

  return verifyWorkspaceAccess(workspaceId);
}

/**
 * Error response helper
 */
export function errorResponse(error: unknown, statusCode: number = 500): NextResponse {
  const message = error instanceof Error ? error.message : 'Internal server error';

  if (message === 'Unauthorized' || message.includes('unauthorized')) {
    return NextResponse.json({ error: message }, { status: 401 });
  }

  if (message.includes('not found')) {
    return NextResponse.json({ error: message }, { status: 404 });
  }

  if (message.includes('required')) {
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ error: message }, { status: statusCode });
}

/**
 * Verify user is authenticated
 */
export async function requireAuth() {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  return session.user.id;
}

/**
 * Verify workspace access and product ownership
 */
export async function verifyProductAccess(
  productId: string,
  workspaceId: string
): Promise<any> {
  // First verify workspace access
  const verifiedWorkspaceId = await verifyWorkspaceAccess(workspaceId);

  // Then verify product belongs to workspace with images and listings
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      workspaceId: verifiedWorkspaceId,
      deletedAt: null,
    },
    include: {
      images: {
        orderBy: { order: 'asc' },
      },
      listings: {
        where: { deletedAt: null },
        include: { connection: { include: { marketplace: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!product) {
    throw new Error('Product not found');
  }

  return product;
}

/**
 * Verify workspace access and order ownership
 */
export async function verifyOrderAccess(
  orderId: string,
  workspaceId: string
): Promise<any> {
  // First verify workspace access
  const verifiedWorkspaceId = await verifyWorkspaceAccess(workspaceId);

  // Then verify order belongs to workspace
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      workspaceId: verifiedWorkspaceId,
    },
  });

  if (!order) {
    throw new Error('Order not found');
  }

  return order;
}

/**
 * Verify workspace access and listing ownership
 */
export async function verifyListingAccess(
  listingId: string,
  workspaceId: string
): Promise<any> {
  // First verify workspace access
  const verifiedWorkspaceId = await verifyWorkspaceAccess(workspaceId);

  // Then verify listing belongs to workspace
  const listing = await prisma.listing.findFirst({
    where: {
      id: listingId,
      workspaceId: verifiedWorkspaceId,
      deletedAt: null,
    },
  });

  if (!listing) {
    throw new Error('Listing not found');
  }

  return listing;
}

/**
 * Check if user has plan feature
 */
export async function verifyPlanFeature(
  workspaceId: string,
  feature: 'fulfillmentEnabled' | 'advancedAnalytics' | 'apiAccess'
): Promise<boolean> {
  const workspace = await verifyWorkspaceAccess(workspaceId);

  const subscription = await prisma.subscription.findUnique({
    where: { id: (workspace as any).subscriptionId || '' },
    include: { plan: true },
  });

  if (!subscription?.plan) {
    return false;
  }

  return subscription.plan[feature] || false;
}
