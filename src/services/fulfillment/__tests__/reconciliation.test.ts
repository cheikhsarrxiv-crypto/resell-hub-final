/**
 * Fulfillment Integration Foundation V1 — reconciliation (detection-only).
 * Compares FulfillmentOrder.status against the resolved provider's own
 * getFulfillmentOrder() report. Never writes back — proven here by
 * asserting prisma.fulfillmentOrder.update is never called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fulfillmentOrderStore } = vi.hoisted(() => ({ fulfillmentOrderStore: new Map<string, any>() }));
const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fulfillmentOrder: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = fulfillmentOrderStore.get(where.id);
        if (!row || row.workspaceId !== where.workspaceId) return null;
        return { ...row };
      }),
      update: updateMock,
    },
  },
}));

import { reconcileFulfillmentOrder } from '@/services/fulfillment/reconciliation';
import { __getMockFulfillmentProviderForTests } from '@/services/fulfillment/registry';

describe('reconcileFulfillmentOrder', () => {
  const mockProvider = __getMockFulfillmentProviderForTests();

  beforeEach(() => {
    fulfillmentOrderStore.clear();
    updateMock.mockClear();
    mockProvider.__reset();
  });

  it('throws when the fulfillment order does not exist in this workspace', async () => {
    await expect(reconcileFulfillmentOrder('fo-missing', 'ws-1', 'mock')).rejects.toThrow('Fulfillment order not found');
  });

  it('reports inSync=true with no provider status when there is no externalOrderId yet', async () => {
    fulfillmentOrderStore.set('fo-1', { id: 'fo-1', workspaceId: 'ws-1', status: 'pending', externalOrderId: null });

    const result = await reconcileFulfillmentOrder('fo-1', 'ws-1', 'mock');
    expect(result).toMatchObject({ inSync: true, providerStatus: null });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('reports inSync=true when ADKSY and the provider agree', async () => {
    const created = await mockProvider.createFulfillmentOrder({
      workspaceId: 'ws-1',
      orderId: 'order-sync',
      items: [],
      shippingAddress: { line1: 'x', city: 'Paris', postalCode: '75001', country: 'FR' },
    });
    fulfillmentOrderStore.set('fo-2', { id: 'fo-2', workspaceId: 'ws-1', status: 'pending', externalOrderId: created.externalOrderId });

    const result = await reconcileFulfillmentOrder('fo-2', 'ws-1', 'mock');
    expect(result).toMatchObject({ inSync: true, localStatus: 'pending', providerStatus: 'pending' });
  });

  it('reports inSync=false and never writes back when ADKSY and the provider disagree', async () => {
    const created = await mockProvider.createFulfillmentOrder({
      workspaceId: 'ws-1',
      orderId: 'order-mismatch',
      items: [],
      shippingAddress: { line1: 'x', city: 'Paris', postalCode: '75001', country: 'FR' },
    });
    mockProvider.__advanceStatus('order-mismatch', 'shipped');
    // ADKSY's own row was never told about the provider's advance — a realistic drift.
    fulfillmentOrderStore.set('fo-3', { id: 'fo-3', workspaceId: 'ws-1', status: 'pending', externalOrderId: created.externalOrderId });

    const result = await reconcileFulfillmentOrder('fo-3', 'ws-1', 'mock');
    expect(result).toMatchObject({ inSync: false, localStatus: 'pending', providerStatus: 'shipped' });
    expect(updateMock).not.toHaveBeenCalled(); // detection only, never corrects
  });
});
