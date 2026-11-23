/**
 * S8 — OrdersSyncService and the financial data of synced orders (mocked Prisma and adapter: this proves the
 * sync LOGIC, not database behaviour; no network, no database).
 */
import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { orderStore, items } = vi.hoisted(() => ({ orderStore: new Map<string, any>(), items: [] as any[] }));
const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn() }));
let seq = 0;

vi.mock('@/lib/prisma', () => ({
  prisma: {
    syncLog: { create: vi.fn(async () => ({ id: 'log' })), update: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) },
    inventory: { updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(async () => ({ available: 5, reserved: 0 })) },
    orderItem: { create: vi.fn(async ({ data }: any) => { items.push(data); return data; }) },
    $transaction: transactionMock,
    $executeRaw: vi.fn(async () => undefined),
  },
}));

import { OrdersSyncService } from '@/services/marketplace/OrdersSyncService';
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService';
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter';
import { Marketplace } from '@/types/marketplace';

process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'id';
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'secret';
process.env.EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/cb';
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const mk = (o: Partial<any> = {}) => ({
  id: 'e1', externalOrderId: 'EXT-1', buyerId: 'b', buyerName: 'B', buyerEmail: 'b@x.test',
  totalPrice: 59.97, currency: 'GBP', financialIssues: [], status: 'FULFILLED', createdAt: new Date(),
  items: [{ listingId: '', title: 'Widget', quantity: 3, price: 19.99, sku: 'SKU-1' }], shippingAddress: undefined, ...o,
});

function installTx() {
  transactionMock.mockImplementation(async (cb: any) => cb({
    $executeRaw: vi.fn(async () => undefined),
    order: {
      findFirst: vi.fn(async ({ where }: any) => orderStore.get(`${where.workspaceId}:${where.externalOrderId}`) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = [...orderStore.values()].find((o) => o.id === where.id);
        Object.assign(existing, data);
        return { ...existing };
      }),
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `o-${++seq}`, ...data };
        orderStore.set(`${data.workspaceId}:${data.externalOrderId}`, created);
        return created;
      }),
    },
    product: { findUnique: vi.fn(async ({ where }: any) => ({ id: `p-${where.workspaceId_sku.sku}`, purchasePrice: 4 })) },
    listing: { findMany: vi.fn(async () => []) },
  }));
}

const run = async (ws: string, ...pages: any[][]) => {
  const spy = vi.spyOn(EbayAdapter.prototype, 'getOrders');
  for (const p of pages) spy.mockResolvedValueOnce(p);
  return new OrdersSyncService().syncOrders(ws, Marketplace.EBAY);
};

describe('OrdersSyncService — currency and financial data (S8)', () => {
  beforeEach(() => {
    orderStore.clear(); items.length = 0; seq = 0; vi.clearAllMocks(); installTx();
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('t');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['EUR', 'GBP', 'USD'])('first sync stores the order in its real currency (%s), amount and items', async (cur) => {
    const r = await run('ws-1', [mk({ currency: cur })]);
    expect(r).toEqual({ processed: 1, failed: 0 });
    const o = orderStore.get('ws-1:EXT-1');
    expect(o.currency).toBe(cur);
    expect(o.totalPrice).toBe(59.97);
    expect(o.estimatedProfit).toBe(0); // "not computed": analytics classify synced orders as profit-unknown
    expect(items[0]).toMatchObject({ quantity: 3, price: 19.99, purchasePrice: 4 });
  });

  it('absent currency is stored as NULL, never defaulted to EUR (nor to the workspace currency)', async () => {
    await run('ws-1', [mk({ currency: undefined })]);
    expect(orderStore.get('ws-1:EXT-1').currency).toBeNull();
  });

  it('an invalid currency code is stored as NULL, not copied', async () => {
    await run('ws-1', [mk({ currency: 'EURO' })]);
    expect(orderStore.get('ws-1:EXT-1').currency).toBeNull();
  });

  it('repeated sync: one order, no duplicate, currency kept, items created once', async () => {
    await run('ws-1', [mk()]);
    await run('ws-1', [mk({ status: 'SHIPPED' })]);
    expect([...orderStore.values()]).toHaveLength(1);
    const o = orderStore.get('ws-1:EXT-1');
    expect(o.currency).toBe('GBP');
    expect(o.totalPrice).toBe(59.97);
    expect(items).toHaveLength(1);
  });

  it('a recorded currency is never silently changed, and amounts are not overwritten by another currency', async () => {
    await run('ws-1', [mk()]);
    await run('ws-1', [mk({ currency: 'USD', totalPrice: 70 })]);
    const o = orderStore.get('ws-1:EXT-1');
    expect(o.currency).toBe('GBP');
    expect(o.totalPrice).toBe(59.97);
  });

  it('a NULL currency (row imported before S8) is completed when the marketplace reports one', async () => {
    await run('ws-1', [mk({ currency: undefined })]);
    expect(orderStore.get('ws-1:EXT-1').currency).toBeNull();
    await run('ws-1', [mk({ currency: 'USD' })]);
    expect(orderStore.get('ws-1:EXT-1').currency).toBe('USD');
  });

  it('an updated total on the same currency is applied and rounded exactly', async () => {
    await run('ws-1', [mk()]);
    await run('ws-1', [mk({ totalPrice: 60.005 })]);
    expect(orderStore.get('ws-1:EXT-1').totalPrice).toBe(60.01);
  });

  it.each([['invalid_total'], ['invalid_item_price'], ['invalid_quantity'], ['currency_mismatch']])(
    'external data with %s is NOT recorded and is counted as failed',
    async (issue) => {
      const r = await run('ws-1', [mk({ financialIssues: [issue] })]);
      expect(r).toEqual({ processed: 0, failed: 1 });
      expect(orderStore.size).toBe(0);
      expect(items).toHaveLength(0);
    }
  );

  it('a non-blocking issue (missing currency) does not block the import', async () => {
    const r = await run('ws-1', [mk({ currency: undefined, financialIssues: ['missing_currency'] })]);
    expect(r).toEqual({ processed: 1, failed: 0 });
  });

  it('one bad order does not stop the good ones of the same page', async () => {
    const r = await run('ws-1', [mk({ externalOrderId: 'BAD', financialIssues: ['invalid_total'] }), mk({ externalOrderId: 'OK' })]);
    expect(r).toEqual({ processed: 1, failed: 1 });
    expect([...orderStore.keys()]).toEqual(['ws-1:OK']);
  });

  it('workspace isolation: same external id in two workspaces = two independent orders, each with its own currency', async () => {
    await run('ws-A', [mk({ currency: 'GBP' })]);
    await run('ws-B', [mk({ currency: 'USD' })]);
    expect(orderStore.get('ws-A:EXT-1').workspaceId).toBe('ws-A');
    expect(orderStore.get('ws-A:EXT-1').currency).toBe('GBP');
    expect(orderStore.get('ws-B:EXT-1').currency).toBe('USD');
  });
});
