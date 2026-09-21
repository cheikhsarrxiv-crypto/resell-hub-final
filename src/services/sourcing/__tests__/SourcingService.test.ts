/**
 * Real behavioral tests for SourcingService — the aggregation layer
 * between the search_products tool and individual providers. Mocks
 * SourcingProviderRegistry (Phase 2's explicit registry) so tests control
 * exactly which fake providers exist and how they behave, independent of
 * any real provider's own specifics (eBay/Etsy are covered in their own
 * provider test files). Proves SourcingService's own contract:
 * SOURCE_NOT_CONFIGURED when nothing is configured, real aggregation
 * across one or several providers, errors surfaced rather than
 * swallowed, deduplication, currency/landed-cost normalization, sorting,
 * and the Phase 2 `providers` allowlist.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getAllProvidersMock } = vi.hoisted(() => ({ getAllProvidersMock: vi.fn() }));

vi.mock('@/services/sourcing/SourcingProviderRegistry', () => ({
  SourcingProviderRegistry: { getAllProviders: getAllProvidersMock },
}));

import { SourcingService } from '@/services/sourcing/SourcingService';

/** A minimal fake satisfying exactly what SourcingService.search() actually uses. */
function makeFakeProvider(name: string, overrides: { isConfigured?: boolean; searchProducts?: any } = {}) {
  return {
    name,
    displayName: name,
    supportedMarkets: [],
    capabilities: [],
    isConfigured: vi.fn().mockReturnValue(overrides.isConfigured ?? true),
    searchProducts: overrides.searchProducts ?? vi.fn().mockResolvedValue({ results: [] }),
    getProductDetails: vi.fn().mockResolvedValue(null),
  };
}

function fakeResult(overrides: Record<string, any> = {}) {
  return {
    source: 'ebay',
    sourceUrl: 'https://x',
    title: 'Item',
    price: 10,
    currency: 'EUR',
    marketplace: 'EBAY_FR',
    images: [],
    authenticityStatus: 'claimed' as const,
    ...overrides,
  };
}

describe('SourcingService.search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no provider configured -> SOURCE_NOT_CONFIGURED, empty results, no provider ever queried', async () => {
    const ebay = makeFakeProvider('ebay', { isConfigured: false });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'Prada sneakers' });

    expect(response.status).toBe('SOURCE_NOT_CONFIGURED');
    expect(response.results).toEqual([]);
    expect(response.providerErrors).toEqual([]);
    expect(response.providersUnavailable).toEqual(['ebay']);
    expect(ebay.searchProducts).not.toHaveBeenCalled();
  });

  it('a configured provider is queried and its results are returned as-is (plus a real EUR->EUR normalizedPriceEur)', async () => {
    const result = fakeResult();
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'Prada sneakers' });

    expect(response.status).toBe('ok');
    // Same currency (EUR->EUR) is the 'identical_currency' tier of
    // CurrencyConversionService — a real, always-correct rate of 1, not
    // a network call — so normalizedPriceEur === price here.
    expect(response.results).toEqual([{ ...result, normalizedPriceEur: 10, estimatedKnownCostEur: 10 }]);
    expect(response.providerErrors).toEqual([]);
    expect(response.totalResults).toBe(1);
  });

  it('never fabricates a result: an empty provider response stays an empty result set', async () => {
    getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay')]);

    const response = await SourcingService.search({ query: 'nothing matches this' });

    expect(response.status).toBe('ok');
    expect(response.results).toEqual([]);
  });

  it("a provider's structured error is surfaced in providerErrors, not swallowed", async () => {
    const ebay = makeFakeProvider('ebay', {
      searchProducts: vi.fn().mockResolvedValue({
        results: [],
        error: { provider: 'ebay', message: 'eBay search failed with status 500', kind: 'upstream_error' },
      }),
    });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x' });

    expect(response.status).toBe('ok');
    expect(response.providerErrors).toEqual([
      { provider: 'ebay', message: 'eBay search failed with status 500', kind: 'upstream_error' },
    ]);
  });

  it("a provider that throws instead of returning a structured error is still caught, not fatal to the whole search", async () => {
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockRejectedValue(new Error('unexpected bug in provider')) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x' });

    expect(response.status).toBe('ok');
    expect(response.results).toEqual([]);
    expect(response.providerErrors).toHaveLength(1);
    expect(response.providerErrors[0].provider).toBe('ebay');
  });

  describe('Global Sourcing Engine — provider provenance tracking', () => {
    it('a configured, queried provider is listed in providersSearched, never in providersUnavailable', async () => {
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay')]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.providersSearched).toEqual(['ebay']);
      expect(response.providersUnavailable).toEqual([]);
      expect(response.providersFailed).toEqual([]);
    });

    it('an unconfigured provider is listed in providersUnavailable, never queried, never in providersSearched', async () => {
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { isConfigured: false })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.providersUnavailable).toEqual(['ebay']);
      expect(response.providersSearched).toEqual([]);
    });

    it('a provider whose call produced a structured error is listed in providersFailed', async () => {
      const ebay = makeFakeProvider('ebay', {
        searchProducts: vi.fn().mockResolvedValue({ results: [], error: { provider: 'ebay', message: 'boom', kind: 'upstream_error' } }),
      });
      getAllProvidersMock.mockReturnValue([ebay]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.providersFailed).toEqual(['ebay']);
      expect(response.providersSearched).toEqual(['ebay']);
    });

    it('a provider that returns zero results (no error) is NOT listed in providersFailed — an empty outcome is not a failure', async () => {
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay')]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.providersFailed).toEqual([]);
    });

    it('a provider timeout (rejected promise) does not kill the search — the other provider\'s results still come back', async () => {
      const timeoutError = new Error('timed out');
      timeoutError.name = 'TimeoutError';
      const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockRejectedValue(timeoutError) });
      const etsy = makeFakeProvider('etsy', { searchProducts: vi.fn().mockResolvedValue({ results: [fakeResult({ source: 'etsy' })] }) });
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.status).toBe('ok');
      expect(response.results).toHaveLength(1);
      expect(response.results[0].source).toBe('etsy');
      expect(response.providersFailed).toEqual(['ebay']);
      expect(response.providersSearched.sort()).toEqual(['ebay', 'etsy']);
    });
  });

  describe('Global Sourcing Engine / Phase 2 — multi-provider aggregation', () => {
    it('two different, configured providers are both queried and their results combined', async () => {
      const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [fakeResult({ source: 'ebay' })] }) });
      const etsy = makeFakeProvider('etsy', { searchProducts: vi.fn().mockResolvedValue({ results: [fakeResult({ source: 'etsy', sourceUrl: 'https://etsy/y' })] }) });
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(2);
      expect(response.providersSearched.sort()).toEqual(['ebay', 'etsy']);
      expect(ebay.searchProducts).toHaveBeenCalledTimes(1);
      expect(etsy.searchProducts).toHaveBeenCalledTimes(1);
    });

    it('worldwide is passed through unchanged to every configured provider\'s searchProducts call', async () => {
      const ebay = makeFakeProvider('ebay');
      const etsy = makeFakeProvider('etsy');
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      await SourcingService.search({ query: 'x', worldwide: true });

      expect(ebay.searchProducts).toHaveBeenCalledWith(expect.objectContaining({ worldwide: true }));
      expect(etsy.searchProducts).toHaveBeenCalledWith(expect.objectContaining({ worldwide: true }));
    });
  });

  describe('Phase 2 — providers allowlist', () => {
    it('query.providers restricts the search to the named providers only; the rest are reported in providersSkipped, never queried', async () => {
      const ebay = makeFakeProvider('ebay');
      const etsy = makeFakeProvider('etsy');
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      const response = await SourcingService.search({ query: 'x', providers: ['ebay'] });

      expect(ebay.searchProducts).toHaveBeenCalledTimes(1);
      expect(etsy.searchProducts).not.toHaveBeenCalled();
      expect(response.providersSearched).toEqual(['ebay']);
      expect(response.providersSkipped).toEqual(['etsy']);
    });

    it('a skipped provider is never also reported as unavailable — skipped means "could have run, wasn\'t asked to"', async () => {
      const ebay = makeFakeProvider('ebay');
      const etsy = makeFakeProvider('etsy');
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      const response = await SourcingService.search({ query: 'x', providers: ['ebay'] });

      expect(response.providersUnavailable).toEqual([]);
      expect(response.providersSkipped).toEqual(['etsy']);
    });

    it('omitting query.providers queries every configured provider, unchanged from before this field existed', async () => {
      const ebay = makeFakeProvider('ebay');
      const etsy = makeFakeProvider('etsy');
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.providersSkipped).toEqual([]);
      expect(ebay.searchProducts).toHaveBeenCalledTimes(1);
      expect(etsy.searchProducts).toHaveBeenCalledTimes(1);
    });

    it('an unconfigured provider is still reported as unavailable, never as skipped, even when providers filter is set', async () => {
      const ebay = makeFakeProvider('ebay');
      const etsy = makeFakeProvider('etsy', { isConfigured: false });
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      const response = await SourcingService.search({ query: 'x', providers: ['ebay'] });

      expect(response.providersUnavailable).toEqual(['etsy']);
      expect(response.providersSkipped).toEqual([]);
    });
  });

  describe('Global Sourcing Engine — deduplication (conservative, exact-identifier only)', () => {
    it('two results sharing the same (provider, sourceId) are deduplicated to one — first occurrence wins', async () => {
      const first = fakeResult({ sourceId: 'ITEM-1', sourceUrl: 'https://x/1', title: 'First seen' });
      const duplicate = { ...first, title: 'Same item, duplicate entry', sourceUrl: 'https://x/1?ref=other' };
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [first, duplicate] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(1);
      expect(response.results[0].title).toBe('First seen');
      expect(response.totalResults).toBe(1);
    });

    it('two results with different sourceIds are NEVER merged, even if everything else matches — different annonces stay different', async () => {
      const a = fakeResult({ sourceId: 'ITEM-1', sourceUrl: 'https://x/1', title: 'Same title' });
      const b = { ...a, sourceId: 'ITEM-2', sourceUrl: 'https://x/2' };
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(2);
    });

    it('results with no sourceId fall back to exact sourceUrl matching for dedup', async () => {
      const first = fakeResult({ sourceUrl: 'https://x/same', title: 'A' });
      const duplicate = { ...first, title: 'B' };
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [first, duplicate] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(1);
    });

    it('results with no sourceId and different sourceUrls are never merged', async () => {
      const a = fakeResult({ sourceUrl: 'https://x/1', title: 'A' });
      const b = { ...a, sourceUrl: 'https://x/2' };
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(2);
    });

    it('the same sourceId from two DIFFERENT providers is never merged — dedup key includes the provider', async () => {
      const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [fakeResult({ source: 'ebay', sourceId: 'SAME-ID', sourceUrl: 'https://ebay/x' })] }) });
      const etsy = makeFakeProvider('etsy', { searchProducts: vi.fn().mockResolvedValue({ results: [fakeResult({ source: 'etsy', sourceId: 'SAME-ID', sourceUrl: 'https://etsy/x' })] }) });
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(2);
    });
  });

  describe('Global Sourcing Engine — currency normalization', () => {
    it('a result whose currency has no available rate keeps normalizedPriceEur undefined — never a guessed conversion', async () => {
      // No CURRENCY_STATIC_RATES/FRANKFURTER_FX_ENABLED configured in this
      // test environment -> CurrencyConversionService.convert() genuinely
      // resolves to 'unavailable' for a non-EUR pair, exactly like a real
      // deployment without FX configured.
      const result = fakeResult({ price: 100, currency: 'JPY', marketplace: 'EBAY_US' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].normalizedPriceEur).toBeUndefined();
      expect(response.results[0].estimatedKnownCostEur).toBeUndefined();
      expect(response.results[0].price).toBe(100);
      expect(response.results[0].currency).toBe('JPY');
    });

    it('a real, configured static JPY_EUR rate produces a real normalizedPriceEur — never a live network call in this test', async () => {
      const originalStaticRates = process.env.CURRENCY_STATIC_RATES;
      process.env.CURRENCY_STATIC_RATES = JSON.stringify({ JPY_EUR: 0.0061 });
      try {
        const result = fakeResult({ price: 28000, currency: 'JPY' });
        getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

        const response = await SourcingService.search({ query: 'x' });

        expect(response.results[0].normalizedPriceEur).toBeCloseTo(28000 * 0.0061, 5);
      } finally {
        if (originalStaticRates === undefined) delete process.env.CURRENCY_STATIC_RATES;
        else process.env.CURRENCY_STATIC_RATES = originalStaticRates;
      }
    });
  });

  describe('Phase 2 — landed cost (estimatedKnownCostEur)', () => {
    it('sums price + a real, convertible shippingCost into estimatedKnownCostEur', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', shippingCost: 5, shippingCostCurrency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].estimatedKnownCostEur).toBe(15);
    });

    it('an unconvertible shippingCost currency leaves estimatedKnownCostEur entirely undefined — never a partial/misleading sum', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', shippingCost: 500, shippingCostCurrency: 'JPY' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].estimatedKnownCostEur).toBeUndefined();
      // price itself is still known and normalized — only the combined landed-cost sum is withheld.
      expect(response.results[0].normalizedPriceEur).toBe(10);
    });

    it('unknownCostFactors (a label, no amount) never blocks estimatedKnownCostEur — only a real cost line that fails to convert does', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', unknownCostFactors: ['import taxes unknown'] });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].estimatedKnownCostEur).toBe(10);
      expect(response.results[0].unknownCostFactors).toEqual(['import taxes unknown']);
    });

    it('a knownAdditionalCosts entry that fails to convert leaves estimatedKnownCostEur undefined entirely', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', knownAdditionalCosts: [{ type: 'handling', amount: 3, currency: 'JPY' }] });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].estimatedKnownCostEur).toBeUndefined();
    });
  });

  describe('Phase 2 — sorting by normalizedPriceEur', () => {
    it('combined results are sorted ascending by normalizedPriceEur', async () => {
      const expensive = fakeResult({ sourceUrl: 'https://x/1', price: 100, currency: 'EUR' });
      const cheap = fakeResult({ sourceUrl: 'https://x/2', price: 10, currency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [expensive, cheap] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results.map((r) => r.price)).toEqual([10, 100]);
    });

    it('a result with no available normalizedPriceEur is placed after every result that has one, never dropped', async () => {
      const withRate = fakeResult({ sourceUrl: 'https://x/1', price: 50, currency: 'EUR' });
      const withoutRate = fakeResult({ sourceUrl: 'https://x/2', price: 100, currency: 'JPY' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [withoutRate, withRate] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(2);
      expect(response.results[0].currency).toBe('EUR');
      expect(response.results[1].currency).toBe('JPY');
    });
  });

  describe('workspace isolation', () => {
    it('SourcingService.search takes no workspaceId at all — sourcing is global, never per-tenant data', () => {
      expect(SourcingService.search.length).toBe(1); // (query) only
    });
  });
});
