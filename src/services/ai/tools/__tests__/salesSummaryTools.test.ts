/**
 * Real behavioral tests for get_sales_summary — a read-only agent tool.
 * Deliberately scoped by audit: no profit/margin/fees data (unreliable for
 * real synced orders, see AnalyticsService audit), grouping strictly on
 * the flat Order.marketplace column (never the listing.connection path,
 * which silently drops orders with an unresolved listingId), and a
 * `statuses` filter that never decides on its own to exclude
 * cancelled/failed orders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { orderFindManyMock } = vi.hoisted(() => ({
  orderFindManyMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    order: { findMany: orderFindManyMock },
  },
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getSalesSummaryTool } from '@/services/ai/tools/salesSummaryTools';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    totalPrice: 100,
    marketplace: 'ebay',
    items: [{ quantity: 1 }],
    ...overrides,
  };
}

describe('get_sales_summary tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as a read tool — auto-executable, no confirmation', () => {
    const tool = AiToolRegistry.get('get_sales_summary');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
  });

  it('accepts an empty input', () => {
    expect(getSalesSummaryTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it('1. ordersCount reflects the number of matching orders', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder(), makeOrder(), makeOrder()]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});

    expect(result.metrics.ordersCount).toBe(3);
  });

  it('2. grossRevenue sums Order.totalPrice across matching orders', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder({ totalPrice: 100 }), makeOrder({ totalPrice: 250.5 })]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});

    expect(result.metrics.grossRevenue).toBe(350.5);
  });

  it('3. itemsSold sums OrderItem.quantity across all items of all matching orders', async () => {
    orderFindManyMock.mockResolvedValue([
      makeOrder({ items: [{ quantity: 2 }, { quantity: 3 }] }),
      makeOrder({ items: [{ quantity: 1 }] }),
    ]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});

    expect(result.metrics.itemsSold).toBe(6);
  });

  it('4. averageOrderValue = grossRevenue / ordersCount', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder({ totalPrice: 100 }), makeOrder({ totalPrice: 300 })]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});

    expect(result.metrics.averageOrderValue).toBe(200);
  });

  it('5. averageOrderValue is 0 when there are no orders (no division by zero)', async () => {
    orderFindManyMock.mockResolvedValue([]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});

    expect(result.metrics.averageOrderValue).toBe(0);
    expect(result.found).toBe(false);
  });

  it('6. days filter is applied as a rolling window in the Prisma where clause', async () => {
    orderFindManyMock.mockResolvedValue([]);

    await getSalesSummaryTool.handler('ws-1', { days: 7 });

    const where = orderFindManyMock.mock.calls[0][0].where;
    expect(where.workspaceId).toBe('ws-1');
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lte).toBeInstanceOf(Date);
    const spanMs = where.createdAt.lte.getTime() - where.createdAt.gte.getTime();
    expect(spanMs).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -2);
  });

  it('7. defaults to 30 days when days is omitted (AnalyticsService default, verified by audit)', async () => {
    orderFindManyMock.mockResolvedValue([]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});

    expect(result.period.days).toBe(30);
    const where = orderFindManyMock.mock.calls[0][0].where;
    const spanMs = where.createdAt.lte.getTime() - where.createdAt.gte.getTime();
    expect(spanMs).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -2);
  });

  it('8. no status filter is added when statuses is absent', async () => {
    orderFindManyMock.mockResolvedValue([]);

    await getSalesSummaryTool.handler('ws-1', {});

    const where = orderFindManyMock.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('status');
  });

  it('9. statuses is applied as an exact `in` filter when provided', async () => {
    orderFindManyMock.mockResolvedValue([]);

    await getSalesSummaryTool.handler('ws-1', { statuses: ['delivered'] });

    const where = orderFindManyMock.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['delivered'] });
  });

  it('10. multiple statuses are all passed through together', async () => {
    orderFindManyMock.mockResolvedValue([]);

    await getSalesSummaryTool.handler('ws-1', { statuses: ['delivered', 'cancelled', 'failed'] });

    const where = orderFindManyMock.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['delivered', 'cancelled', 'failed'] });
  });

  it('rejects an unknown/invented status value', () => {
    const result = getSalesSummaryTool.inputSchema.safeParse({ statuses: ['refunded'] });
    expect(result.success).toBe(false);
  });

  it('11. byMarketplace groups orders by marketplace', async () => {
    orderFindManyMock.mockResolvedValue([
      makeOrder({ marketplace: 'ebay' }),
      makeOrder({ marketplace: 'etsy' }),
      makeOrder({ marketplace: 'ebay' }),
    ]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});

    const marketplaces = result.byMarketplace.map((m: any) => m.marketplace).sort();
    expect(marketplaces).toEqual(['ebay', 'etsy']);
    const ebay = result.byMarketplace.find((m: any) => m.marketplace === 'ebay');
    expect(ebay.ordersCount).toBe(2);
  });

  it('12. marketplace grouping uses Order.marketplace, never a listing/connection path', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder({ marketplace: 'etsy' })]);

    await getSalesSummaryTool.handler('ws-1', {});

    // The select must request Order.marketplace directly and never join
    // listing/connection/marketplace at all for this tool.
    const args = orderFindManyMock.mock.calls[0][0];
    expect(args.select).toHaveProperty('marketplace', true);
    expect(args).not.toHaveProperty('include');
    expect(JSON.stringify(args)).not.toMatch(/connection|listing/i);
  });

  it("13. an order with marketplace set is grouped correctly even when listingId is null (never dropped)", async () => {
    // listingId is not selected/read by this tool at all — a synced order
    // with an unresolved listingId still carries a real Order.marketplace
    // value and must still be counted.
    orderFindManyMock.mockResolvedValue([makeOrder({ marketplace: 'ebay', listingId: null })]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});

    expect(result.metrics.ordersCount).toBe(1);
    expect(result.byMarketplace).toEqual([{ marketplace: 'ebay', ordersCount: 1, grossRevenue: 100, itemsSold: 1 }]);
  });

  it('14. workspace isolation — the where clause always includes the caller workspaceId', async () => {
    orderFindManyMock.mockResolvedValue([]);

    await getSalesSummaryTool.handler('ws-A', {});

    expect(orderFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'ws-A' }) }));
  });

  it('15. the same marketplace name in two different workspace calls never mixes results (separate calls, separate where.workspaceId)', async () => {
    orderFindManyMock.mockImplementation(async ({ where }: any) =>
      where.workspaceId === 'ws-A' ? [makeOrder({ marketplace: 'ebay', totalPrice: 500 })] : [makeOrder({ marketplace: 'ebay', totalPrice: 10 })]
    );

    const resultA: any = await getSalesSummaryTool.handler('ws-A', {});
    const resultB: any = await getSalesSummaryTool.handler('ws-B', {});

    expect(resultA.metrics.grossRevenue).toBe(500);
    expect(resultB.metrics.grossRevenue).toBe(10);
  });

  it('16. no orders in the period -> found: false with zeroed metrics and empty byMarketplace', async () => {
    orderFindManyMock.mockResolvedValue([]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});

    expect(result).toEqual({
      found: false,
      period: result.period,
      metrics: { ordersCount: 0, grossRevenue: 0, itemsSold: 0, averageOrderValue: 0 },
      byMarketplace: [],
    });
  });

  it('17. never returns profit/margin/fees/refunds/returns data', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/profit|margin|estimatedProfit|marketplaceFees|refund|return/i);
  });

  it('18. no secret/technical noise ever appears in the output', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);

    const result: any = await getSalesSummaryTool.handler('ws-1', {});
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/apiKey|apiSecret|token|secret|password/i);
  });

  it('19. registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('get_sales_summary')).toBe(getSalesSummaryTool);
  });

  it('20. classified "read"', () => {
    expect(getSalesSummaryTool.category).toBe('read');
  });

  it('21. auto-executable without confirmation', () => {
    expect(AiToolRegistry.isAutoExecutable(getSalesSummaryTool.category)).toBe(true);
  });
});
