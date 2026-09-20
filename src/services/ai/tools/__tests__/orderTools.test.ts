/**
 * Real behavioral tests for get_orders — a read-only agent tool that lists
 * a workspace's orders with real, supported filters (rolling days window,
 * status, marketplace). Grouped alongside get_order in orderTools.ts;
 * these tests cover only get_orders (the pre-existing get_order tool has
 * its own coverage in ai-tool-registry.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { orderFindManyMock, orderCountMock } = vi.hoisted(() => ({
  orderFindManyMock: vi.fn(),
  orderCountMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    order: { findMany: orderFindManyMock, count: orderCountMock },
  },
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getOrdersTool } from '@/services/ai/tools/orderTools';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    workspaceId: 'ws-1',
    customerId: 'buyer-abc-123',
    customerName: 'Alice Martin',
    customerEmail: 'alice@example.com',
    status: 'shipped',
    totalPrice: 449,
    marketplace: 'ebay',
    createdAt: new Date('2026-02-05T00:00:00Z'),
    items: [
      { productId: 'product-1', title: 'Prada Sneakers', quantity: 1, price: 449, product: { sku: 'SKU-PRADA-1' } },
    ],
    ...overrides,
  };
}

describe('get_orders tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as a read tool — auto-executable, no confirmation', () => {
    const tool = AiToolRegistry.get('get_orders');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
  });

  it('1. workspace isolation — the where clause always includes the caller workspaceId', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    await getOrdersTool.handler('ws-A', {});

    expect(orderFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'ws-A' }) }));
    expect(orderCountMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'ws-A' }) }));
  });

  it('2. no orders -> found: false, empty orders, zeroed counts', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    const result: any = await getOrdersTool.handler('ws-1', {});

    expect(result).toEqual({
      found: false,
      period: result.period,
      orders: [],
      totalOrders: 0,
      returnedOrders: 0,
    });
  });

  it('3. a single order is returned', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getOrdersTool.handler('ws-1', {});

    expect(result.found).toBe(true);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].orderId).toBe('order-1');
  });

  it('4. multiple orders are all returned', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder({ id: 'order-1' }), makeOrder({ id: 'order-2' })]);
    orderCountMock.mockResolvedValue(2);

    const result: any = await getOrdersTool.handler('ws-1', {});

    expect(result.orders).toHaveLength(2);
    expect(result.orders.map((o: any) => o.orderId)).toEqual(['order-1', 'order-2']);
  });

  it('5. orders are requested in descending date order (newest first)', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    await getOrdersTool.handler('ws-1', {});

    expect(orderFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));
  });

  it('6. default limit (20) is applied when limit is omitted', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    await getOrdersTool.handler('ws-1', {});

    expect(orderFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
  });

  it('7. a custom limit is applied, and a value above the max of 50 is rejected at validation', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    await getOrdersTool.handler('ws-1', { limit: 5 });
    expect(orderFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));

    expect(getOrdersTool.inputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(getOrdersTool.inputSchema.safeParse({ limit: 50 }).success).toBe(true);
  });

  it('8. defaults to 30 days when days is omitted (AnalyticsService default)', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    const result: any = await getOrdersTool.handler('ws-1', {});

    expect(result.period.days).toBe(30);
    const where = orderFindManyMock.mock.calls[0][0].where;
    const spanMs = where.createdAt.lte.getTime() - where.createdAt.gte.getTime();
    expect(spanMs).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -2);
  });

  it('9. a custom days value is applied as the rolling window', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    const result: any = await getOrdersTool.handler('ws-1', { days: 7 });

    expect(result.period.days).toBe(7);
  });

  it('10. the date window in the where clause matches the requested days', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    await getOrdersTool.handler('ws-1', { days: 7 });

    const where = orderFindManyMock.mock.calls[0][0].where;
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lte).toBeInstanceOf(Date);
    const spanMs = where.createdAt.lte.getTime() - where.createdAt.gte.getTime();
    expect(spanMs).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -2);
  });

  it('11. statuses is applied as an exact `in` filter when provided', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    await getOrdersTool.handler('ws-1', { statuses: ['pending'] });

    const where = orderFindManyMock.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['pending'] });
  });

  it('12. multiple statuses are all passed through together', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    await getOrdersTool.handler('ws-1', { statuses: ['pending', 'shipped'] });

    const where = orderFindManyMock.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['pending', 'shipped'] });
  });

  it('no status filter is added when statuses is absent', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    await getOrdersTool.handler('ws-1', {});

    const where = orderFindManyMock.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('status');
  });

  it('rejects an unknown/invented status value', () => {
    expect(getOrdersTool.inputSchema.safeParse({ statuses: ['refunded'] }).success).toBe(false);
  });

  it('13. marketplace filter is applied to Order.marketplace directly', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    await getOrdersTool.handler('ws-1', { marketplace: 'ebay' as any });

    const where = orderFindManyMock.mock.calls[0][0].where;
    expect(where.marketplace).toBe('ebay');
  });

  it('rejects an unknown marketplace value', () => {
    expect(getOrdersTool.inputSchema.safeParse({ marketplace: 'amazon' }).success).toBe(false);
  });

  it('14. combination of filters (days + statuses + marketplace) are all applied together', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    await getOrdersTool.handler('ws-1', { days: 14, statuses: ['delivered'], marketplace: 'etsy' as any });

    const where = orderFindManyMock.mock.calls[0][0].where;
    expect(where.workspaceId).toBe('ws-1');
    expect(where.status).toEqual({ in: ['delivered'] });
    expect(where.marketplace).toBe('etsy');
  });

  it('15. totalOrders reports the REAL total count, even beyond the returned page size', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]); // only 1 returned
    orderCountMock.mockResolvedValue(73); // but 73 really exist

    const result: any = await getOrdersTool.handler('ws-1', {});

    expect(result.totalOrders).toBe(73);
  });

  it('16. returnedOrders reflects the actual number of orders in this page', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder({ id: 'order-1' }), makeOrder({ id: 'order-2' })]);
    orderCountMock.mockResolvedValue(2);

    const result: any = await getOrdersTool.handler('ws-1', {});

    expect(result.returnedOrders).toBe(2);
  });

  it('17. found=false when no order matches', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    const result: any = await getOrdersTool.handler('ws-1', {});

    expect(result.found).toBe(false);
  });

  it('18. OrderItems are correctly mapped', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getOrdersTool.handler('ws-1', {});

    expect(result.orders[0].items).toHaveLength(1);
    expect(result.orders[0].items[0].productId).toBe('product-1');
    expect(result.orders[0].items[0].title).toBe('Prada Sneakers');
    expect(result.orders[0].items[0].quantity).toBe(1);
    expect(result.orders[0].items[0].unitPrice).toBe(449);
  });

  it('19. SKU comes from the joined Product, never invented — OrderItem has no sku column of its own', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getOrdersTool.handler('ws-1', {});

    expect(result.orders[0].items[0].sku).toBe('SKU-PRADA-1');
  });

  it('20. single query for orders+items+product (no N+1), plus one separate count aggregate', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    await getOrdersTool.handler('ws-1', {});

    expect(orderFindManyMock).toHaveBeenCalledTimes(1);
    expect(orderCountMock).toHaveBeenCalledTimes(1);
    expect(orderFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ include: { items: { include: { product: { select: { sku: true } } } } } })
    );
  });

  it('21. no profit/margin/fees/refund/tracking data, and no secret ever appears in the output', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getOrdersTool.handler('ws-1', {});
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/profit|margin|estimatedProfit|marketplaceFees|refund|tracking|pickup|shippingService/i);
    expect(serialized).not.toMatch(/apiKey|apiSecret|token|secret|password/i);
  });

  it('registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('get_orders')).toBe(getOrdersTool);
  });

  it('classified "read"', () => {
    expect(getOrdersTool.category).toBe('read');
  });

  it('auto-executable without confirmation', () => {
    expect(AiToolRegistry.isAutoExecutable(getOrdersTool.category)).toBe(true);
  });
});
