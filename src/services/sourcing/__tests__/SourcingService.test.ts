/**
 * Real behavioral tests for SourcingService — the aggregation layer
 * between the search_products tool and individual providers. Mocks
 * EbayBrowseSourcingProvider (the only registered provider today) to
 * prove SourcingService's own contract: SOURCE_NOT_CONFIGURED when
 * nothing is configured, real aggregation when something is, and errors
 * surfaced rather than swallowed — independent of eBay specifics, which
 * are already covered in EbayBrowseSourcingProvider.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const isConfiguredMock = vi.fn();
const searchProductsMock = vi.fn();

vi.mock('@/services/sourcing/providers/EbayBrowseSourcingProvider', () => ({
  EbayBrowseSourcingProvider: class {
    name = 'ebay';
    isConfigured = isConfiguredMock;
    searchProducts = searchProductsMock;
    getProductDetails = vi.fn();
  },
}));

import { SourcingService } from '@/services/sourcing/SourcingService';

describe('SourcingService.search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no provider configured -> SOURCE_NOT_CONFIGURED, empty results, no provider ever queried', async () => {
    isConfiguredMock.mockReturnValue(false);

    const response = await SourcingService.search({ query: 'Prada sneakers' });

    expect(response.status).toBe('SOURCE_NOT_CONFIGURED');
    expect(response.results).toEqual([]);
    expect(response.providerErrors).toEqual([]);
    expect(searchProductsMock).not.toHaveBeenCalled();
  });

  it('a configured provider is queried and its results are returned as-is (plus a real EUR->EUR normalizedPriceEur)', async () => {
    isConfiguredMock.mockReturnValue(true);
    const fakeResult = { source: 'ebay', sourceUrl: 'https://x', title: 'Item', price: 10, currency: 'EUR', marketplace: 'EBAY_FR', images: [], authenticityStatus: 'claimed' as const };
    searchProductsMock.mockResolvedValue({ results: [fakeResult] });

    const response = await SourcingService.search({ query: 'Prada sneakers' });

    expect(response.status).toBe('ok');
    // Same currency (EUR->EUR) is the 'identical_currency' tier of
    // CurrencyConversionService — a real, always-correct rate of 1, not
    // a network call — so normalizedPriceEur === price here.
    expect(response.results).toEqual([{ ...fakeResult, normalizedPriceEur: 10 }]);
    expect(response.providerErrors).toEqual([]);
    expect(response.totalResults).toBe(1);
  });

  it('never fabricates a result: an empty provider response stays an empty result set', async () => {
    isConfiguredMock.mockReturnValue(true);
    searchProductsMock.mockResolvedValue({ results: [] });

    const response = await SourcingService.search({ query: 'nothing matches this' });

    expect(response.status).toBe('ok');
    expect(response.results).toEqual([]);
  });

  it("a provider's structured error is surfaced in providerErrors, not swallowed", async () => {
    isConfiguredMock.mockReturnValue(true);
    searchProductsMock.mockResolvedValue({
      results: [],
      error: { provider: 'ebay', message: 'eBay search failed with status 500', kind: 'upstream_error' },
    });

    const response = await SourcingService.search({ query: 'x' });

    expect(response.status).toBe('ok');
    expect(response.providerErrors).toEqual([
      { provider: 'ebay', message: 'eBay search failed with status 500', kind: 'upstream_error' },
    ]);
  });

  it("a provider that throws instead of returning a structured error is still caught, not fatal to the whole search", async () => {
    isConfiguredMock.mockReturnValue(true);
    searchProductsMock.mockRejectedValue(new Error('unexpected bug in provider'));

    const response = await SourcingService.search({ query: 'x' });

    expect(response.status).toBe('ok');
    expect(response.results).toEqual([]);
    expect(response.providerErrors).toHaveLength(1);
    expect(response.providerErrors[0].provider).toBe('ebay');
  });

  describe('Global Sourcing Engine — provider provenance tracking', () => {
    it('a configured, queried provider is listed in providersSearched, never in providersUnavailable', async () => {
      isConfiguredMock.mockReturnValue(true);
      searchProductsMock.mockResolvedValue({ results: [] });

      const response = await SourcingService.search({ query: 'x' });

      expect(response.providersSearched).toEqual(['ebay']);
      expect(response.providersUnavailable).toEqual([]);
      expect(response.providersFailed).toEqual([]);
    });

    it('an unconfigured provider is listed in providersUnavailable, never queried, never in providersSearched', async () => {
      isConfiguredMock.mockReturnValue(false);

      const response = await SourcingService.search({ query: 'x' });

      expect(response.providersUnavailable).toEqual(['ebay']);
      expect(response.providersSearched).toEqual([]);
    });

    it('a provider whose call produced a structured error is listed in providersFailed', async () => {
      isConfiguredMock.mockReturnValue(true);
      searchProductsMock.mockResolvedValue({
        results: [],
        error: { provider: 'ebay', message: 'boom', kind: 'upstream_error' },
      });

      const response = await SourcingService.search({ query: 'x' });

      expect(response.providersFailed).toEqual(['ebay']);
      expect(response.providersSearched).toEqual(['ebay']);
    });

    it('a provider that returns zero results (no error) is NOT listed in providersFailed — an empty outcome is not a failure', async () => {
      isConfiguredMock.mockReturnValue(true);
      searchProductsMock.mockResolvedValue({ results: [] });

      const response = await SourcingService.search({ query: 'x' });

      expect(response.providersFailed).toEqual([]);
    });
  });

  describe('Global Sourcing Engine — deduplication (conservative, exact-identifier only)', () => {
    it('two results sharing the same (provider, sourceId) are deduplicated to one — first occurrence wins', async () => {
      isConfiguredMock.mockReturnValue(true);
      const first = { source: 'ebay', sourceId: 'ITEM-1', sourceUrl: 'https://x/1', title: 'First seen', price: 10, currency: 'EUR', marketplace: 'EBAY_FR', images: [], authenticityStatus: 'claimed' as const };
      const duplicate = { ...first, title: 'Same item, duplicate entry', sourceUrl: 'https://x/1?ref=other' };
      searchProductsMock.mockResolvedValue({ results: [first, duplicate] });

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(1);
      expect(response.results[0].title).toBe('First seen');
      expect(response.totalResults).toBe(1);
    });

    it('two results with different sourceIds are NEVER merged, even if everything else matches — different annonces stay different', async () => {
      isConfiguredMock.mockReturnValue(true);
      const a = { source: 'ebay', sourceId: 'ITEM-1', sourceUrl: 'https://x/1', title: 'Same title', price: 10, currency: 'EUR', marketplace: 'EBAY_FR', images: [], authenticityStatus: 'claimed' as const };
      const b = { ...a, sourceId: 'ITEM-2', sourceUrl: 'https://x/2' };
      searchProductsMock.mockResolvedValue({ results: [a, b] });

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(2);
    });

    it('results with no sourceId fall back to exact sourceUrl matching for dedup', async () => {
      isConfiguredMock.mockReturnValue(true);
      const first = { source: 'ebay', sourceUrl: 'https://x/same', title: 'A', price: 10, currency: 'EUR', marketplace: 'EBAY_FR', images: [], authenticityStatus: 'claimed' as const };
      const duplicate = { ...first, title: 'B' };
      searchProductsMock.mockResolvedValue({ results: [first, duplicate] });

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(1);
    });

    it('results with no sourceId and different sourceUrls are never merged', async () => {
      isConfiguredMock.mockReturnValue(true);
      const a = { source: 'ebay', sourceUrl: 'https://x/1', title: 'A', price: 10, currency: 'EUR', marketplace: 'EBAY_FR', images: [], authenticityStatus: 'claimed' as const };
      const b = { ...a, sourceUrl: 'https://x/2' };
      searchProductsMock.mockResolvedValue({ results: [a, b] });

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results).toHaveLength(2);
    });
  });

  describe('Global Sourcing Engine — currency normalization', () => {
    it('a result whose currency has no available rate keeps normalizedPriceEur undefined — never a guessed conversion', async () => {
      isConfiguredMock.mockReturnValue(true);
      // No CURRENCY_STATIC_RATES/FRANKFURTER_FX_ENABLED configured in this
      // test environment -> CurrencyConversionService.convert() genuinely
      // resolves to 'unavailable' for a non-EUR pair, exactly like a real
      // deployment without FX configured.
      const fakeResult = { source: 'ebay', sourceUrl: 'https://x', title: 'Item', price: 100, currency: 'JPY', marketplace: 'EBAY_US', images: [], authenticityStatus: 'claimed' as const };
      searchProductsMock.mockResolvedValue({ results: [fakeResult] });

      const response = await SourcingService.search({ query: 'x' });

      expect(response.results[0].normalizedPriceEur).toBeUndefined();
      expect(response.results[0].price).toBe(100);
      expect(response.results[0].currency).toBe('JPY');
    });
  });
});
