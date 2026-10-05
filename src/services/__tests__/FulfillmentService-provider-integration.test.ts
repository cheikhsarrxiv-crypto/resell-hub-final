/**
 * Fulfillment Integration Foundation V1 — FulfillmentService.sendToFulfillmentViaProvider.
 * A NEW, additive method: reuses the real, UNCHANGED sendToFulfillment to
 * create the FulfillmentOrder (same plan gate / order lookup / duplicate
 * check), then exercises the FulfillmentProvider abstraction end-to-end
 * with the real MockFulfillmentProvider (via the real registry — not
 * mocked, since the whole point is to prove the wiring itself works).
 *
 * send_to_fulfillment (the AI tool) and /api/fulfillment/send still call
 * the plain, untouched sendToFulfillment — this file never asserts
 * anything about them, by design (zero shared risk).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { orderStore, fulfillmentOrderStore, partnerStore } = vi.hoisted(() => ({
  orderStore: new Map<string, any>(),
  fulfillmentOrderStore: new Map<string, any>(), // key: orderId
  partnerStore: new Map<string, any>(),
}));
const { hasFeatureMock } = vi.hoisted(() => ({ hasFeatureMock: vi.fn() }));

let fulfillmentOrderIdCounter = 0;

vi.mock('@/services/SubscriptionService', () => ({
  SubscriptionService: { hasFeature: hasFeatureMock },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    order: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = orderStore.get(where.id);
        if (!row || row.workspaceId !== where.workspaceId) return null;
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = orderStore.get(where.id);
        Object.assign(row, data);
        return { ...row };
      }),
    },
    fulfillmentOrder: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = fulfillmentOrderStore.get(where.orderId);
        return row ? { ...row } : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `fo-${++fulfillmentOrderIdCounter}`, ...data };
        fulfillmentOrderStore.set(data.orderId, row);
        return { ...row, partner: partnerStore.get(data.partnerId) };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = [...fulfillmentOrderStore.values()].find((r) => r.id === where.id);
        if (!row) throw new Error('fulfillment order not found');
        Object.assign(row, data);
        return { ...row, partner: partnerStore.get(row.partnerId) };
      }),
    },
    fulfillmentPartner: {
      findUnique: vi.fn(async ({ where }: any) => partnerStore.get(where.id) ?? null),
    },
  },
}));

import { FulfillmentService } from '@/services/FulfillmentService';
import { __getMockFulfillmentProviderForTests } from '@/services/fulfillment/registry';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    workspaceId: 'ws-1',
    estimatedProfit: 100,
    totalPrice: 150,
    shippingAddress: '1 rue du Test',
    shippingAddress2: null,
    shippingCity: 'Paris',
    shippingState: null,
    shippingPostalCode: '75001',
    shippingCountry: 'FR',
    shippingPhone: null,
    shippingEmail: null,
    items: [{ productId: 'product-1', title: 'Prada Sneakers', quantity: 1, price: 449, product: { sku: 'SKU-1' } }],
    ...overrides,
  };
}

describe('FulfillmentService.sendToFulfillmentViaProvider', () => {
  const mockProvider = __getMockFulfillmentProviderForTests();

  beforeEach(() => {
    orderStore.clear();
    fulfillmentOrderStore.clear();
    partnerStore.clear();
    vi.clearAllMocks();
    hasFeatureMock.mockResolvedValue(true);
    mockProvider.__reset();
    partnerStore.set('partner-1', { id: 'partner-1', name: 'ShipMock France', costPerOrder: 5 });
    orderStore.set('order-1', makeOrder());
  });

  it('creates the real FulfillmentOrder (unchanged path) AND records the provider-assigned externalOrderId/status', async () => {
    const result = await FulfillmentService.sendToFulfillmentViaProvider('order-1', 'ws-1', 'partner-1', 'mock');

    expect(result.externalOrderId).toBe('MOCK-order-1');
    expect(result.status).toBe('pending');

    const providerOrder = await mockProvider.getFulfillmentOrder('MOCK-order-1');
    expect(providerOrder.status).toBe('pending');
  });

  it('never persists any shipping-requirements data (none is fabricated — no real source exists today)', async () => {
    await FulfillmentService.sendToFulfillmentViaProvider('order-1', 'ws-1', 'partner-1', 'mock');
    const providerOrder = fulfillmentOrderStore.get('order-1');
    expect(providerOrder.shippingRequirements).toBeUndefined();
  });

  it('an unconfigured provider id throws NOT_CONFIGURED — the local FulfillmentOrder row still exists (known, documented limitation)', async () => {
    await expect(FulfillmentService.sendToFulfillmentViaProvider('order-1', 'ws-1', 'partner-1', 'frenchlog')).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    // The plain FulfillmentOrder creation (step 1) already committed.
    expect(fulfillmentOrderStore.get('order-1')).toBeDefined();
  });

  it('still enforces the real plan gate — fulfillment disabled rejects before any provider call', async () => {
    hasFeatureMock.mockResolvedValue(false);
    await expect(FulfillmentService.sendToFulfillmentViaProvider('order-1', 'ws-1', 'partner-1', 'mock')).rejects.toThrow(
      'Fulfillment is not included in your current plan'
    );
  });

  it('still enforces the real duplicate-fulfillment-order guard', async () => {
    await FulfillmentService.sendToFulfillmentViaProvider('order-1', 'ws-1', 'partner-1', 'mock');
    await expect(FulfillmentService.sendToFulfillmentViaProvider('order-1', 'ws-1', 'partner-1', 'mock')).rejects.toThrow(
      'Fulfillment order already created'
    );
  });

  describe('multi-tenant isolation', () => {
    it('an order belonging to a different workspace is never found — never leaks another workspace\'s order to the provider', async () => {
      orderStore.set('order-foreign', makeOrder({ id: 'order-foreign', workspaceId: 'ws-OTHER' }));

      await expect(FulfillmentService.sendToFulfillmentViaProvider('order-foreign', 'ws-1', 'partner-1', 'mock')).rejects.toThrow(
        'Order not found'
      );
    });

    it('two different workspaces sending their own order to the SAME mock provider never cross-contaminate state', async () => {
      orderStore.set('order-ws2', makeOrder({ id: 'order-ws2', workspaceId: 'ws-2' }));

      const resultWs1 = await FulfillmentService.sendToFulfillmentViaProvider('order-1', 'ws-1', 'partner-1', 'mock');
      const resultWs2 = await FulfillmentService.sendToFulfillmentViaProvider('order-ws2', 'ws-2', 'partner-1', 'mock');

      expect(resultWs1.externalOrderId).not.toBe(resultWs2.externalOrderId);
      mockProvider.__advanceStatus('order-1', 'shipped');
      const ws2Status = await mockProvider.getFulfillmentOrder(resultWs2.externalOrderId!);
      expect(ws2Status.status).toBe('pending'); // ws-1's advance never touched ws-2's order
    });
  });
});
