import { NextRequest, NextResponse } from 'next/server';
import { StockService } from '@/services/StockService';
import prisma from '@/lib/prisma';

/**
 * POST /api/test/stock-race-condition
 * ADMIN ONLY - Test endpoint to verify stock race condition fix
 * 
 * Creates a test product and simulates concurrent orders
 */
/** True only for the workspace of the throw-away user that this route's own `setup` action creates. */
async function isSyntheticStockWorkspace(workspaceId: unknown): Promise<boolean> {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) return false;
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { user: { select: { email: true } } },
  });
  const email = workspace?.user?.email ?? '';
  return email.startsWith('test-stock-') && email.endsWith('@example.com');
}

export async function POST(request: NextRequest) {
  try {
    // Security (R3-C.9): only the local development server. Any other NODE_ENV (production,
    // test, staging, unset...) is refused, so this unauthenticated helper can never run in a
    // deployed environment.
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json(
        { error: 'Test endpoint only available in development' },
        { status: 403 }
      );
    }

    // The body can be read only once.
    const body = await request.json();
    const { action } = body;

    if (action === 'setup') {
      // Create test user and workspace
      const testUser = await prisma.user.create({
        data: {
          email: `test-stock-${Date.now()}@example.com`,
          name: 'Stock Tester',
          password: 'test-only-not-used-for-login',
        },
      });

      const workspace = await prisma.workspace.create({
        data: {
          name: 'Stock Race Test',
          slug: `stock-race-test-${Date.now()}`,
          country: 'US',
          userId: testUser.id,
        },
      });

      const product = await prisma.product.create({
        data: {
          workspaceId: workspace.id,
          sku: 'RACE-TEST-' + Date.now(),
          title: 'Race Condition Test',
          description: 'For testing concurrent stock reservation',
          quantity: 1,
          purchasePrice: 10,
          sellingPrice: 25,
        },
      });

      return NextResponse.json({
        success: true,
        workspaceId: workspace.id,
        productId: product.id,
        initialStock: product.quantity,
      });
    }

    if (action === 'simulate') {
      const { productId, workspaceId, attempts = 2 } = body;

      if (!(await isSyntheticStockWorkspace(workspaceId))) {
        return NextResponse.json({ error: 'Not a stock-test workspace' }, { status: 403 });
      }

      // Simulate concurrent reservation attempts
      const reservations = Array(attempts)
        .fill(null)
        .map((_, i) =>
          StockService.reserveStock(productId, workspaceId, 1).then(
            (result) => ({
              attempt: i + 1,
              ...result,
            })
          )
        );

      const results = await Promise.all(reservations);
      const successCount = results.filter((r) => r.success).length;

      // Get final stock level
      const finalProduct = await prisma.product.findUnique({
        where: { id: productId },
        select: { quantity: true },
      });

      return NextResponse.json({
        success: true,
        attempts,
        results,
        successCount,
        finalStock: finalProduct?.quantity,
        raceConditionFixed: successCount <= 1 && (finalProduct?.quantity || 0) >= 0,
      });
    }

    if (action === 'cleanup') {
      const { workspaceId } = body;

      // This helper only ever removes the synthetic workspaces its own `setup` action created.
      if (!(await isSyntheticStockWorkspace(workspaceId))) {
        return NextResponse.json({ error: 'Not a stock-test workspace' }, { status: 403 });
      }

      // Delete test data
      await prisma.product.deleteMany({
        where: { workspaceId },
      });

      await prisma.workspace.delete({
        where: { id: workspaceId },
      });

      return NextResponse.json({
        success: true,
        message: 'Test data cleaned up',
      });
    }

    return NextResponse.json(
      { error: 'Unknown action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Stock Test] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Test failed',
      },
      { status: 500 }
    );
  }
}
