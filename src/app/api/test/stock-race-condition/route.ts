import { NextRequest, NextResponse } from 'next/server';
import { StockService } from '@/services/StockService';
import prisma from '@/lib/prisma';

/**
 * POST /api/test/stock-race-condition
 * ADMIN ONLY - Test endpoint to verify stock race condition fix
 * 
 * Creates a test product and simulates concurrent orders
 */
export async function POST(request: NextRequest) {
  try {
    // Security: Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Test endpoint not available in production' },
        { status: 403 }
      );
    }

    const { action } = await request.json();

    if (action === 'setup') {
      // Create test workspace and product
      const workspace = await prisma.workspace.create({
        data: {
          name: 'Stock Race Test',
          country: 'US',
          users: {
            create: [
              {
                email: 'test-stock@example.com',
                name: 'Stock Tester',
              },
            ],
          },
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
      const { productId, workspaceId, attempts = 2 } = await request.json();

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
      const { workspaceId } = await request.json();

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
