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
    // estimatedKnownCostEur stays undefined (Phase 3): this fakeResult has
    // no shippingCost at all, which is a real, reportable "shipping
    // unknown" gap, not "nothing to add" — see attachLandedCost.
    expect(response.results).toEqual([
      {
        ...result,
        normalizedPriceEur: 10,
        unknownCostFactors: ['shipping_unknown'],
        matchReasons: [],
        warnings: [
          "Authenticity is only the seller's own claim — not independently verified.",
          "Landed cost is incomplete — this listing's shipping cost is not reported.",
          'Item condition is not reported by this source.',
          'Seller reputation is not reported by this source.',
          'Stock availability is not reported by this source.',
        ],
      },
    ]);
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

    it('a pre-existing unknownCostFactors label (e.g. from a provider) never blocks estimatedKnownCostEur by itself — only a real cost line that fails to convert (or a genuinely unreported shippingCost) does', async () => {
      // shippingCost is defined+convertible here so the ONLY thing under
      // test is that an unrelated, pre-existing unknownCostFactors entry
      // doesn't itself poison the sum.
      const result = fakeResult({ price: 10, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR', unknownCostFactors: ['import_tax_unknown'] });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].estimatedKnownCostEur).toBe(10);
      expect(response.results[0].unknownCostFactors).toEqual(['import_tax_unknown']);
    });

    it('a knownAdditionalCosts entry that fails to convert leaves estimatedKnownCostEur undefined entirely, and records currency_conversion_unavailable', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR', knownAdditionalCosts: [{ type: 'handling', amount: 3, currency: 'JPY' }] });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].estimatedKnownCostEur).toBeUndefined();
      expect(response.results[0].unknownCostFactors).toEqual(['currency_conversion_unavailable']);
    });

    it('Phase 3 — a real reported shippingCost of 0 counts as known, never blocking the total', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].estimatedKnownCostEur).toBe(10);
    });

    it('Phase 3 — shippingCost never reported at all blocks estimatedKnownCostEur and records shipping_unknown', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].estimatedKnownCostEur).toBeUndefined();
      expect(response.results[0].unknownCostFactors).toEqual(['shipping_unknown']);
    });

    it('an unconvertible shippingCost currency records currency_conversion_unavailable', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', shippingCost: 500, shippingCostCurrency: 'JPY' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].unknownCostFactors).toEqual(['currency_conversion_unavailable']);
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

  describe('Phase 3 — robust price filtering', () => {
    it('excludes a result whose normalizedPriceEur is confidently outside the requested maxPrice', async () => {
      const cheap = fakeResult({ sourceUrl: 'https://x/1', price: 100, currency: 'EUR' });
      const expensive = fakeResult({ sourceUrl: 'https://x/2', price: 900, currency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [cheap, expensive] }) })]);

      const response = await SourcingService.search({ query: 'x', maxPrice: 400, currency: 'EUR' });

      expect(response.results.map((r) => r.sourceUrl)).toEqual(['https://x/1']);
    });

    it('never excludes a result whose price comparison is merely uncertain (no reliable EUR rate) — keeps it with a warning', async () => {
      const uncertain = fakeResult({ price: 100, currency: 'JPY' }); // no rate configured in this test env
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [uncertain] }) })]);

      const response = await SourcingService.search({ query: 'x', maxPrice: 400, currency: 'EUR' });

      expect(response.results).toHaveLength(1);
      expect(response.results[0].warnings?.some((w) => /uncertain/i.test(w))).toBe(true);
    });

    it('no minPrice/maxPrice requested -> nothing is excluded on price grounds', async () => {
      const expensive = fakeResult({ price: 99999, currency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [expensive] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(1);
    });

    it('provider capability filtering: a provider with NO native price filter (e.g. one that ignores maxPrice, like Etsy) still gets a correct final result via SourcingService\'s own local, currency-aware filtering', async () => {
      // Simulates a provider that (like EtsySourcingProvider) never applies
      // minPrice/maxPrice itself and just returns everything — proving the
      // orchestrator's OWN local filter is what actually enforces the bound,
      // not blind trust that every provider filtered correctly.
      const withinBounds = fakeResult({ source: 'etsy', sourceUrl: 'https://etsy/1', price: 300, currency: 'EUR' });
      const outsideBounds = fakeResult({ source: 'etsy', sourceUrl: 'https://etsy/2', price: 900, currency: 'EUR' });
      const providerIgnoringPriceFilter = makeFakeProvider('etsy', {
        searchProducts: vi.fn().mockResolvedValue({ results: [withinBounds, outsideBounds] }),
      });
      getAllProvidersMock.mockReturnValue([providerIgnoringPriceFilter]);

      const response = await SourcingService.search({ query: 'x', maxPrice: 400, currency: 'EUR' });

      expect(response.results.map((r) => r.sourceUrl)).toEqual(['https://etsy/1']);
    });
  });

  describe('Phase 3 — matchReasons/warnings wiring', () => {
    it('every result carries real matchReasons/warnings arrays from OpportunityRankingService, never omitted', async () => {
      const result = fakeResult({ price: 100, currency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x', brand: 'ebay' }); // 'Item' title won't match, just proving the arrays exist

      expect(Array.isArray(response.results[0].matchReasons)).toBe(true);
      expect(Array.isArray(response.results[0].warnings)).toBe(true);
    });
  });

  describe('Phase 3 — sort options', () => {
    const a = fakeResult({ sourceUrl: 'https://x/a', price: 50, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR' });
    const b = fakeResult({ sourceUrl: 'https://x/b', price: 20, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR' });

    it('price_asc sorts by the raw original price, ascending', async () => {
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);
      const response = await SourcingService.search({ query: 'x', sort: 'price_asc' });
      expect(response.results.map((r) => r.price)).toEqual([20, 50]);
    });

    it('price_desc sorts by the raw original price, descending', async () => {
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);
      const response = await SourcingService.search({ query: 'x', sort: 'price_desc' });
      expect(response.results.map((r) => r.price)).toEqual([50, 20]);
    });

    it('known_cost_asc sorts by estimatedKnownCostEur, ascending, unknown last', async () => {
      const known = fakeResult({ sourceUrl: 'https://x/1', price: 100, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR' });
      const unknown = fakeResult({ sourceUrl: 'https://x/2', price: 10, currency: 'EUR' }); // no shippingCost -> estimatedKnownCostEur undefined
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [unknown, known] }) })]);

      const response = await SourcingService.search({ query: 'x', sort: 'known_cost_asc' });

      expect(response.results.map((r) => r.sourceUrl)).toEqual(['https://x/1', 'https://x/2']);
    });

    it('default (omitted sort) is unchanged from Phase 2: normalized_price_asc', async () => {
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);
      const response = await SourcingService.search({ query: 'x' });
      expect(response.results.map((r) => r.price)).toEqual([20, 50]);
    });

    it("'match' uses the real, documented OpportunityRankingService.compareByMatch comparator", async () => {
      const strongMatch = fakeResult({ sourceUrl: 'https://x/1', title: 'Prada Cut Out Sneakers', price: 300, currency: 'EUR' });
      const weakMatch = fakeResult({ sourceUrl: 'https://x/2', title: 'Something else entirely', price: 10, currency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [weakMatch, strongMatch] }) })]);

      const response = await SourcingService.search({ query: 'x', brand: 'Prada', sort: 'match' });

      expect(response.results[0].sourceUrl).toBe('https://x/1');
    });
  });

  describe('Phase 3 — margin preview (targetResalePrice)', () => {
    it('attaches estimatedMargin/estimatedMarginPercent only when targetResalePrice is provided AND estimatedKnownCostEur is computable', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x', targetResalePrice: 20 });

      expect(response.results[0].estimatedMargin).toBe(10);
      expect(response.results[0].estimatedMarginPercent).toBe(50);
    });

    it('never computes a margin when targetResalePrice is absent — no invented resale price', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].estimatedMargin).toBeUndefined();
      expect(response.results[0].estimatedMarginPercent).toBeUndefined();
    });

    it('never computes a margin when estimatedKnownCostEur itself is undefined (e.g. shipping unknown)', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR' }); // no shippingCost -> estimatedKnownCostEur undefined
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x', targetResalePrice: 20 });

      expect(response.results[0].estimatedMargin).toBeUndefined();
    });

    it('Phase 6 — echoes targetResalePrice back onto the result, only alongside a real computed margin', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x', targetResalePrice: 20 });

      expect(response.results[0].targetResalePrice).toBe(20);
    });

    it('Phase 6 — never echoes targetResalePrice when no margin was actually computed', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR' }); // shipping unknown -> no margin
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x', targetResalePrice: 20 });

      expect(response.results[0].targetResalePrice).toBeUndefined();
    });
  });

  describe('Phase 6 — shippingCostEur / knownAdditionalCostsEur (independent EUR cost breakdown)', () => {
    it('attaches a real, converted shippingCostEur whenever shipping is known and convertible', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR', shippingCost: 5, shippingCostCurrency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].shippingCostEur).toBe(5);
      expect(response.results[0].estimatedKnownCostEur).toBe(15);
    });

    it('shippingCostEur stays undefined when shipping itself is unreported', async () => {
      const result = fakeResult({ price: 10, currency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].shippingCostEur).toBeUndefined();
    });

    it('attaches a real, converted knownAdditionalCostsEur (sum) when every additional cost line converts', async () => {
      const result = fakeResult({
        price: 10, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR',
        knownAdditionalCosts: [{ type: 'handling', amount: 3, currency: 'EUR' }, { type: 'insurance', amount: 2, currency: 'EUR' }],
      });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].knownAdditionalCostsEur).toBe(5);
      expect(response.results[0].estimatedKnownCostEur).toBe(15);
    });

    it('shippingCostEur is still populated even when a DIFFERENT cost line (knownAdditionalCosts) fails to convert and blocks the overall total', async () => {
      const result = fakeResult({
        price: 10, currency: 'EUR', shippingCost: 5, shippingCostCurrency: 'EUR',
        knownAdditionalCosts: [{ type: 'handling', amount: 3, currency: 'JPY' }],
      });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].estimatedKnownCostEur).toBeUndefined();
      expect(response.results[0].shippingCostEur).toBe(5);
      expect(response.results[0].knownAdditionalCostsEur).toBeUndefined();
    });

    it('knownAdditionalCostsEur stays undefined (never a partial sum) when one entry fails to convert', async () => {
      const result = fakeResult({
        price: 10, currency: 'EUR', shippingCost: 0, shippingCostCurrency: 'EUR',
        knownAdditionalCosts: [{ type: 'handling', amount: 3, currency: 'EUR' }, { type: 'insurance', amount: 2, currency: 'JPY' }],
      });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].knownAdditionalCostsEur).toBeUndefined();
    });
  });

  describe('Phase 3 — provider fairness / balancing', () => {
    it('no single provider dominates the final capped result set when it returned far more raw candidates than another', async () => {
      const ebayResults = Array.from({ length: 6 }, (_, i) => fakeResult({ source: 'ebay', sourceUrl: `https://ebay/${i}`, price: i, currency: 'EUR' }));
      const etsyResults = Array.from({ length: 2 }, (_, i) => fakeResult({ source: 'etsy', sourceUrl: `https://etsy/${i}`, price: 100 + i, currency: 'EUR' }));
      const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: ebayResults }) });
      const etsy = makeFakeProvider('etsy', { searchProducts: vi.fn().mockResolvedValue({ results: etsyResults }) });
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      const response = await SourcingService.search({ query: 'x', limit: 4 });

      expect(response.results).toHaveLength(4);
      const sources = new Set(response.results.map((r) => r.source));
      expect(sources.has('etsy')).toBe(true);
      expect(sources.has('ebay')).toBe(true);
    });

    it('fewer combined results than the limit are all kept, untouched by balancing', async () => {
      const ebayResults = [fakeResult({ sourceUrl: 'https://ebay/1' })];
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: ebayResults }) })]);

      const response = await SourcingService.search({ query: 'x', limit: 20 });

      expect(response.results).toHaveLength(1);
    });
  });

  describe('Phase 3 — observability (providerLatencyMs)', () => {
    it('reports a real latency entry for every provider that was actually searched', async () => {
      const ebay = makeFakeProvider('ebay');
      const etsy = makeFakeProvider('etsy');
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      const response = await SourcingService.search({ query: 'x' });

      expect(typeof response.providerLatencyMs.ebay).toBe('number');
      expect(typeof response.providerLatencyMs.etsy).toBe('number');
    });

    it('a skipped provider has no latency entry — it was never called', async () => {
      const ebay = makeFakeProvider('ebay');
      const etsy = makeFakeProvider('etsy');
      getAllProvidersMock.mockReturnValue([ebay, etsy]);

      const response = await SourcingService.search({ query: 'x', providers: ['ebay'] });

      expect(response.providerLatencyMs.ebay).toBeDefined();
      expect(response.providerLatencyMs.etsy).toBeUndefined();
    });

    it('SOURCE_NOT_CONFIGURED still returns an (empty) providerLatencyMs, never undefined', async () => {
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { isConfigured: false })]);
      const response = await SourcingService.search({ query: 'x' });
      expect(response.providerLatencyMs).toEqual({});
    });

    it('a provider that throws still gets a real latency entry recorded', async () => {
      const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockRejectedValue(new Error('boom')) });
      getAllProvidersMock.mockReturnValue([ebay]);

      const response = await SourcingService.search({ query: 'x' });

      expect(typeof response.providerLatencyMs.ebay).toBe('number');
    });
  });

  describe('Phase 3 — model/size/color folded into provider queries', () => {
    it('model/size/color are passed through unchanged to every provider, same as brand/category', async () => {
      const ebay = makeFakeProvider('ebay');
      getAllProvidersMock.mockReturnValue([ebay]);

      await SourcingService.search({ query: 'x', model: 'Cut', size: '42', color: 'Black' });

      expect(ebay.searchProducts).toHaveBeenCalledWith(expect.objectContaining({ model: 'Cut', size: '42', color: 'Black' }));
    });
  });

  describe('workspace isolation', () => {
    it('SourcingService.search takes no workspaceId at all — sourcing is global, never per-tenant data', () => {
      expect(SourcingService.search.length).toBe(1); // (query) only
    });
  });
});
