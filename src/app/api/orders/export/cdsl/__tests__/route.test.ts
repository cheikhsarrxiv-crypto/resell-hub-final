/**
 * Route-level tests for /api/orders/export/cdsl — authorization/workspace
 * scoping, validation-error responses (no file on failure), and a
 * successful CSV generation response. @/auth and @/lib/prisma are fully
 * mocked (in-memory stores), the same pattern already used by
 * FulfillmentService-sendToFulfillment-provider-wiring.test.ts, so these
 * tests need no real database/session — unlike product-access-inventory.test.ts's
 * real-Postgres pattern, which this sandboxed environment has no
 * DATABASE_URL for anyway.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { userStore, workspaceStore, orderStore } = vi.hoisted(() => ({
  userStore: new Map<string, any>(),
  workspaceStore: new Map<string, any>(),
  orderStore: new Map<string, any>(),
}));

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mockAuth }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: any) => userStore.get(where.id) ?? null),
    },
    workspace: {
      findFirst: vi.fn(async ({ where }: any) => {
        const ws = workspaceStore.get(where.id);
        if (!ws || ws.userId !== where.userId) return null;
        return { ...ws };
      }),
    },
    order: {
      findMany: vi.fn(async ({ where }: any) => {
        let rows = [...orderStore.values()].filter((o) => o.workspaceId === where.workspaceId);
        if (where.id?.in) {
          const idSet = new Set(where.id.in as string[]);
          rows = rows.filter((o) => idSet.has(o.id));
        }
        if (where.status?.notIn) {
          const excluded = new Set(where.status.notIn as string[]);
          rows = rows.filter((o) => !excluded.has(o.status));
        }
        if ('fulfillmentOrder' in where && where.fulfillmentOrder === null) {
          rows = rows.filter((o) => !o.fulfillmentOrder);
        }
        return rows.map((o) => ({ ...o, items: o.items.map((i: any) => ({ ...i })) }));
      }),
    },
  },
}));

import { GET, POST } from '../route';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    workspaceId: 'ws-1',
    status: 'pending',
    fulfillmentOrder: null,
    customerName: 'Dupont Arthur',
    customerEmail: 'arthur@example.com',
    shippingAddress: '9 Impasse des Rosiers',
    shippingAddress2: null,
    shippingCity: 'Evreux',
    shippingPostalCode: '27600',
    shippingCountry: 'FR',
    shippingPhone: '0637675658',
    createdAt: new Date('2026-10-08T10:00:00.000Z'),
    items: [
      {
        productId: 'prod-1',
        title: 'Serum',
        quantity: 1,
        product: { sku: 'SERUM' },
      },
    ],
    ...overrides,
  };
}

function makeGetRequest(workspaceId: string | null) {
  const url = workspaceId
    ? `https://adksy.test/api/orders/export/cdsl?workspaceId=${workspaceId}`
    : 'https://adksy.test/api/orders/export/cdsl';
  return new NextRequest(url);
}

function makePostRequest(body: unknown) {
  return new NextRequest('https://adksy.test/api/orders/export/cdsl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/orders/export/cdsl', () => {
  beforeEach(() => {
    userStore.clear();
    workspaceStore.clear();
    orderStore.clear();
    vi.clearAllMocks();

    userStore.set('user-1', { emailVerified: new Date() });
    workspaceStore.set('ws-1', { id: 'ws-1', userId: 'user-1' });
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
  });

  describe('GET — authorization', () => {
    it('rejects an unauthenticated request', async () => {
      mockAuth.mockResolvedValue(null);
      const response = await GET(makeGetRequest('ws-1'));
      expect(response.status).toBe(401);
    });

    it('rejects a workspace the caller does not own', async () => {
      // verifyWorkspaceAccess's own error message ("...or unauthorized")
      // matches errorResponse()'s 401 branch before its 404 branch — same
      // behavior as every other route built on this shared helper.
      workspaceStore.set('ws-2', { id: 'ws-2', userId: 'someone-else' });
      const response = await GET(makeGetRequest('ws-2'));
      expect(response.status).toBe(401);
    });

    it('rejects a request with no workspaceId', async () => {
      const response = await GET(makeGetRequest(null));
      expect(response.status).toBe(400);
    });
  });

  describe('GET — listing and per-order validation', () => {
    it('lists an order from the caller\'s own workspace with no validation errors', async () => {
      orderStore.set('order-1', makeOrder());
      const response = await GET(makeGetRequest('ws-1'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.orders).toHaveLength(1);
      expect(data.orders[0].id).toBe('order-1');
      expect(data.orders[0].cdslValidationErrors).toEqual([]);
    });

    it('never lists an order belonging to another workspace', async () => {
      orderStore.set('order-1', makeOrder());
      orderStore.set('order-2', makeOrder({ id: 'order-2', workspaceId: 'ws-2' }));

      const response = await GET(makeGetRequest('ws-1'));
      const data = await response.json();

      expect(data.orders.map((o: any) => o.id)).toEqual(['order-1']);
    });

    it('excludes a cancelled order', async () => {
      orderStore.set('order-1', makeOrder({ status: 'cancelled' }));
      const response = await GET(makeGetRequest('ws-1'));
      const data = await response.json();
      expect(data.orders).toHaveLength(0);
    });

    it('excludes an order already dispatched to a FulfillmentOrder', async () => {
      orderStore.set('order-1', makeOrder({ fulfillmentOrder: { id: 'fo-1' } }));
      const response = await GET(makeGetRequest('ws-1'));
      const data = await response.json();
      expect(data.orders).toHaveLength(0);
    });

    it('surfaces validation errors for an invalid order instead of hiding it', async () => {
      orderStore.set('order-1', makeOrder({ customerName: '' }));
      const response = await GET(makeGetRequest('ws-1'));
      const data = await response.json();
      expect(data.orders).toHaveLength(1);
      expect(data.orders[0].cdslValidationErrors.length).toBeGreaterThan(0);
    });
  });

  describe('POST — authorization', () => {
    it('rejects an unauthenticated request', async () => {
      mockAuth.mockResolvedValue(null);
      const response = await POST(makePostRequest({ workspaceId: 'ws-1', orderIds: ['order-1'] }));
      expect(response.status).toBe(401);
    });

    it('rejects a request with no workspaceId', async () => {
      const response = await POST(makePostRequest({ orderIds: ['order-1'] }));
      expect(response.status).toBe(400);
    });

    it('rejects an empty orderIds array', async () => {
      const response = await POST(makePostRequest({ workspaceId: 'ws-1', orderIds: [] }));
      expect(response.status).toBe(400);
    });

    it('returns 404 for an orderId not found in the caller\'s workspace', async () => {
      const response = await POST(makePostRequest({ workspaceId: 'ws-1', orderIds: ['does-not-exist'] }));
      expect(response.status).toBe(404);
    });

    it('never returns another workspace\'s order even if its id is guessed correctly', async () => {
      orderStore.set('order-2', makeOrder({ id: 'order-2', workspaceId: 'ws-2' }));
      const response = await POST(makePostRequest({ workspaceId: 'ws-1', orderIds: ['order-2'] }));
      expect(response.status).toBe(404);
    });
  });

  describe('POST — validation (never a silent/partial export)', () => {
    it('returns 400 with specific error details and no CSV body when an order is invalid', async () => {
      orderStore.set('order-1', makeOrder({ customerName: '' }));
      const response = await POST(makePostRequest({ workspaceId: 'ws-1', orderIds: ['order-1'] }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(response.headers.get('Content-Type')).not.toContain('text/csv');
      expect(data.details.length).toBeGreaterThan(0);
      expect(data.details.some((d: string) => d.includes('order-1'))).toBe(true);
    });

    it('rejects an invalid desiredDeliveryDate without generating a file', async () => {
      orderStore.set('order-1', makeOrder());
      const response = await POST(
        makePostRequest({ workspaceId: 'ws-1', orderIds: ['order-1'], desiredDeliveryDate: 'not-a-date' })
      );
      expect(response.status).toBe(400);
    });
  });

  describe('POST — successful export', () => {
    it('returns the CSV as a downloadable file with the correct headers', async () => {
      orderStore.set('order-1', makeOrder());
      const response = await POST(makePostRequest({ workspaceId: 'ws-1', orderIds: ['order-1'] }));

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/csv');
      expect(response.headers.get('Content-Disposition')).toContain('attachment');
      expect(response.headers.get('Content-Disposition')).toContain('.csv');

      const text = await response.text();
      expect(text).toContain('NUMERO DE LA COMMANDE');
      expect(text).toContain('order-1');
      expect(text).toContain('SERUM');
    });

    it('applies the optional desiredDeliveryDate to the generated file', async () => {
      orderStore.set('order-1', makeOrder());
      const response = await POST(
        makePostRequest({ workspaceId: 'ws-1', orderIds: ['order-1'], desiredDeliveryDate: '2026-10-10' })
      );
      const text = await response.text();
      expect(text).toContain('10/10/2026');
    });

    it('exports multiple selected orders from the same workspace in one file', async () => {
      orderStore.set('order-1', makeOrder({ id: 'order-1' }));
      orderStore.set('order-2', makeOrder({ id: 'order-2', items: [{ productId: 'prod-2', title: 'Creme', quantity: 2, product: { sku: 'CREME' } }] }));

      const response = await POST(makePostRequest({ workspaceId: 'ws-1', orderIds: ['order-1', 'order-2'] }));
      const text = await response.text();

      expect(text).toContain('order-1');
      expect(text).toContain('order-2');
      expect(text).toContain('SERUM');
      expect(text).toContain('CREME');
    });
  });
});
