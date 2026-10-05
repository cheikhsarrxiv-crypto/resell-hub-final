/**
 * Fulfillment Integration Foundation V1 — Phase C.
 * FulfillmentService.sendToFulfillment is now the REAL main entry point:
 * its public signature (orderId, workspaceId, partnerId) is UNCHANGED,
 * but when the resolved FulfillmentPartner has a `providerId` set, it now
 * also dispatches to that real FulfillmentProvider (registry.ts) and
 * records the result — or, on failure, marks both FulfillmentOrder and
 * Order accordingly and notifies, per Q4's decision. A partner with
 * providerId=null (every partner that exists today) keeps the exact
 * historical, provider-less behavior — proven here (test A), not just
 * asserted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { orderStore, fulfillmentOrderStore, partnerStore } = vi.hoisted(() => ({
  orderStore: new Map<string, any>(),
  fulfillmentOrderStore: new Map<string, any>(), // key: orderId
  partnerStore: new Map<string, any>(),
}));
const { hasFeatureMock, notifyFulfillmentErrorMock } = vi.hoisted(() => ({
  hasFeatureMock: vi.fn(),
  notifyFulfillmentErrorMock: vi.fn(),
}));

let fulfillmentOrderIdCounter = 0;

vi.mock('@/services/SubscriptionService', () => ({
  SubscriptionService: { hasFeature: hasFeatureMock },
}));

vi.mock('@/services/NotificationService', () => ({
  NotificationService: { notifyFulfillmentError: notifyFulfillmentErrorMock },
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
        if (!row) throw new Error('order not found');
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
    customerEmail: 'buyer@example.com',
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

describe('FulfillmentService.sendToFulfillment — provider wiring (Phase C)', () => {
  const mockProvider = __getMockFulfillmentProviderForTests();

  beforeEach(() => {
    orderStore.clear();
    fulfillmentOrderStore.clear();
    partnerStore.clear();
    vi.clearAllMocks();
    hasFeatureMock.mockResolvedValue(true);
    mockProvider.__reset();
    orderStore.set('order-1', makeOrder());
  });

  describe('A. providerId = null (every partner that exists today) -> historical behavior, unchanged', () => {
    it('creates the FulfillmentOrder, flips Order to processing, and NEVER calls any provider', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'ShipMock France', costPerOrder: 5, providerId: null });

      const result = await FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1');

      expect(result.status).toBe('pending'); // historical default, never touched by a provider
      expect(result.externalOrderId).toMatch(/^FUL-/); // historical fabricated id, unchanged
      expect(orderStore.get('order-1').status).toBe('processing');
      expect(notifyFulfillmentErrorMock).not.toHaveBeenCalled();
    });

    it('a partner row with no providerId column at all (undefined) behaves identically to explicit null', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'ShipMock France', costPerOrder: 5 }); // no providerId key

      const result = await FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1');
      expect(result.externalOrderId).toMatch(/^FUL-/);
    });
  });

  describe('B/C. providerId = "mock" -> MockFulfillmentProvider is actually called via sendToFulfillment itself', () => {
    it('records the provider-assigned externalOrderId and status, not the historical fabricated id', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'Mock Partner', costPerOrder: 5, providerId: 'mock' });

      const result = await FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1');

      expect(result.externalOrderId).toBe('MOCK-order-1');
      expect(result.status).toBe('pending');

      const providerOrder = await mockProvider.getFulfillmentOrder('MOCK-order-1');
      expect(providerOrder.status).toBe('pending');
    });

    it('Order.status is still "processing" on success (unaffected by the new dispatch)', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'Mock Partner', costPerOrder: 5, providerId: 'mock' });
      await FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1');
      expect(orderStore.get('order-1').status).toBe('processing');
    });
  });

  describe('D. Mock provider failure -> FulfillmentOrder=failed, Order=error, error propagated, notification sent', () => {
    it('propagates the real error and leaves no silent pending/processing pair', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'Mock Partner', costPerOrder: 5, providerId: 'mock' });
      mockProvider.__forceOutcome('order-1', 'PERMANENT_FAILURE');

      await expect(FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1')).rejects.toMatchObject({
        code: 'PERMANENT_FAILURE',
      });

      expect(fulfillmentOrderStore.get('order-1').status).toBe('failed');
      expect(orderStore.get('order-1').status).toBe('error'); // never left at "processing"
    });

    it('calls NotificationService.notifyFulfillmentError with the real error message', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'Mock Partner', costPerOrder: 5, providerId: 'mock' });
      mockProvider.__forceOutcome('order-1', 'TEMPORARY_FAILURE');

      await expect(FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1')).rejects.toBeTruthy();

      expect(notifyFulfillmentErrorMock).toHaveBeenCalledTimes(1);
      const [workspaceId, orderId, errorMessage, email] = notifyFulfillmentErrorMock.mock.calls[0];
      expect(workspaceId).toBe('ws-1');
      expect(orderId).toBe('order-1');
      expect(errorMessage).toMatch(/temporarily unreachable/i);
      expect(email).toBe('buyer@example.com');
    });
  });

  describe('E. Workspace isolation', () => {
    it('an order belonging to a different workspace is never found, regardless of providerId', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'Mock Partner', costPerOrder: 5, providerId: 'mock' });
      orderStore.set('order-foreign', makeOrder({ id: 'order-foreign', workspaceId: 'ws-OTHER' }));

      await expect(FulfillmentService.sendToFulfillment('order-foreign', 'ws-1', 'partner-1')).rejects.toThrow('Order not found');
    });

    it('two workspaces dispatching through the same mock-configured partner never cross-contaminate provider state', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'Mock Partner', costPerOrder: 5, providerId: 'mock' });
      orderStore.set('order-ws2', makeOrder({ id: 'order-ws2', workspaceId: 'ws-2' }));

      const r1 = await FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1');
      const r2 = await FulfillmentService.sendToFulfillment('order-ws2', 'ws-2', 'partner-1');

      expect(r1.externalOrderId).not.toBe(r2.externalOrderId);
      mockProvider.__advanceStatus('order-1', 'shipped');
      const ws2Status = await mockProvider.getFulfillmentOrder(r2.externalOrderId!);
      expect(ws2Status.status).toBe('pending');
    });
  });

  describe('F. Unknown/unconfigured providerId -> clean NOT_CONFIGURED, never a crash', () => {
    it('a partner configured with a planned-but-unimplemented provider id throws NOT_CONFIGURED, and marks the order failed/error', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'Frenchlog (not real yet)', costPerOrder: 5, providerId: 'frenchlog' });

      await expect(FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1')).rejects.toMatchObject({
        code: 'NOT_CONFIGURED',
      });
      expect(fulfillmentOrderStore.get('order-1').status).toBe('failed');
      expect(orderStore.get('order-1').status).toBe('error');
    });

    it('a totally unknown providerId string also throws NOT_CONFIGURED cleanly', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'Mystery Partner', costPerOrder: 5, providerId: 'nobody-configured-this' });

      await expect(FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1')).rejects.toMatchObject({
        code: 'NOT_CONFIGURED',
      });
    });
  });

  describe('G. Still enforces every pre-existing guard, unchanged', () => {
    it('plan gate still rejects before any provider call', async () => {
      hasFeatureMock.mockResolvedValue(false);
      partnerStore.set('partner-1', { id: 'partner-1', name: 'Mock Partner', costPerOrder: 5, providerId: 'mock' });

      await expect(FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1')).rejects.toThrow(
        'Fulfillment is not included in your current plan'
      );
    });

    it('duplicate-fulfillment-order guard still applies', async () => {
      partnerStore.set('partner-1', { id: 'partner-1', name: 'Mock Partner', costPerOrder: 5, providerId: 'mock' });
      await FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1');

      await expect(FulfillmentService.sendToFulfillment('order-1', 'ws-1', 'partner-1')).rejects.toThrow('Fulfillment order already created');
    });
  });
});
