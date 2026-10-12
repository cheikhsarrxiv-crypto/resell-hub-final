/**
 * Stock-reservation hardening — unit tests for StockService.reserveStock
 * against a mocked prisma (no real database). These validate the
 * TypeScript-side contract only: quantity validation, the not-found/
 * access-denied path, the exact arguments sent to reserve_product_stock,
 * and how an empty result or a thrown error are translated into
 * StockReservationResult. They do NOT exercise the real PostgreSQL
 * function body (atomicity, concurrency, the CHECK constraint) — see
 * stock-service.postgres.test.ts for that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findFirstMock, queryRawMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    product: {
      findFirst: findFirstMock,
    },
    $queryRaw: queryRawMock,
  },
}));

import { StockService } from '@/services/StockService';

beforeEach(() => {
  findFirstMock.mockReset();
  queryRawMock.mockReset();
});

describe('StockService.reserveStock — quantity validation', () => {
  it.each([0, -1, -5])('rejects non-positive quantity %i without any DB call', async (qty) => {
    const result = await StockService.reserveStock('prod-1', 'ws-1', qty);
    expect(result).toEqual({ success: false, message: 'Invalid quantity' });
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it('rejects a non-integer quantity', async () => {
    const result = await StockService.reserveStock('prod-1', 'ws-1', 1.5);
    expect(result).toEqual({ success: false, message: 'Invalid quantity' });
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('rejects NaN', async () => {
    const result = await StockService.reserveStock('prod-1', 'ws-1', NaN);
    expect(result).toEqual({ success: false, message: 'Invalid quantity' });
  });

  it('defaults to quantity 1 when omitted, and accepts it', async () => {
    findFirstMock.mockResolvedValue({ id: 'prod-1', quantity: 5, title: 'Widget' });
    queryRawMock.mockResolvedValue([{ success: true, message: 'Stock reserved', newQuantity: 4 }]);

    const result = await StockService.reserveStock('prod-1', 'ws-1');

    expect(result).toEqual({ success: true, message: 'Stock reserved', newQuantity: 4 });
  });
});

describe('StockService.reserveStock — product/workspace lookup', () => {
  it('fails cleanly when the product does not exist or belongs to another workspace', async () => {
    findFirstMock.mockResolvedValue(null);

    const result = await StockService.reserveStock('prod-missing', 'ws-1', 1);

    expect(result).toEqual({ success: false, message: 'Product not found or access denied' });
    expect(queryRawMock).not.toHaveBeenCalled();
  });
});

describe('StockService.reserveStock — SQL call shape', () => {
  it('passes productId, workspaceId and quantity to reserve_product_stock, in that order', async () => {
    findFirstMock.mockResolvedValue({ id: 'prod-1', quantity: 5, title: 'Widget' });
    queryRawMock.mockResolvedValue([{ success: true, message: 'Stock reserved', newQuantity: 3 }]);

    const result = await StockService.reserveStock('prod-1', 'ws-1', 2);

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const [, ...values] = queryRawMock.mock.calls[0];
    expect(values).toEqual(['prod-1', 'ws-1', 2]);
    expect(result).toEqual({ success: true, message: 'Stock reserved', newQuantity: 3 });
  });

  it('reports failure when the function returns no row (insufficient stock, wrong workspace, or lost race)', async () => {
    findFirstMock.mockResolvedValue({ id: 'prod-1', quantity: 1, title: 'Widget' });
    queryRawMock.mockResolvedValue([]);

    const result = await StockService.reserveStock('prod-1', 'ws-1', 5);

    expect(result).toEqual({ success: false, message: 'Failed to reserve stock' });
  });

  it('catches a thrown error from the database call and surfaces its message', async () => {
    findFirstMock.mockResolvedValue({ id: 'prod-1', quantity: 5, title: 'Widget' });
    queryRawMock.mockRejectedValue(new Error('connection lost'));

    const result = await StockService.reserveStock('prod-1', 'ws-1', 1);

    expect(result).toEqual({ success: false, message: 'connection lost' });
  });
});
