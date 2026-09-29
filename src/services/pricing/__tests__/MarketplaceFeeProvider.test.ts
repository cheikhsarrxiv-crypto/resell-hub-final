import { describe, it, expect, afterEach } from 'vitest';
import { MarketplaceFeeProvider } from '@/services/pricing/MarketplaceFeeProvider';
import { ExactFeeQuery, ExactFeeResult, ExactMarketplaceFeeProvider } from '@/services/pricing/providers/ExactMarketplaceFeeProvider';

describe('MarketplaceFeeProvider.getFeeStructure', () => {
  afterEach(() => {
    delete process.env.MARKETPLACE_FEE_CONFIG;
  });

  it('returns null for a marketplace with no configured fee — never a fabricated default', () => {
    expect(MarketplaceFeeProvider.getFeeStructure('ebay')).toBeNull();
    expect(MarketplaceFeeProvider.getFeeStructure('etsy')).toBeNull();
    expect(MarketplaceFeeProvider.getFeeStructure('vinted')).toBeNull();
  });

  it('returns a real configured structure, with its source, when one exists', () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'test-configured' },
    });
    const structure = MarketplaceFeeProvider.getFeeStructure('ebay');
    expect(structure).toEqual({ marketplace: 'ebay', percentageFee: 0.1, source: 'test-configured' });
  });

  it('normalizes a country-specific marketplace id (e.g. EBAY_GB) down to the generic key', () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'test-configured' },
    });
    expect(MarketplaceFeeProvider.getFeeStructure('EBAY_GB')).toEqual({
      marketplace: 'ebay',
      percentageFee: 0.1,
      source: 'test-configured',
    });
  });

  it('an exact key match (e.g. a per-country override) takes priority over the normalized generic key', () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'generic' },
      EBAY_GB: { marketplace: 'EBAY_GB', percentageFee: 0.11, source: 'gb-specific' },
    });
    expect(MarketplaceFeeProvider.getFeeStructure('EBAY_GB')?.source).toBe('gb-specific');
  });

  it('malformed MARKETPLACE_FEE_CONFIG JSON is ignored, not a crash', () => {
    process.env.MARKETPLACE_FEE_CONFIG = '{not valid json';
    expect(MarketplaceFeeProvider.getFeeStructure('ebay')).toBeNull();
  });
});

describe('MarketplaceFeeProvider.isConfigured', () => {
  afterEach(() => {
    delete process.env.MARKETPLACE_FEE_CONFIG;
  });

  it('mirrors getFeeStructure', () => {
    expect(MarketplaceFeeProvider.isConfigured('ebay')).toBe(false);
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({ ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'x' } });
    expect(MarketplaceFeeProvider.isConfigured('ebay')).toBe(true);
  });
});

/**
 * Test-only fixtures — NOT real integrations. A genuine
 * EbayExactMarketplaceFeeProvider/EtsyExactMarketplaceFeeProvider would
 * call eBay's getListingFees / an Etsy equivalent (which does not exist
 * for pre-sale fees, per the Phase 7 audit) using a real per-workspace
 * seller OAuth token — explicitly out of scope this phase. These fixtures
 * only exist to prove MarketplaceFeeProvider.resolveFee's contract:
 * per-workspace configuration, per-marketplace filtering, and no
 * cross-workspace data leakage.
 */
function fakeEbayExactFeeProviderForWorkspace(workspaceId: string, result: ExactFeeResult): ExactMarketplaceFeeProvider {
  return {
    name: 'fixture-ebay-exact-fee',
    marketplace: 'ebay',
    isConfigured: (wsId: string) => wsId === workspaceId,
    getExactFee: async (_query: ExactFeeQuery) => result,
  };
}

function fakeEtsyExactFeeProviderForWorkspace(workspaceId: string, result: ExactFeeResult): ExactMarketplaceFeeProvider {
  return {
    name: 'fixture-etsy-exact-fee',
    marketplace: 'etsy',
    isConfigured: (wsId: string) => wsId === workspaceId,
    getExactFee: async (_query: ExactFeeQuery) => result,
  };
}

describe('MarketplaceFeeProvider.resolveFee (Phase 7)', () => {
  afterEach(() => {
    delete process.env.MARKETPLACE_FEE_CONFIG;
  });

  const baseQuery: ExactFeeQuery = { workspaceId: 'ws-a', marketplace: 'ebay', resaleAmount: 800, resaleCurrency: 'EUR' };

  it('no exact provider, no configured schedule -> status "unknown", never a fabricated fee', async () => {
    const resolution = await MarketplaceFeeProvider.resolveFee(baseQuery);
    expect(resolution).toEqual({ status: 'unknown' });
  });

  it('no exact provider, but a configured schedule exists -> status "estimated"', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({ ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'test' } });
    const resolution = await MarketplaceFeeProvider.resolveFee(baseQuery);
    expect(resolution.status).toBe('estimated');
    expect(resolution.estimatedStructure?.percentageFee).toBe(0.1);
  });

  it('an exact provider configured for this exact workspace -> status "exact", the configured schedule is not even consulted', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({ ebay: { marketplace: 'ebay', percentageFee: 0.99, source: 'should-be-ignored' } });
    const provider = fakeEbayExactFeeProviderForWorkspace('ws-a', { amount: 108.8, currency: 'EUR', source: 'fixture_get_listing_fees', asOf: '2026-09-17' });

    const resolution = await MarketplaceFeeProvider.resolveFee(baseQuery, [provider]);

    expect(resolution).toEqual({
      status: 'exact',
      exact: { amount: 108.8, currency: 'EUR', source: 'fixture_get_listing_fees', asOf: '2026-09-17' },
    });
  });

  it('workspace isolation: a provider configured for workspace A is never invoked for workspace B — falls through to estimated/unknown instead', async () => {
    const providerForA = fakeEbayExactFeeProviderForWorkspace('ws-a', { amount: 999, currency: 'EUR', source: 'A-only-fee' });

    const resolutionForB = await MarketplaceFeeProvider.resolveFee({ ...baseQuery, workspaceId: 'ws-b' }, [providerForA]);

    expect(resolutionForB.status).toBe('unknown');
    expect(resolutionForB).not.toHaveProperty('exact.amount', 999);
  });

  it('workspace isolation: two workspaces, each with their own exact provider, never see each other\'s fee amount', async () => {
    const providerForA = fakeEbayExactFeeProviderForWorkspace('ws-a', { amount: 100, currency: 'EUR', source: 'A-fee' });
    const providerForB = fakeEbayExactFeeProviderForWorkspace('ws-b', { amount: 200, currency: 'EUR', source: 'B-fee' });
    const bothProviders = [providerForA, providerForB];

    const resolutionA = await MarketplaceFeeProvider.resolveFee({ ...baseQuery, workspaceId: 'ws-a' }, bothProviders);
    const resolutionB = await MarketplaceFeeProvider.resolveFee({ ...baseQuery, workspaceId: 'ws-b' }, bothProviders);

    expect(resolutionA.exact?.amount).toBe(100);
    expect(resolutionA.exact?.source).toBe('A-fee');
    expect(resolutionB.exact?.amount).toBe(200);
    expect(resolutionB.exact?.source).toBe('B-fee');
  });

  it('marketplace filtering: an eBay-specific provider is never consulted for an Etsy fee lookup', async () => {
    const ebayProvider = fakeEbayExactFeeProviderForWorkspace('ws-a', { amount: 999, currency: 'EUR', source: 'ebay-fee-should-not-apply' });

    const resolution = await MarketplaceFeeProvider.resolveFee({ ...baseQuery, marketplace: 'etsy' }, [ebayProvider]);

    expect(resolution.status).toBe('unknown');
  });

  it('an Etsy-specific exact provider only answers for Etsy, correctly scoped per workspace (Phase 7 §8.11)', async () => {
    const etsyProvider = fakeEtsyExactFeeProviderForWorkspace('ws-a', { amount: 55, currency: 'EUR', source: 'fixture-etsy-ledger' });

    const forEtsy = await MarketplaceFeeProvider.resolveFee({ ...baseQuery, marketplace: 'etsy' }, [etsyProvider]);
    const forEbay = await MarketplaceFeeProvider.resolveFee({ ...baseQuery, marketplace: 'ebay' }, [etsyProvider]);

    expect(forEtsy.exact?.amount).toBe(55);
    expect(forEbay.status).toBe('unknown'); // the Etsy provider must not answer for eBay
  });

  it('an eBay-specific exact provider correctly resolves via a country-specific marketplace id (EBAY_GB)', async () => {
    const provider = fakeEbayExactFeeProviderForWorkspace('ws-a', { amount: 42, currency: 'GBP', source: 'fixture-ebay-gb' });

    const resolution = await MarketplaceFeeProvider.resolveFee({ ...baseQuery, marketplace: 'EBAY_GB' }, [provider]);

    expect(resolution.status).toBe('exact');
    expect(resolution.exact?.amount).toBe(42);
  });

  it('a configured provider not configured for THIS workspace falls through to the estimated tier, never fabricating an exact answer', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({ ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'fallback' } });
    const providerForOtherWorkspace = fakeEbayExactFeeProviderForWorkspace('some-other-workspace', { amount: 1, currency: 'EUR', source: 'x' });

    const resolution = await MarketplaceFeeProvider.resolveFee(baseQuery, [providerForOtherWorkspace]);

    expect(resolution.status).toBe('estimated');
  });

  it('a provider that returns null (e.g. transient failure) is not fatal — falls through to the next tier', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({ ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'fallback' } });
    const failingProvider: ExactMarketplaceFeeProvider = {
      name: 'fixture-failing',
      marketplace: 'ebay',
      isConfigured: () => true,
      getExactFee: async () => null,
    };

    const resolution = await MarketplaceFeeProvider.resolveFee(baseQuery, [failingProvider]);

    expect(resolution.status).toBe('estimated');
  });
});
