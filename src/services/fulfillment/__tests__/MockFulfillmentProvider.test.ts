/**
 * Fulfillment Integration Foundation V1 — MockFulfillmentProvider: the
 * ONLY real, fully-executable FulfillmentProvider in this phase. Exercises
 * the full lifecycle (created -> accepted -> processing -> packed ->
 * shipped -> delivered) plus every error/edge case this phase's spec
 * named: insufficient stock, duplicate order, temporary failure, permanent
 * failure, cancellation, tracking unavailable, provider unavailable — and
 * a concurrent-create race.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFulfillmentProvider } from '@/services/fulfillment/providers/MockFulfillmentProvider';
import { FulfillmentProviderError } from '@/services/fulfillment/errors';
import type { CreateFulfillmentOrderInput } from '@/services/fulfillment/FulfillmentProvider';

function makeInput(orderId: string, overrides: Partial<CreateFulfillmentOrderInput> = {}): CreateFulfillmentOrderInput {
  return {
    workspaceId: 'ws-1',
    orderId,
    items: [{ productId: 'product-1', sku: 'SKU-1', title: 'Prada Sneakers', quantity: 1 }],
    shippingAddress: { line1: '1 rue du Test', city: 'Paris', postalCode: '75001', country: 'FR' },
    ...overrides,
  };
}

describe('MockFulfillmentProvider', () => {
  let provider: MockFulfillmentProvider;

  beforeEach(() => {
    provider = new MockFulfillmentProvider();
  });

  describe('full lifecycle: created -> accepted -> processing -> packed -> shipped -> delivered', () => {
    it('advances through every status and getFulfillmentOrder/getTracking/getShipment reflect it honestly at each step', async () => {
      const created = await provider.createFulfillmentOrder(makeInput('order-lifecycle'));
      expect(created.status).toBe('pending');

      let shipment = await provider.getShipment(created.externalOrderId);
      expect(shipment).toBeNull(); // not shipped yet — never a fabricated shipment

      for (const status of ['accepted', 'processing', 'packed'] as const) {
        provider.__advanceStatus('order-lifecycle', status);
        const current = await provider.getFulfillmentOrder(created.externalOrderId);
        expect(current.status).toBe(status);
      }

      provider.__advanceStatus('order-lifecycle', 'shipped', { trackingNumber: 'TRACK-123', carrier: 'Mock Carrier' });
      shipment = await provider.getShipment(created.externalOrderId);
      expect(shipment).toMatchObject({ status: 'shipped', trackingNumber: 'TRACK-123', carrier: 'Mock Carrier' });
      expect(shipment!.actualDelivery).toBeNull();

      provider.__advanceStatus('order-lifecycle', 'delivered');
      shipment = await provider.getShipment(created.externalOrderId);
      expect(shipment!.status).toBe('delivered');
      expect(shipment!.actualDelivery).not.toBeNull();

      const tracking = await provider.getTracking(created.externalOrderId);
      const seenStatuses = tracking.map((e) => e.status);
      expect(seenStatuses).toEqual(['pending', 'accepted', 'processing', 'packed', 'shipped', 'delivered']);
    });
  });

  describe('duplicate order — idempotent replay, never a second simulated order', () => {
    it('calling createFulfillmentOrder twice for the same ADKSY orderId returns the SAME externalOrderId', async () => {
      const first = await provider.createFulfillmentOrder(makeInput('order-dup'));
      const second = await provider.createFulfillmentOrder(makeInput('order-dup'));

      expect(second.externalOrderId).toBe(first.externalOrderId);
      expect(second.status).toBe(first.status);
    });

    it('a status advance after the duplicate call is still visible via the original externalOrderId (truly one order, not two)', async () => {
      const first = await provider.createFulfillmentOrder(makeInput('order-dup-2'));
      await provider.createFulfillmentOrder(makeInput('order-dup-2'));
      provider.__advanceStatus('order-dup-2', 'accepted');

      const current = await provider.getFulfillmentOrder(first.externalOrderId);
      expect(current.status).toBe('accepted');
    });
  });

  describe('forced error scenarios', () => {
    it('insufficient stock -> VALIDATION_FAILURE, order never created', async () => {
      provider.__forceOutcome('order-stock', 'INSUFFICIENT_STOCK');

      await expect(provider.createFulfillmentOrder(makeInput('order-stock'))).rejects.toMatchObject({
        code: 'VALIDATION_FAILURE',
      });
      await expect(provider.getFulfillmentOrder('MOCK-order-stock')).rejects.toMatchObject({ code: 'PERMANENT_FAILURE' });
    });

    it('temporary failure -> TEMPORARY_FAILURE (retryable), and a retry afterward succeeds (one-shot arm)', async () => {
      provider.__forceOutcome('order-temp', 'TEMPORARY_FAILURE');

      const err = await provider.createFulfillmentOrder(makeInput('order-temp')).catch((e) => e);
      expect(err).toBeInstanceOf(FulfillmentProviderError);
      expect(err.code).toBe('TEMPORARY_FAILURE');
      expect(err.retryable).toBe(true);

      const retried = await provider.createFulfillmentOrder(makeInput('order-temp'));
      expect(retried.status).toBe('pending');
    });

    it('permanent failure -> PERMANENT_FAILURE (never retryable)', async () => {
      provider.__forceOutcome('order-perm', 'PERMANENT_FAILURE');

      const err = await provider.createFulfillmentOrder(makeInput('order-perm')).catch((e) => e);
      expect(err.code).toBe('PERMANENT_FAILURE');
      expect(err.retryable).toBe(false);
    });

    it('provider unavailable -> TEMPORARY_FAILURE (treated as retryable, not a permanent rejection)', async () => {
      provider.__forceOutcome('order-unavail', 'PROVIDER_UNAVAILABLE');

      const err = await provider.createFulfillmentOrder(makeInput('order-unavail')).catch((e) => e);
      expect(err.code).toBe('TEMPORARY_FAILURE');
    });

    it('tracking unavailable -> getTracking returns an empty array, not an error (the order itself exists)', async () => {
      provider.__forceOutcome('order-notrack', 'TRACKING_UNAVAILABLE');
      const created = await provider.createFulfillmentOrder(makeInput('order-notrack'));

      const tracking = await provider.getTracking(created.externalOrderId);
      expect(tracking).toEqual([]);

      // The order itself is perfectly real and queryable — only tracking is unavailable.
      const order = await provider.getFulfillmentOrder(created.externalOrderId);
      expect(order.status).toBe('pending');
    });
  });

  describe('cancellation', () => {
    it('cancelling a pending order succeeds', async () => {
      const created = await provider.createFulfillmentOrder(makeInput('order-cancel-ok'));
      await provider.cancelFulfillmentOrder(created.externalOrderId);

      const order = await provider.getFulfillmentOrder(created.externalOrderId);
      expect(order.status).toBe('cancelled');
    });

    it('cancelling an already-shipped order is rejected as UNSUPPORTED_OPERATION, never silently accepted', async () => {
      const created = await provider.createFulfillmentOrder(makeInput('order-cancel-shipped'));
      provider.__advanceStatus('order-cancel-shipped', 'shipped');

      await expect(provider.cancelFulfillmentOrder(created.externalOrderId)).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
      });
      // Status is unchanged by the rejected attempt.
      const order = await provider.getFulfillmentOrder(created.externalOrderId);
      expect(order.status).toBe('shipped');
    });

    it('cancelling an unknown externalOrderId throws PERMANENT_FAILURE', async () => {
      await expect(provider.cancelFulfillmentOrder('MOCK-does-not-exist')).rejects.toMatchObject({ code: 'PERMANENT_FAILURE' });
    });
  });

  describe('capability reporting — stays honest, never claims an unreal capability', () => {
    it('supportsPickupPoint/supportsLabels are false — no real pickup-point/label network exists in the mock', () => {
      expect(provider.supportsPickupPoint()).toBe(false);
      expect(provider.supportsLabels()).toBe(false);
    });

    it('supportsMarketplaceShippingRequirements is true — the mock accepts the field without crashing, even though it does not act on it', () => {
      expect(provider.supportsMarketplaceShippingRequirements()).toBe(true);
    });
  });

  describe('multi-order isolation', () => {
    it('two different ADKSY orders never collide — each gets its own externalOrderId and independent status', async () => {
      const a = await provider.createFulfillmentOrder(makeInput('order-a'));
      const b = await provider.createFulfillmentOrder(makeInput('order-b'));

      expect(a.externalOrderId).not.toBe(b.externalOrderId);

      provider.__advanceStatus('order-a', 'shipped');
      const bStatus = await provider.getFulfillmentOrder(b.externalOrderId);
      expect(bStatus.status).toBe('pending'); // untouched by order-a's advance
    });
  });

  describe('race condition: concurrent createFulfillmentOrder for the same orderId', () => {
    it('two concurrent calls for the same orderId both resolve to the SAME externalOrderId — no duplicate simulated order', async () => {
      const [first, second] = await Promise.all([
        provider.createFulfillmentOrder(makeInput('order-race')),
        provider.createFulfillmentOrder(makeInput('order-race')),
      ]);

      expect(first.externalOrderId).toBe(second.externalOrderId);
    });
  });

  describe('__reset', () => {
    it('wipes all simulated state — a reset provider has no memory of prior orders', async () => {
      const created = await provider.createFulfillmentOrder(makeInput('order-reset'));
      provider.__reset();

      await expect(provider.getFulfillmentOrder(created.externalOrderId)).rejects.toMatchObject({ code: 'PERMANENT_FAILURE' });
    });
  });
});
