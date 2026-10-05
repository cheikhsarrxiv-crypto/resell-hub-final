/**
 * Fulfillment Integration Foundation V1 — registry/factory tests.
 * getFulfillmentProvider is the ONE place that resolves a provider id
 * string to a real instance; these tests prove every known id resolves to
 * something, every known-but-unimplemented id is safely non-functional
 * (no network call), and an unknown id fails the same honest way.
 */
import { describe, it, expect } from 'vitest';
import { getFulfillmentProvider, PLANNED_PARTNER_PROVIDER_IDS, KNOWN_FULFILLMENT_PROVIDER_IDS } from '@/services/fulfillment/registry';
import { MockFulfillmentProvider } from '@/services/fulfillment/providers/MockFulfillmentProvider';
import { NotConfiguredFulfillmentProvider } from '@/services/fulfillment/providers/NotConfiguredFulfillmentProvider';
import { FulfillmentProviderError } from '@/services/fulfillment/errors';

describe('getFulfillmentProvider', () => {
  it('"mock" resolves to the one real, executable provider', () => {
    const provider = getFulfillmentProvider('mock');
    expect(provider).toBeInstanceOf(MockFulfillmentProvider);
    expect(provider.name).toBe('mock');
  });

  it('"mock" always resolves to the SAME shared instance (one simulated partner backend, not a fresh one per call)', () => {
    expect(getFulfillmentProvider('mock')).toBe(getFulfillmentProvider('mock'));
  });

  it.each(PLANNED_PARTNER_PROVIDER_IDS)('planned partner id "%s" resolves to NotConfiguredFulfillmentProvider, never a real adapter', (id) => {
    const provider = getFulfillmentProvider(id);
    expect(provider).toBeInstanceOf(NotConfiguredFulfillmentProvider);
    expect(provider.name).toBe(id);
  });

  it('every method of a planned-but-unconfigured provider throws NOT_CONFIGURED, with zero network call', async () => {
    const provider = getFulfillmentProvider('frenchlog');

    await expect(provider.createFulfillmentOrder({} as any)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(provider.getFulfillmentOrder('x')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(provider.cancelFulfillmentOrder('x')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(provider.getShipment('x')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(provider.getTracking('x')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(provider.supportsPickupPoint()).toBe(false);
    expect(provider.supportsLabels()).toBe(false);
    expect(provider.supportsMarketplaceShippingRequirements()).toBe(false);
  });

  it('an unknown provider id throws NOT_CONFIGURED rather than a generic error', () => {
    expect(() => getFulfillmentProvider('some-partner-nobody-configured')).toThrow(FulfillmentProviderError);
    try {
      getFulfillmentProvider('some-partner-nobody-configured');
    } catch (err) {
      expect((err as FulfillmentProviderError).code).toBe('NOT_CONFIGURED');
    }
  });

  it('KNOWN_FULFILLMENT_PROVIDER_IDS lists "mock" plus every planned partner id, nothing invented beyond the spec', () => {
    expect(KNOWN_FULFILLMENT_PROVIDER_IDS).toEqual(['mock', 'frenchlog', 'vintedmkp', 'colock_box', 'nexeuro']);
  });
});
