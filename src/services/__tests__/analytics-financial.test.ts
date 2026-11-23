/**
 * S8 — AnalyticsService financial figures (mocked Prisma: proves the aggregation logic and the workspace /
 * period scoping of the queries, not database behaviour).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  orders: [] as any[],
  fulfillments: [] as any[],
  products: [] as any[],
  listings: [] as any[],
  calls: [] as Array<{ model: string; args: any }>,
}));

vi.mock('@/lib/prisma', () => {
  const rec = (model: string, impl: (args: any) => any) => vi.fn(async (args: any) => { db.calls.push({ model, args }); return impl(args); });
  return {
    prisma: {
      order: {
        // honours workspaceId and the createdAt lower bound, like the real query would
        findMany: rec('order.findMany', (a) => db.orders.filter((o) => o.workspaceId === a.where.workspaceId && (!a.where.createdAt?.gte || o.createdAt >= a.where.createdAt.gte) && (!a.where.createdAt?.lte || o.createdAt <= a.where.createdAt.lte))),
        count: rec('order.count', (a) => db.orders.filter((o) => o.workspaceId === a.where.workspaceId && (!a.where.status || o.status === a.where.status)).length),
      },
      fulfillmentOrder: {
        findMany: rec('fulfillmentOrder.findMany', (a) => db.fulfillments.filter((f) => f.workspaceId === a.where.workspaceId)),
        count: rec('fulfillmentOrder.count', () => db.fulfillments.length),
      },
      product: {
        findMany: rec('product.findMany', (a) => db.products.filter((p) => p.workspaceId === a.where.workspaceId)),
        count: rec('product.count', (a) => db.products.filter((p) => p.workspaceId === a.where.workspaceId).length),
      },
      listing: {
        findMany: rec('listing.findMany', (a) => db.listings.filter((l) => l.workspaceId === a.where.workspaceId)),
        count: rec('listing.count', (a) => db.listings.filter((l) => l.workspaceId === a.where.workspaceId).length),
      },
    },
  };
});

import { AnalyticsService } from '@/services/AnalyticsService';

const now = () => new Date();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
const order = (o: Record<string, any>) => ({
  id: `o${Math.random()}`, workspaceId: 'ws-1', currency: null, externalOrderId: null, status: 'delivered',
  totalPrice: 100, estimatedProfit: 30, marketplaceFees: 0, createdAt: daysAgo(1), listingId: null, listing: null, ...o,
});

beforeEach(() => {
  db.orders = []; db.fulfillments = []; db.products = []; db.listings = []; db.calls.length = 0;
});

describe('getDashboardMetrics — per currency', () => {
  it('EUR + GBP + USD orders are never added together; each currency has its own bucket', async () => {
    db.orders = [
      order({ currency: 'EUR', totalPrice: 100, estimatedProfit: 40 }),
      order({ currency: 'EUR', totalPrice: 50, estimatedProfit: 10 }),
      order({ currency: 'GBP', totalPrice: 80, estimatedProfit: 20 }),
      order({ currency: 'USD', totalPrice: 70, estimatedProfit: 5 }),
    ];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    expect(m.mixedCurrencies).toBe(true);
    expect(m.currency).toBe('EUR');
    expect(m.revenue).toBe(150); // not 300
    expect(m.profit).toBe(50);
    const by = Object.fromEntries(m.byCurrency!.map((b) => [b.currency, b.revenue]));
    expect(by).toEqual({ EUR: 150, GBP: 80, USD: 70 });
  });

  it('a single-currency EUR workspace of ADKSY-native orders keeps the previous figures', async () => {
    db.orders = [order({ totalPrice: 100, estimatedProfit: 30 }), order({ totalPrice: 200, estimatedProfit: 60 })];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    expect(m).toMatchObject({ revenue: 300, profit: 90, margin: 30, currency: 'EUR', mixedCurrencies: false, orders: 2 });
  });

  it('exact decimal sums: 3 x 0.1 EUR is 0.3', async () => {
    db.orders = [order({ totalPrice: 0.1, estimatedProfit: 0.1 }), order({ totalPrice: 0.1, estimatedProfit: 0.1 }), order({ totalPrice: 0.1, estimatedProfit: 0.1 })];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    expect(m.revenue).toBe(0.3);
  });

  it('synced orders have an UNKNOWN profit: not counted as profit 0, margin not diluted', async () => {
    db.orders = [
      order({ currency: 'GBP', totalPrice: 100, estimatedProfit: 25 }),
      order({ currency: 'GBP', totalPrice: 900, estimatedProfit: 0, externalOrderId: 'EXT-1' }),
    ];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    expect(m.currency).toBe('GBP');
    expect(m.revenue).toBe(1000);
    expect(m.profit).toBe(25);
    expect(m.margin).toBe(25); // 25 / 100 (the orders whose profit is known), not 25 / 1000
    expect(m.ordersWithUnknownProfit).toBe(1);
    expect(m.marginAvailable).toBe(true);
  });

  it('only synced orders: margin unavailable, never a flattering or fake 0 %', async () => {
    db.orders = [order({ currency: 'USD', totalPrice: 100, estimatedProfit: 0, externalOrderId: 'EXT-1' })];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    expect(m.marginAvailable).toBe(false);
    expect(m.ordersWithUnknownProfit).toBe(1);
  });

  it('a synced order with no recorded currency is its own UNKNOWN bucket, never merged into EUR', async () => {
    db.orders = [order({ totalPrice: 10, estimatedProfit: 3 }), order({ totalPrice: 500, externalOrderId: 'EXT-1', estimatedProfit: 0 })];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    const by = Object.fromEntries(m.byCurrency!.map((b) => [b.currency, b.revenue]));
    expect(by).toEqual({ EUR: 10, UNKNOWN: 500 });
    expect(m.revenue).toBe(10);
  });

  it('an invalid stored currency is treated as absent', async () => {
    db.orders = [order({ currency: 'EURO', externalOrderId: 'EXT-1', totalPrice: 40, estimatedProfit: 0 })];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    expect(m.byCurrency!.map((b) => b.currency)).toEqual(['UNKNOWN']);
  });

  it('cancelled orders are excluded from revenue and profit and reported apart', async () => {
    db.orders = [order({ totalPrice: 100 }), order({ status: 'cancelled', totalPrice: 999, estimatedProfit: 500 })];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    expect(m.revenue).toBe(100);
    expect(m.profit).toBe(30);
    expect(m.cancelledOrders).toBe(1);
  });

  it('fulfillment amounts follow the currency of their order', async () => {
    db.orders = [order({ currency: 'GBP', totalPrice: 100, estimatedProfit: 20 })];
    db.fulfillments = [
      { workspaceId: 'ws-1', revenue: 100, totalCost: 60, order: { currency: 'GBP', externalOrderId: null, status: 'delivered' } },
      { workspaceId: 'ws-1', revenue: 500, totalCost: 400, order: { currency: 'USD', externalOrderId: null, status: 'delivered' } },
    ];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    expect(m.fulfillmentRevenue).toBe(100); // the USD 500 is not added to GBP
    expect(m.fulfillmentCost).toBe(60);
  });

  it('period filter: orders older than the window are not counted', async () => {
    db.orders = [order({ totalPrice: 10, createdAt: daysAgo(2) }), order({ totalPrice: 1000, createdAt: daysAgo(40) })];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 7);
    expect(m.revenue).toBe(10);
    expect(m.orders).toBe(1);
  });

  it('workspace isolation: another workspace\'s orders are never read, whatever they contain', async () => {
    db.orders = [order({ totalPrice: 10 }), order({ workspaceId: 'ws-OTHER', totalPrice: 9999, currency: 'USD' })];
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    expect(m.revenue).toBe(10);
    expect(m.byCurrency!.map((b) => b.currency)).toEqual(['EUR']);
    for (const c of db.calls) expect(c.args.where.workspaceId).toBe('ws-1');
  });

  it('no order at all: zeroed EUR figures, margin unavailable', async () => {
    const m = await AnalyticsService.getDashboardMetrics('ws-1', 30);
    expect(m).toMatchObject({ revenue: 0, profit: 0, orders: 0, currency: 'EUR', mixedCurrencies: false, marginAvailable: false });
  });
});

describe('getBasicMetrics — no money, workspace scoped', () => {
  it('returns exactly the four counters and nothing financial', async () => {
    db.orders = [order({ totalPrice: 123, status: 'pending' }), order({ workspaceId: 'ws-OTHER', status: 'pending' })];
    db.products = [{ workspaceId: 'ws-1', id: 'p' }];
    const m = await AnalyticsService.getBasicMetrics('ws-1', 30);
    expect(Object.keys(m).sort()).toEqual(['activeListings', 'orders', 'pendingOrders', 'productsCount']);
    expect(m).toMatchObject({ orders: 1, pendingOrders: 1, productsCount: 1 });
    for (const c of db.calls) expect(c.args.where.workspaceId).toBe('ws-1');
  });
});

describe('getOverview — one currency per response, honest profit', () => {
  it('trend, products and marketplaces use the primary currency; other currencies are only counted', async () => {
    db.listings = [{ id: 'l1', workspaceId: 'ws-1', connection: { marketplace: { displayName: 'eBay' } } }];
    db.orders = [
      order({ currency: 'GBP', totalPrice: 60, estimatedProfit: 10, listingId: 'l1', createdAt: daysAgo(1) }),
      order({ currency: 'GBP', totalPrice: 40, estimatedProfit: 5, listingId: 'l1', createdAt: daysAgo(1) }),
      order({ currency: 'USD', totalPrice: 900, estimatedProfit: 1, listingId: 'l1' }),
    ];
    const o = await AnalyticsService.getOverview('ws-1', 30);
    expect(o.currency).toBe('GBP');
    expect(o.otherCurrencies).toEqual([{ currency: 'USD', orders: 1 }]);
    expect(o.revenueTrend.reduce((s, d) => s + d.revenue, 0)).toBe(100);
    expect(o.marketplacePerformance.eBay).toMatchObject({ listings: 1, orders: 2, revenue: 100, profit: 15 });
  });

  it('marketplace profit is null when every order of it is synced (unknown, not 0)', async () => {
    db.listings = [{ id: 'l1', workspaceId: 'ws-1', connection: { marketplace: { displayName: 'eBay' } } }];
    db.orders = [order({ currency: 'EUR', externalOrderId: 'X', estimatedProfit: 0, totalPrice: 50, listingId: 'l1' })];
    const o = await AnalyticsService.getOverview('ws-1', 30);
    expect(o.marketplacePerformance.eBay.profit).toBeNull();
    expect(o.marketplacePerformance.eBay.ordersWithUnknownProfit).toBe(1);
  });

  it('product profit: known cost -> real profit; missing cost -> null (not revenue minus 0); quantities respected', async () => {
    const paid = { currency: 'EUR', externalOrderId: null, status: 'delivered' };
    db.orders = [order({ totalPrice: 20 })];
    db.products = [
      { id: 'p1', workspaceId: 'ws-1', sku: 'A', title: 'A', fulfillmentCost: 0, orderItems: [{ price: 10, quantity: 2, purchasePrice: 4, order: paid }] },
      { id: 'p2', workspaceId: 'ws-1', sku: 'B', title: 'B', fulfillmentCost: 0, orderItems: [{ price: 10, quantity: 2, purchasePrice: null, order: paid }] },
    ];
    const o = await AnalyticsService.getOverview('ws-1', 30);
    const byId = Object.fromEntries(o.productsPerformance.map((p: any) => [p.id, p]));
    expect(byId.p1).toMatchObject({ revenue: 20, profit: 12, margin: 60, units: 2 });
    expect(byId.p2).toMatchObject({ revenue: 20, profit: null, margin: null });
  });

  it('workspace isolation on every query', async () => {
    db.orders = [order({ workspaceId: 'ws-OTHER', totalPrice: 5000 })];
    const o = await AnalyticsService.getOverview('ws-1', 30);
    expect(o.revenueTrend).toEqual([]);
    for (const c of db.calls) expect(c.args.where.workspaceId).toBe('ws-1');
  });
});
