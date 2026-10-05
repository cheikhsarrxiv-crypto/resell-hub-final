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
        // Deep Web Sourcing Engine — real, transparent signals computed
        // from this exact result's own fields (see OpportunityRankingService):
        // no availability/condition known and no seller/authenticity
        // evidence -> LOW; authenticityStatus 'claimed' (+5) offset by the
        // one unresolved cost factor (-5) -> 0, clamped.
        qualityTier: 'LOW',
        opportunityScore: 0,
        scoreFactors: ['Authenticity claimed by the seller (not verified) (+5)', '1 unresolved cost factor(s) (-5)'],
        // Opportunity Classification fix — qualityTier 'LOW' alone already
        // gates this to WEB_LEAD, never an automatic VERIFIED_OPPORTUNITY
        // just because source !== 'web'.
        classification: 'WEB_LEAD',
        // Web Sourcing smoke-test fix (section 3) — explicit, derived reason.
        classificationReason: 'listing quality is LOW (availability not confirmed, condition not confirmed)',
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

    it('TEST G/H (Global Web Sourcing, Option A) — the SAME sourceUrl but a DIFFERENT sourceId stays two distinct results, never fused into one: a category page\'s several offers must survive as separate opportunities', async () => {
      const sharedUrl = 'https://www.sellpy.com/store/brand/Nike%20Air%20Max';
      const offerA = fakeResult({ source: 'web', sourceId: 'hash-of-offer-a', sourceUrl: sharedUrl, title: 'Nike Air Max, size 39', price: 24, sharedSourcePage: true });
      const offerB = { ...offerA, sourceId: 'hash-of-offer-b', title: 'Nike Air Max, size 40', price: 34 };
      getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [offerA, offerB] }) })]);

      const response = await SourcingService.search({ query: 'Nike Air Max' });

      expect(response.results).toHaveLength(2);
      expect(response.results.map((r) => r.sourceUrl)).toEqual([sharedUrl, sharedUrl]);
      expect(response.results.map((r) => r.price).sort((a, b) => a - b)).toEqual([24, 34]);
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

  describe('Deep Web Sourcing Engine — price-conflict detection on an otherwise-deduplicated pair', () => {
    it('two results sharing the same (provider, sourceId) but DIFFERENT prices -> kept as one, flagged "conflicting", warning names both prices', async () => {
      const first = fakeResult({ sourceId: 'ITEM-1', sourceUrl: 'https://x/1', price: 34 });
      const duplicate = { ...first, price: 41 };
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [first, duplicate] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(1);
      expect(response.results[0].verificationStatus).toBe('conflicting');
      expect(response.results[0].warnings).toContain(
        'Price conflict: this exact listing was reported as both 34 EUR and 41 EUR by duplicate sources — shown with the first price found; verify before relying on it.'
      );
    });

    it('two results sharing the same (provider, sourceId) and the SAME price -> no conflict, no "conflicting" status', async () => {
      const first = fakeResult({ sourceId: 'ITEM-1', sourceUrl: 'https://x/1', price: 34 });
      const duplicate = { ...first, price: 34 };
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [first, duplicate] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].verificationStatus).toBeUndefined();
    });
  });

  describe('Deep Web Sourcing Engine — advanced "web"-only signal dedup', () => {
    function webOffer(overrides: Record<string, any> = {}) {
      return fakeResult({
        source: 'web',
        sourceId: undefined,
        sourceUrl: `https://a.example/${Math.random()}`, // distinct URL/page per fixture — this dedup pass must catch the match anyway, on signal alone
        brand: 'Nike',
        marketplace: 'vinted',
        price: 50,
        currency: 'EUR',
        ...overrides,
      });
    }

    it('two "web" results with identical marketplace/brand/price/currency/size (both undefined) -> merged to one', async () => {
      const a = webOffer();
      const b = webOffer();
      getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);

      const response = await SourcingService.search({ query: 'Nike' });

      expect(response.results).toHaveLength(1);
    });

    it('two "web" results with DIFFERENT sizes are NEVER merged, even if everything else matches', async () => {
      const a = webOffer({ size: '39' });
      const b = webOffer({ size: '40' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);

      const response = await SourcingService.search({ query: 'Nike' });

      expect(response.results).toHaveLength(2);
    });

    it('one "web" result WITH a size and another with NO size are never merged (never assume the missing one matches)', async () => {
      const a = webOffer({ size: '39' });
      const b = webOffer({ size: undefined });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);

      const response = await SourcingService.search({ query: 'Nike' });

      expect(response.results).toHaveLength(2);
    });

    it('two "web" results with DIFFERENT named sellers are NEVER merged', async () => {
      const a = webOffer({ seller: { name: 'ShopA' } });
      const b = webOffer({ seller: { name: 'ShopB' } });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);

      const response = await SourcingService.search({ query: 'Nike' });

      expect(response.results).toHaveLength(2);
    });

    it('two "web" results with DIFFERENT prices are never merged (a real price difference means a real different offer, or at minimum not confidently the same one)', async () => {
      const a = webOffer({ price: 50 });
      const b = webOffer({ price: 60 });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);

      const response = await SourcingService.search({ query: 'Nike' });

      expect(response.results).toHaveLength(2);
    });

    it('a "web" result with no brand at all is never merged with anything via this pass (no signal to anchor the comparison on)', async () => {
      const a = webOffer({ brand: undefined });
      const b = webOffer({ brand: undefined });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);

      const response = await SourcingService.search({ query: 'Nike' });

      expect(response.results).toHaveLength(2);
    });

    it('eBay/Etsy results are never touched by this pass, even if they would otherwise "match" on signal', async () => {
      const a = fakeResult({ source: 'ebay', sourceId: 'A', sourceUrl: 'https://ebay/a', brand: 'Nike', marketplace: 'EBAY_FR', price: 50, currency: 'EUR' });
      const b = fakeResult({ source: 'ebay', sourceId: 'B', sourceUrl: 'https://ebay/b', brand: 'Nike', marketplace: 'EBAY_FR', price: 50, currency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [a, b] }) })]);

      const response = await SourcingService.search({ query: 'Nike' });

      expect(response.results).toHaveLength(2); // real, distinct eBay listings (different sourceId) — never merged just for sharing brand/price
    });
  });

  describe('Deep Web Sourcing Engine — minQuality filtering (opt-in)', () => {
    it('omitted minQuality: every result is kept regardless of qualityTier — unchanged default behavior', async () => {
      const low = fakeResult({ sourceId: '1', sourceUrl: 'https://x/1' }); // no availability/condition -> LOW
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [low] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(1);
      expect(response.diagnostics.excludedByMinQuality).toBe(0);
    });

    it('minQuality: "HIGH" excludes a LOW-tier result, counted in diagnostics.excludedByMinQuality', async () => {
      const low = fakeResult({ sourceId: '1', sourceUrl: 'https://x/1' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [low] }) })]);

      const response = await SourcingService.search({ query: 'x', minQuality: 'HIGH' });

      expect(response.results).toHaveLength(0);
      expect(response.diagnostics.excludedByMinQuality).toBe(1);
    });

    it('minQuality: "HIGH" keeps a genuinely HIGH-tier result', async () => {
      const high = fakeResult({
        sourceId: '1',
        sourceUrl: 'https://x/1',
        availability: 'IN_STOCK',
        condition: 'used',
        seller: { name: 'shop', feedbackPercentage: 99 },
      });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [high] }) })]);

      const response = await SourcingService.search({ query: 'x', minQuality: 'HIGH' });

      expect(response.results).toHaveLength(1);
      expect(response.results[0].qualityTier).toBe('HIGH');
    });
  });

  describe('Deep Web Sourcing Engine — sort: opportunity_score', () => {
    it('orders results descending by the real, computed opportunityScore', async () => {
      const weak = fakeResult({ sourceId: '1', sourceUrl: 'https://x/1', title: 'Weak' }); // no bonus signals -> low score
      const strong = fakeResult({
        sourceId: '2',
        sourceUrl: 'https://x/2',
        title: 'Strong',
        availability: 'IN_STOCK',
        authenticityStatus: 'verified' as const,
        authenticitySource: 'eBay Authenticity Guarantee',
      });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [weak, strong] }) })]);

      const response = await SourcingService.search({ query: 'x', sort: 'opportunity_score' });

      expect(response.results.map((r) => r.title)).toEqual(['Strong', 'Weak']);
      expect(response.results[0].opportunityScore).toBeGreaterThan(response.results[1].opportunityScore!);
    });
  });

  describe('Deep Web Sourcing Engine — diagnostics (zero/low-result provenance)', () => {
    it('a real, empty outcome reports rawResultsBeforeFiltering: 0 and every exclusion count at 0 — never a guess', async () => {
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay')]);

      const response = await SourcingService.search({ query: 'nothing matches this' });

      expect(response.diagnostics).toEqual({
        rawResultsBeforeFiltering: 0,
        excludedByDeduplication: 0,
        excludedByPriceBound: 0,
        excludedByMinQuality: 0,
        excludedByUnresolvedListingPage: 0,
        excludedByOverallLimit: 0,
        excludedByIrrelevantProduct: 0,
        excludedByNoConfidentPrice: 0,
        rejectedSamples: [],
      });
    });

    it('SOURCE_NOT_CONFIGURED still reports a real (empty) diagnostics object, never omitted', async () => {
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { isConfigured: false })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.diagnostics).toEqual({
        rawResultsBeforeFiltering: 0,
        excludedByDeduplication: 0,
        excludedByPriceBound: 0,
        excludedByMinQuality: 0,
        excludedByUnresolvedListingPage: 0,
        excludedByOverallLimit: 0,
        excludedByIrrelevantProduct: 0,
        excludedByNoConfidentPrice: 0,
        rejectedSamples: [],
      });
    });

    it('a real duplicate is counted in excludedByDeduplication', async () => {
      const first = fakeResult({ sourceId: 'ITEM-1', sourceUrl: 'https://x/1' });
      const duplicate = { ...first };
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [first, duplicate] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.diagnostics.rawResultsBeforeFiltering).toBe(2);
      expect(response.diagnostics.excludedByDeduplication).toBe(1);
    });

    it('a result excluded by an explicit price bound is counted in excludedByPriceBound', async () => {
      const tooExpensive = fakeResult({ sourceId: '1', sourceUrl: 'https://x/1', price: 500, normalizedPriceEur: 500 });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [tooExpensive] }) })]);

      const response = await SourcingService.search({ query: 'x', minPrice: 0, maxPrice: 100, currency: 'EUR' });

      expect(response.results).toHaveLength(0);
      expect(response.diagnostics.excludedByPriceBound).toBe(1);
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

    it('Deep Web Sourcing Engine fix: a result whose price comparison is merely uncertain (no reliable EUR rate) is EXCLUDED — never presented as if it passed a price cap it could not actually be compared against', async () => {
      const uncertain = fakeResult({ sourceId: 'uncertain-1', sourceUrl: 'https://x/uncertain', price: 100, currency: 'JPY' }); // no rate configured in this test env
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [uncertain] }) })]);

      const response = await SourcingService.search({ query: 'x', maxPrice: 400, currency: 'EUR' });

      expect(response.results).toHaveLength(0);
      expect(response.diagnostics.excludedByPriceBound).toBe(1);
    });

    it('no minPrice/maxPrice requested -> nothing is excluded on price grounds', async () => {
      const expensive = fakeResult({ price: 99999, currency: 'EUR' });
      getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [expensive] }) })]);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(1);
    });

    // Deep Web Sourcing Engine fix (mission section 2/8) — exact price
    // acceptance matrix from the brief, maxPrice = 50 EUR throughout.
    describe('price bound matrix (maxPrice = 50 EUR)', () => {
      const run = (price: number, currency: string) => {
        const result = fakeResult({ sourceId: `p-${price}-${currency}`, sourceUrl: `https://x/${price}-${currency}`, price, currency });
        getAllProvidersMock.mockReturnValue([makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);
        return SourcingService.search({ query: 'x', maxPrice: 50, currency: 'EUR' });
      };

      it('40 EUR -> ACCEPT (already in EUR, within bound)', async () => {
        const response = await run(40, 'EUR');
        expect(response.results).toHaveLength(1);
      });

      it('60 EUR -> REJECT (already in EUR, confidently outside bound)', async () => {
        const response = await run(60, 'EUR');
        expect(response.results).toHaveLength(0);
      });

      it('275 USD sans taux fiable configuré -> REJECT / non-comparable (never treated as "under 50 EUR")', async () => {
        const response = await run(275, 'USD');
        expect(response.results).toHaveLength(0);
        expect(response.diagnostics.excludedByPriceBound).toBe(1);
      });

      it('275 USD AVEC un taux fiable configuré -> REJECT (converts to well above 50 EUR, a real comparison, not a guess)', async () => {
        const originalStaticRates = process.env.CURRENCY_STATIC_RATES;
        process.env.CURRENCY_STATIC_RATES = JSON.stringify({ USD_EUR: 0.9 }); // 275 * 0.9 = 247.5 EUR
        try {
          const response = await run(275, 'USD');
          expect(response.results).toHaveLength(0);
        } finally {
          if (originalStaticRates === undefined) delete process.env.CURRENCY_STATIC_RATES;
          else process.env.CURRENCY_STATIC_RATES = originalStaticRates;
        }
      });

      it('40 USD AVEC un taux fiable configuré -> conversion then comparison -> ACCEPT (converts to below 50 EUR)', async () => {
        const originalStaticRates = process.env.CURRENCY_STATIC_RATES;
        process.env.CURRENCY_STATIC_RATES = JSON.stringify({ USD_EUR: 0.9 }); // 40 * 0.9 = 36 EUR
        try {
          const response = await run(40, 'USD');
          expect(response.results).toHaveLength(1);
          expect(response.results[0].normalizedPriceEur).toBeCloseTo(36, 5);
        } finally {
          if (originalStaticRates === undefined) delete process.env.CURRENCY_STATIC_RATES;
          else process.env.CURRENCY_STATIC_RATES = originalStaticRates;
        }
      });

      it('Deep Web Sourcing Engine regression — the exact real production case: 4021 INR, no reliable rate configured -> REJECT, never presented as "under 50 EUR"', async () => {
        const response = await run(4021, 'INR');
        expect(response.results).toHaveLength(0);
        expect(response.diagnostics.excludedByPriceBound).toBe(1);
      });
    });

    // Deep Web Sourcing Engine regression tests — reproduces the exact
    // real production case reported: a "Vintage Nike Air Max 2 Cross
    // Trainer..." result from an Etsy /market/nike_air_max_used page,
    // price 4021 INR, pageType UNKNOWN, no productUrl, kept with only a
    // warning by the previous fix. Both real causes (unconvertible price,
    // AND unresolved listing page) are reproduced independently here so a
    // future regression on either one is caught even if the other were
    // somehow fixed differently.
    describe('Deep Web Sourcing Engine regression — the real "Etsy /market/nike_air_max_used" production case', () => {
      it('the exact real case reproduced end-to-end: 4021 INR + Etsy /market/ page, no reliable rate, no productUrl -> excluded on BOTH grounds', async () => {
        const result = fakeResult({
          source: 'web',
          sourceId: 'etsy-market-nike-air-max-used',
          sourceUrl: 'https://www.etsy.com/market/nike_air_max_used',
          title: 'Vintage Nike Air Max 2 Cross Trainer Sneakers Black White',
          brand: 'Nike',
          price: 4021,
          currency: 'INR',
          pageType: 'UNKNOWN' as const,
          productUrl: undefined,
        });
        getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

        const response = await SourcingService.search({ query: 'Nike Air Max', condition: 'used', maxPrice: 50, currency: 'EUR' });

        expect(response.results).toHaveLength(0);
        // Price is checked before the listing-page check in the pipeline,
        // so this specific case is counted under price — the dedicated
        // isUnresolvedListingPage unit tests (OpportunityRankingService
        // test file) independently confirm the listing-page exclusion
        // itself fires on this exact URL/pageType/productUrl combination.
        expect(response.diagnostics.excludedByPriceBound).toBe(1);
      });

      it('an Etsy /market/... page with NO productUrl is excluded even when its price IS reliably comparable and within budget — the page-type problem is independent of the price problem', async () => {
        const result = fakeResult({
          source: 'web',
          sourceId: 'etsy-market-nike-air-max-used-eur',
          sourceUrl: 'https://www.etsy.com/market/nike_air_max_used',
          title: 'Nike Air Max 90 used',
          brand: 'Nike',
          price: 30,
          currency: 'EUR',
          pageType: 'UNKNOWN' as const,
          productUrl: undefined,
        });
        getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

        const response = await SourcingService.search({ query: 'Nike Air Max', maxPrice: 50, currency: 'EUR' });

        expect(response.results).toHaveLength(0);
        expect(response.diagnostics.excludedByUnresolvedListingPage).toBe(1);
      });

      it('a real Nike Air Max offer with a direct EUR price within maxPrice is ALWAYS accepted — the fix never over-rejects a genuine, well-formed offer', async () => {
        const result = fakeResult({
          source: 'web',
          sourceId: 'real-nike-air-max-90',
          sourceUrl: 'https://www.vinted.fr/items/123-nike-air-max-90',
          title: 'Nike Air Max 90 used size 42',
          brand: 'Nike',
          price: 40,
          currency: 'EUR',
          pageType: 'PRODUCT_PAGE' as const,
        });
        getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

        const response = await SourcingService.search({ query: 'Nike Air Max', condition: 'used', maxPrice: 50, currency: 'EUR' });

        expect(response.results).toHaveLength(1);
        expect(response.results[0].sourceUrl).toBe('https://www.vinted.fr/items/123-nike-air-max-90');
      });

      // Deep Web Sourcing Engine regression — the exact second real
      // production case reported: a Foot Locker category page result WITH
      // a real productUrl (so the listing-page rule correctly leaves it
      // candidate, per point 6 of this fix's own brief) but priced in USD
      // with no reliable rate configured — this must be excluded on price
      // grounds alone, independent of the (already-correct) page-type rule.
      it('169.99 USD, target currency EUR, no reliable rate configured -> REJECT, even though productUrl is present and the page would otherwise stay candidate', async () => {
        const result = fakeResult({
          source: 'web',
          sourceId: 'footlocker-nike-air-max-95-big-bubble',
          sourceUrl: 'https://www.footlocker.com/category/sale/shoes/nike/air-max.html',
          title: 'Nike Air Max 95 Big Bubble',
          brand: 'Nike',
          price: 169.99,
          currency: 'USD',
          pageType: 'UNKNOWN' as const,
          productUrl: '/product/nike-air-max-95-big-bubble-mens/B6830602.html',
        });
        getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

        const response = await SourcingService.search({ query: 'Nike Air Max', condition: 'used', maxPrice: 50, currency: 'EUR' });

        expect(response.results).toHaveLength(0);
        expect(response.diagnostics.excludedByPriceBound).toBe(1);
        // Confirms the listing-page rule genuinely did NOT fire here (the
        // productUrl correctly keeps it out of that exclusion bucket) —
        // price is the ONLY reason this is rejected, proving point 6 of
        // the brief (don't touch the already-correct productUrl rule).
        expect(response.diagnostics.excludedByUnresolvedListingPage).toBe(0);
      });

      it('40 USD with a reliable USD->EUR rate configured -> converted then compared to maxPrice 50 EUR -> ACCEPT', async () => {
        const originalStaticRates = process.env.CURRENCY_STATIC_RATES;
        process.env.CURRENCY_STATIC_RATES = JSON.stringify({ USD_EUR: 0.9 }); // 40 * 0.9 = 36 EUR
        try {
          const result = fakeResult({
            source: 'web',
            sourceId: 'footlocker-nike-air-max-cheap',
            sourceUrl: 'https://www.footlocker.com/category/sale/shoes/nike/air-max.html',
            title: 'Nike Air Max 90',
            brand: 'Nike',
            price: 40,
            currency: 'USD',
            pageType: 'UNKNOWN' as const,
            productUrl: '/product/nike-air-max-90/A1234.html',
          });
          getAllProvidersMock.mockReturnValue([makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) })]);

          const response = await SourcingService.search({ query: 'Nike Air Max', condition: 'used', maxPrice: 50, currency: 'EUR' });

          expect(response.results).toHaveLength(1);
          expect(response.results[0].normalizedPriceEur).toBeCloseTo(36, 5);
        } finally {
          if (originalStaticRates === undefined) delete process.env.CURRENCY_STATIC_RATES;
          else process.env.CURRENCY_STATIC_RATES = originalStaticRates;
        }
      });
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

    it('TEST I (Global Web Sourcing, Option A) — multiple offers from the same category page still go through the EXISTING price filter unchanged: <50 EUR keeps 24/34/41, eliminates 50.50', async () => {
      const sharedUrl = 'https://www.sellpy.com/store/brand/Nike%20Air%20Max';
      const offer24 = fakeResult({ source: 'web', sourceId: 'offer-24', sourceUrl: sharedUrl, price: 24, currency: 'EUR', sharedSourcePage: true });
      const offer34 = { ...offer24, sourceId: 'offer-34', price: 34 };
      const offer41 = { ...offer24, sourceId: 'offer-41', price: 41 };
      const offer50_50 = { ...offer24, sourceId: 'offer-50-50', price: 50.5 };
      getAllProvidersMock.mockReturnValue([
        makeFakeProvider('web', { searchProducts: vi.fn().mockResolvedValue({ results: [offer24, offer34, offer41, offer50_50] }) }),
      ]);

      const response = await SourcingService.search({ query: 'Nike Air Max', maxPrice: 50, currency: 'EUR' });

      expect(response.results.map((r) => r.price).sort((a, b) => a - b)).toEqual([24, 34, 41]);
      expect(response.results.some((r) => r.price === 50.5)).toBe(false);
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

describe('SourcingService.search — Opportunity Classification fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches classification VERIFIED_OPPORTUNITY to a kept result that meets every signal (quality HIGH, no unresolved color/size)', async () => {
    const result = fakeResult({
      availability: 'IN_STOCK',
      condition: 'used',
      seller: { name: 'shop', feedbackScore: 10 },
      authenticityStatus: 'verified',
      authenticitySource: 'eBay Authenticity Guarantee',
    });
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x' });

    expect(response.results[0].qualityTier).toBe('HIGH');
    expect(response.results[0].classification).toBe('VERIFIED_OPPORTUNITY');
  });

  it('attaches classification WEB_LEAD when qualityTier is not HIGH — never an automatic VERIFIED_OPPORTUNITY for a non-web source', async () => {
    const result = fakeResult(); // LOW quality by construction (no availability/condition/seller/authenticity evidence)
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x' });

    expect(response.results[0].classification).toBe('WEB_LEAD');
  });

  it('a color explicitly incompatible with the request is REJECTED — never present in results[], counted in excludedByIrrelevantProduct, sampled in rejectedSamples', async () => {
    const result = fakeResult({ color: 'Black' });
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x', color: 'white' });

    expect(response.results).toEqual([]);
    expect(response.diagnostics.excludedByIrrelevantProduct).toBe(1);
    expect(response.diagnostics.rejectedSamples).toEqual([
      expect.objectContaining({ title: 'Item', url: 'https://x', reason: expect.stringContaining('does not match') }),
    ]);
  });

  it('an ambiguous color (Black/White searching white) is KEPT as WEB_LEAD, never rejected and never a confirmed matchReason', async () => {
    const result = fakeResult({ color: 'Black/White' });
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x', color: 'white' });

    expect(response.results).toHaveLength(1);
    expect(response.results[0].classification).toBe('WEB_LEAD');
    expect(response.diagnostics.excludedByIrrelevantProduct).toBe(0);
  });

  it('merges provider-level rejectedCounts/rejectedSamples (e.g. from WebSourcingProvider) into its own diagnostics', async () => {
    const web = makeFakeProvider('web', {
      searchProducts: vi.fn().mockResolvedValue({
        results: [],
        rejectedCounts: { irrelevantProduct: 2, noConfidentPrice: 3 },
        rejectedSamples: [{ title: 'Kids variant', url: 'https://y/1', reason: 'kids segment excluded' }],
      }),
    });
    getAllProvidersMock.mockReturnValue([web]);

    const response = await SourcingService.search({ query: 'Nike Air Force 1' });

    expect(response.diagnostics.excludedByIrrelevantProduct).toBe(2);
    expect(response.diagnostics.excludedByNoConfidentPrice).toBe(3);
    expect(response.diagnostics.rejectedSamples).toEqual([{ title: 'Kids variant', url: 'https://y/1', reason: 'kids segment excluded' }]);
  });

  it('rejectedSamples is bounded to 20 total, across every rejection source combined', async () => {
    const manySamples = Array.from({ length: 15 }, (_, i) => ({ title: `t${i}`, url: `https://y/${i}`, reason: 'r' }));
    const web = makeFakeProvider('web', {
      searchProducts: vi.fn().mockResolvedValue({ results: [], rejectedCounts: {}, rejectedSamples: manySamples }),
    });
    // 10 more results, each individually color-rejected by SourcingService itself (on top of the provider's own 15 samples).
    const extraRejected = Array.from({ length: 10 }, (_, i) => fakeResult({ sourceUrl: `https://z/${i}`, color: 'black' }));
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: extraRejected }) });
    getAllProvidersMock.mockReturnValue([web, ebay]);

    const response = await SourcingService.search({ query: 'x', color: 'white' });

    expect(response.diagnostics.rejectedSamples.length).toBe(20);
  });
});

describe('SourcingService.search — attachLandedCost (Web Sourcing smoke-test fix, section 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('USD price with no reliable FX rate AND no reported shipping -> BOTH unknownCostFactors are reported, never just one', async () => {
    const result = fakeResult({ price: 700, currency: 'USD' }); // no shippingCost at all
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x' });

    expect(response.results).toHaveLength(1);
    const r = response.results[0];
    expect(r.normalizedPriceEur).toBeUndefined();
    expect(r.estimatedKnownCostEur).toBeUndefined();
    expect(r.unknownCostFactors).toEqual(expect.arrayContaining(['currency_conversion_unavailable', 'shipping_unknown']));
    expect(r.unknownCostFactors).toHaveLength(2);
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('could not be converted to EUR (no reliable exchange rate available)'),
        expect.stringContaining("this listing's shipping cost is not reported"),
      ])
    );
  });

  it('USD price with no reliable FX rate but a REPORTED shipping cost -> only currency_conversion_unavailable, shippingCostEur still unresolved (no rate for it either in this test)', async () => {
    const result = fakeResult({ price: 700, currency: 'USD', shippingCost: 20, shippingCostCurrency: 'USD' });
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x' });

    const r = response.results[0];
    expect(r.estimatedKnownCostEur).toBeUndefined();
    // Both the price AND the shipping cost fail to convert (same missing
    // USD->EUR rate) — pushUnique means the factor appears once, not twice.
    expect(r.unknownCostFactors).toEqual(['currency_conversion_unavailable']);
  });

  it('EUR price with no reported shipping still works exactly as before (non-regression)', async () => {
    const result = fakeResult({ price: 100, currency: 'EUR' });
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x' });

    const r = response.results[0];
    expect(r.normalizedPriceEur).toBe(100);
    expect(r.estimatedKnownCostEur).toBeUndefined();
    expect(r.unknownCostFactors).toEqual(['shipping_unknown']);
  });

  it('EUR price WITH a reported shipping cost -> estimatedKnownCostEur fully computed (non-regression, the fully-resolved path)', async () => {
    const result = fakeResult({ price: 100, currency: 'EUR', shippingCost: 10, shippingCostCurrency: 'EUR' });
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x' });

    const r = response.results[0];
    expect(r.estimatedKnownCostEur).toBe(110);
    expect(r.unknownCostFactors).toBeUndefined();
  });
});

describe('SourcingService.search — classificationReason (Web Sourcing smoke-test fix, section 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('qualityTier MEDIUM -> WEB_LEAD with an explicit reason naming the missing signal(s)', async () => {
    const result = fakeResult({ availability: 'IN_STOCK' }); // availability known, condition/seller/authenticity evidence not -> MEDIUM
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x' });

    expect(response.results[0].qualityTier).toBe('MEDIUM');
    expect(response.results[0].classification).toBe('WEB_LEAD');
    expect(response.results[0].classificationReason).toMatch(/listing quality is MEDIUM/);
    expect(response.results[0].classificationReason).toMatch(/condition not confirmed/);
  });

  it('ambiguous requested color -> WEB_LEAD with a color-specific reason', async () => {
    const result = fakeResult({ color: 'Black/White', availability: 'IN_STOCK', condition: 'used', seller: { name: 's', feedbackScore: 5 } }); // HIGH quality otherwise
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x', color: 'white' });

    expect(response.results[0].qualityTier).toBe('HIGH');
    expect(response.results[0].classification).toBe('WEB_LEAD');
    expect(response.results[0].classificationReason).toMatch(/color only partially confirmed/);
    expect(response.results[0].classificationReason).not.toMatch(/listing quality/); // quality was HIGH, not the reason here
  });

  it('requested size absent/different -> WEB_LEAD with a size-specific reason', async () => {
    const absentResult = fakeResult({ availability: 'IN_STOCK', condition: 'used', seller: { name: 's', feedbackScore: 5 } });
    const ebay1 = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [absentResult] }) });
    getAllProvidersMock.mockReturnValue([ebay1]);
    const r1 = await SourcingService.search({ query: 'x', size: '42' });
    expect(r1.results[0].classificationReason).toMatch(/requested size not confirmed/);

    vi.clearAllMocks();
    const differentResult = fakeResult({ size: '43', availability: 'IN_STOCK', condition: 'used', seller: { name: 's', feedbackScore: 5 } });
    const ebay2 = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [differentResult] }) });
    getAllProvidersMock.mockReturnValue([ebay2]);
    const r2 = await SourcingService.search({ query: 'x', size: '42' });
    expect(r2.results[0].classificationReason).toMatch(/reported size differs/);
  });

  it('HIGH quality with every requested signal confirmed -> VERIFIED_OPPORTUNITY, classificationReason undefined (nothing to explain)', async () => {
    const result = fakeResult({ color: 'White', size: '42', availability: 'IN_STOCK', condition: 'used', seller: { name: 's', feedbackScore: 5 } });
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x', color: 'white', size: '42' });

    expect(response.results[0].qualityTier).toBe('HIGH');
    expect(response.results[0].classification).toBe('VERIFIED_OPPORTUNITY');
    expect(response.results[0].classificationReason).toBeUndefined();
  });

  it('a REJECTED candidate (incompatible color) never appears in results[] at all — classification/classificationReason are moot for it', async () => {
    const result = fakeResult({ color: 'Black' });
    const ebay = makeFakeProvider('ebay', { searchProducts: vi.fn().mockResolvedValue({ results: [result] }) });
    getAllProvidersMock.mockReturnValue([ebay]);

    const response = await SourcingService.search({ query: 'x', color: 'white' });

    expect(response.results).toEqual([]);
    expect(response.results.some((r: any) => r.classification === 'REJECTED')).toBe(false);
  });
});
