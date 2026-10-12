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
    // Reject non-positive/non-integer quantities before touching the
    // database — the SQL function rejects them too (defense in depth),
    // but failing here avoids a network round-trip and gives this exact
    // message regardless of how the function behaves.
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return {
        success: false,
        message: 'Invalid quantity',
      };
    }

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
      // This prevents race conditions via row-level locking. workspaceId
      // is passed through so the function re-checks it inside the same
      // atomic UPDATE, not only in the findFirst above.
      const result = await prisma.$queryRaw<StockReservationResult[]>`
        SELECT * FROM reserve_product_stock(${productId}, ${workspaceId}, ${quantity})
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
