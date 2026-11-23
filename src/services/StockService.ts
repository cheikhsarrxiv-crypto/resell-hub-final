import prisma from '@/lib/prisma';

/**
 * Result of stock reservation attempt
 */
export interface StockReservationResult {
  success: boolean;
  message: string;
  newQuantity?: number;
}

/**
 * Stock Service - Atomic operations
 * Uses PostgreSQL transactions and functions to prevent race conditions
 *
 * C1 NOTE (accuracy only - no behaviour changed): `reserveStock` below calls a SQL function
 * `reserve_product_stock(productId, quantity)` that NO migration in prisma/migrations creates
 * (a database built from the 18 committed migrations has no such function), and no tracked
 * commit ever contained the "stock_race_fix" migration that older documents mention. On such a
 * database `reserveStock` therefore catches the "function does not exist" error and returns
 * { success: false }. Its only caller is the development-only test route
 * /api/test/stock-race-condition. Real sales do NOT use this class: they go through
 * ProductService.reserveInventory (one conditional UPDATE on Inventory.available, which is the
 * source of truth for stock). `releaseStock` / `getStockLevel` / `isStockAvailable` act on
 * Product.quantity, which is NOT the live stock figure. Whether a real database has the function
 * is unverified from this repository. Keep, rewrite or delete this class only through a
 * deliberate, separately authorised decision.
 */
export class StockService {
  /**
   * Reserve stock atomically
   * Uses PostgreSQL function to lock row and update atomically
   * 
   * ATOMIC: This call is guaranteed to succeed or fail without race conditions
   */
  static async reserveStock(
    productId: string,
    workspaceId: string,
    quantity: number = 1
  ): Promise<StockReservationResult> {
    try {
      // First verify product belongs to workspace (security check)
      const product = await prisma.product.findFirst({
        where: {
          id: productId,
          workspaceId,
          deletedAt: null,
        },
        select: { id: true, quantity: true, title: true },
      });

      if (!product) {
        return {
          success: false,
          message: 'Product not found or access denied',
        };
      }

      // Call PostgreSQL function for atomic stock reservation
      // This prevents race conditions via row-level locking
      const result = await prisma.$queryRaw<StockReservationResult[]>`
        SELECT * FROM reserve_product_stock(${productId}, ${quantity})
      `;

      if (!result || result.length === 0) {
        return {
          success: false,
          message: 'Failed to reserve stock',
        };
      }

      const reservation = result[0];
      return {
        success: reservation.success,
        message: reservation.message,
        newQuantity: reservation.newQuantity,
      };
    } catch (error) {
      console.error('[StockService] Reservation error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Stock reservation failed',
      };
    }
  }

  /**
   * Release reserved stock (undo reservation)
   * For cancelled orders or failed fulfillment
   */
  static async releaseStock(
    productId: string,
    workspaceId: string,
    quantity: number = 1
  ): Promise<StockReservationResult> {
    try {
      // Verify product belongs to workspace
      const product = await prisma.product.findFirst({
        where: {
          id: productId,
          workspaceId,
          deletedAt: null,
        },
      });

      if (!product) {
        return {
          success: false,
          message: 'Product not found',
        };
      }

      // Simply increment quantity back
      const updated = await prisma.product.update({
        where: { id: productId },
        data: {
          quantity: { increment: quantity },
        },
      });

      return {
        success: true,
        message: 'Stock released successfully',
        newQuantity: updated.quantity,
      };
    } catch (error) {
      console.error('[StockService] Release error:', error);
      return {
        success: false,
        message: 'Failed to release stock',
      };
    }
  }

  /**
   * Get current stock level
   */
  static async getStockLevel(productId: string): Promise<number> {
    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { quantity: true },
      });
      return product?.quantity || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check if stock is available without reserving
   */
  static async isStockAvailable(
    productId: string,
    quantity: number = 1
  ): Promise<boolean> {
    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { quantity: true },
      });
      return (product?.quantity || 0) >= quantity;
    } catch {
      return false;
    }
  }

  /**
   * Set stock level directly (admin only)
   */
  static async setStockLevel(
    productId: string,
    newQuantity: number
  ): Promise<StockReservationResult> {
    try {
      if (newQuantity < 0) {
        return {
          success: false,
          message: 'Stock quantity cannot be negative',
        };
      }

      await prisma.product.update({
        where: { id: productId },
        data: { quantity: newQuantity },
      });

      return {
        success: true,
        message: 'Stock level updated',
        newQuantity,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to set stock level',
      };
    }
  }
}
