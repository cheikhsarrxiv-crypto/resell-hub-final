/**
 * Real behavioral tests for EbayBrowseSourcingProvider. Never calls the
 * real eBay endpoint: EbayApplicationTokenManager and global.fetch are
 * both mocked. Proves the provider only ever returns what a mocked
 * response actually contained — no fabricated result, no invented field.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/sourcing/providers/EbayApplicationTokenManager', () => ({
  EbayApplicationTokenManager: {
    isConfigured: vi.fn(),
    getAccessToken: vi.fn(),
  },
  EbayApplicationTokenAuthError: class EbayApplicationTokenAuthError extends Error {},
  EbayApplicationTokenTimeoutError: class EbayApplicationTokenTimeoutError extends Error {},
}));

import { EbayApplicationTokenManager } from '@/services/sourcing/providers/EbayApplicationTokenManager';
import { EbayBrowseSourcingProvider } from '@/services/sourcing/providers/EbayBrowseSourcingProvider';

function searchResponse(itemSummaries: any[], overrides: Record<string, any> = {}) {
  return { ok: true, status: 200, json: async () => ({ itemSummaries, total: itemSummaries.length, ...overrides }) } as any;
}

const realItem = {
  itemId: 'v1|111|0',
  title: 'Prada Sneakers Size 42',
  price: { value: '450.00', currency: 'GBP' },
  itemWebUrl: 'https://www.ebay.co.uk/itm/111',
  image: { imageUrl: 'https://img.ebay.com/main.jpg' },
  additionalImages: [{ imageUrl: 'https://img.ebay.com/extra1.jpg' }],
  condition: 'Pre-owned',
  estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK' }],
  seller: { username: 'shoe_reseller_uk', feedbackScore: 4213, feedbackPercentage: '99.4' },
  qualifiedPrograms: [],
};

describe('EbayBrowseSourcingProvider.isConfigured', () => {
  it('mirrors EbayApplicationTokenManager.isConfigured', () => {
    (EbayApplicationTokenManager.isConfigured as any).mockReturnValue(false);
    expect(new EbayBrowseSourcingProvider().isConfigured()).toBe(false);

    (EbayApplicationTokenManager.isConfigured as any).mockReturnValue(true);
    expect(new EbayBrowseSourcingProvider().isConfigured()).toBe(true);
  });
});

describe('EbayBrowseSourcingProvider.searchProducts', () => {
  let provider: EbayBrowseSourcingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new EbayBrowseSourcingProvider();
    (EbayApplicationTokenManager.getAccessToken as any).mockResolvedValue('app-token-abc');
  });

  it('simple search: returns exactly what the mocked eBay response contained, nothing invented', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([realItem]));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await provider.searchProducts({ query: 'Prada sneakers' });

    expect(outcome.results).toHaveLength(1);
    const result = outcome.results[0];
    expect(result.source).toBe('ebay');
    expect(result.sourceId).toBe('v1|111|0');
    expect(result.sourceUrl).toBe('https://www.ebay.co.uk/itm/111');
    expect(result.title).toBe('Prada Sneakers Size 42');
  });

  it('preserves the original price and currency without converting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([realItem])));

    const outcome = await provider.searchProducts({ query: 'Prada sneakers', marketplaces: ['EBAY_GB'] });

    expect(outcome.results[0].price).toBe(450);
    expect(outcome.results[0].currency).toBe('GBP');
  });

  it('records which marketplace a result actually came from', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([realItem])));

    const outcome = await provider.searchProducts({ query: 'Prada sneakers', marketplaces: ['EBAY_GB'] });

    expect(outcome.results[0].marketplace).toBe('EBAY_GB');
  });

  it('collects images (main + additional), never invents one when absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([realItem])));
    const withImages = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(withImages.images).toEqual(['https://img.ebay.com/main.jpg', 'https://img.ebay.com/extra1.jpg']);

    const noImageItem = { ...realItem, image: undefined, additionalImages: undefined };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([noImageItem])));
    const withoutImages = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(withoutImages.images).toEqual([]);
  });

  it('includes seller info when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([realItem])));
    const result = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(result.seller).toEqual({ name: 'shoe_reseller_uk', feedbackScore: 4213, feedbackPercentage: 99.4 });
  });

  it('authenticityStatus: a normal listing (no AUTHENTICITY_GUARANTEE) is "claimed", never "verified"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([realItem])));
    const result = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(result.authenticityStatus).toBe('claimed');
    expect(result.authenticitySource).toContain('not independently verified');
  });

  it('authenticityStatus: qualifiedPrograms containing AUTHENTICITY_GUARANTEE -> "verified", with the mechanism documented', async () => {
    const guaranteedItem = { ...realItem, qualifiedPrograms: ['AUTHENTICITY_GUARANTEE'] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([guaranteedItem])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.authenticityStatus).toBe('verified');
    expect(result.authenticitySource).toContain('Authenticity Guarantee');
    expect(result.authenticitySource).toContain('after purchase');
  });

  it('authenticityStatus: an item with no usable title -> "unverified"', async () => {
    const emptyItem = { ...realItem, title: '', qualifiedPrograms: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([emptyItem])));
    const result = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(result.authenticityStatus).toBe('unverified');
  });

  it('multi-marketplace: queries each requested marketplace and tags results with the correct one', async () => {
    const gbItem = { ...realItem, itemId: 'gb-1' };
    const frItem = { ...realItem, itemId: 'fr-1', price: { value: '520.00', currency: 'EUR' } };
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const marketplace = init.headers['X-EBAY-C-MARKETPLACE-ID'];
      if (marketplace === 'EBAY_GB') return searchResponse([gbItem]);
      if (marketplace === 'EBAY_FR') return searchResponse([frItem]);
      return searchResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await provider.searchProducts({ query: 'Prada sneakers', marketplaces: ['EBAY_GB', 'EBAY_FR'] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.results).toHaveLength(2);
    const gbResult = outcome.results.find((r) => r.sourceId === 'gb-1')!;
    const frResult = outcome.results.find((r) => r.sourceId === 'fr-1')!;
    expect(gbResult.marketplace).toBe('EBAY_GB');
    expect(gbResult.currency).toBe('GBP');
    expect(frResult.marketplace).toBe('EBAY_FR');
    expect(frResult.currency).toBe('EUR');
  });

  it('worldwide=true searches every supported marketplace, ignoring a narrower `marketplaces` list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'x', worldwide: true, marketplaces: ['EBAY_FR'] });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const queriedMarketplaces = fetchMock.mock.calls.map(([, init]: any) => init.headers['X-EBAY-C-MARKETPLACE-ID']);
    expect(new Set(queriedMarketplaces)).toEqual(new Set(['EBAY_FR', 'EBAY_GB', 'EBAY_DE', 'EBAY_IT', 'EBAY_ES', 'EBAY_US']));
  });

  it('worldwide=false (default) still respects an explicit `marketplaces` list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'x', marketplaces: ['EBAY_FR'] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an unsupported marketplace ID -> no eBay call, structured error returned', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await provider.searchProducts({ query: 'x', marketplaces: ['EBAY_XX' as any] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.results).toEqual([]);
    expect(outcome.error?.message).toContain('No supported eBay marketplace');
  });

  it('no results from eBay -> empty array, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([])));
    const outcome = await provider.searchProducts({ query: 'a very specific item nobody sells' });
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toBeUndefined();
  });

  it('pagination: forwards limit/offset to the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'x', limit: 5, offset: 10 });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('limit=5');
    expect(url).toContain('offset=10');
  });

  it('condition "new" -> sends the confirmed conditions:{NEW} filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'x', condition: 'new' });

    const [url] = fetchMock.mock.calls[0];
    expect(decodeURIComponent(url)).toContain('conditions:{NEW}');
  });

  it('condition "refurbished" -> sends NO condition filter (unverified token, documented, not guessed)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'x', condition: 'refurbished' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain('conditions');
  });

  it('price range with currency -> sends the confirmed price:[min..max],priceCurrency:XXX filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'x', minPrice: 100, maxPrice: 600, currency: 'EUR' });

    const [url] = fetchMock.mock.calls[0];
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('price:[100..600]');
    expect(decoded).toContain('priceCurrency:EUR');
  });

  it('eBay API error response -> structured error, no fabricated results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ errors: [{ message: 'eBay internal error' }] }) })
    );

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
    expect(outcome.error).toEqual({ provider: 'ebay', message: 'eBay internal error', kind: 'upstream_error' });
  });

  it('a 401 from eBay -> classified as an auth error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const outcome = await provider.searchProducts({ query: 'x' });
    expect(outcome.error?.kind).toBe('auth');
  });

  it('a 429 from eBay -> classified as a rate_limit error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    const outcome = await provider.searchProducts({ query: 'x' });
    expect(outcome.error?.kind).toBe('rate_limit');
  });

  it('a request timeout -> classified as a timeout error, no fabricated results', async () => {
    const timeoutError = new Error('aborted');
    timeoutError.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
    expect(outcome.error?.kind).toBe('timeout');
  });
});

describe('EbayBrowseSourcingProvider — price validation (Phase 9 fix of the Phase 8 HIGH finding)', () => {
  let provider: EbayBrowseSourcingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new EbayBrowseSourcingProvider();
    (EbayApplicationTokenManager.getAccessToken as any).mockResolvedValue('app-token-abc');
  });

  /**
   * Phase 8 found that a missing/malformed item.price was defaulted to
   * price=0, currency='USD' — a fabricated value, inconsistent with
   * extractShippingCost's own "absent ≠ zero" handling in this same file.
   * Phase 9 fixes this by excluding any item without an exploitable price
   * from the results entirely, rather than ever inventing a number.
   */

  it('item with no price object at all -> excluded from results, never price=0/USD', async () => {
    const itemWithNoPrice = { ...realItem, price: undefined };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithNoPrice])));

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
    expect(outcome.error).toBeUndefined(); // not an error — just nothing usable to return
  });

  it('item with price.value missing -> excluded from results', async () => {
    const itemWithNoValue = { ...realItem, price: { currency: 'GBP' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithNoValue])));

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
  });

  it('item with price.currency missing -> excluded from results', async () => {
    const itemWithNoCurrency = { ...realItem, price: { value: '450.00' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithNoCurrency])));

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
  });

  it('non-numeric price.value ("abc") -> excluded from results', async () => {
    const itemWithBadPrice = { ...realItem, price: { value: 'abc', currency: 'GBP' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithBadPrice])));

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
  });

  it('price.value = "500", currency = "GBP" -> kept, 500 GBP exactly', async () => {
    const item = { ...realItem, price: { value: '500', currency: 'GBP' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([item])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.price).toBe(500);
    expect(result.currency).toBe('GBP');
  });

  it('price.value = "0", currency = "GBP" -> kept as a real, explicitly-provided 0, never treated as missing', async () => {
    const item = { ...realItem, price: { value: '0', currency: 'GBP' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([item])));

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].price).toBe(0);
    expect(outcome.results[0].currency).toBe('GBP');
  });

  it('shipping absent is unaffected by the price fix — still undefined, never 0', async () => {
    const item = { ...realItem, price: { value: '500', currency: 'GBP' } };
    delete (item as any).shippingOptions;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([item])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBeUndefined();
  });

  it('shipping = 0 is unaffected by the price fix — still a real, kept 0', async () => {
    const item = {
      ...realItem,
      price: { value: '500', currency: 'GBP' },
      shippingOptions: [{ shippingCost: { value: '0.00', currency: 'GBP' } }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([item])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBe(0);
  });

  it('a mix of valid and invalid items -> only the items with an exploitable price are returned', async () => {
    const validItem = { ...realItem, itemId: 'valid-1', price: { value: '500', currency: 'GBP' } };
    const noPriceItem = { ...realItem, itemId: 'invalid-1', price: undefined };
    const badPriceItem = { ...realItem, itemId: 'invalid-2', price: { value: '500abc', currency: 'GBP' } };
    const anotherValidItem = { ...realItem, itemId: 'valid-2', price: { value: '0', currency: 'EUR' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([validItem, noPriceItem, badPriceItem, anotherValidItem])));

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results.map((r) => r.sourceId)).toEqual(['valid-1', 'valid-2']);
  });

  describe('strict numeric validation of price.value (parseFloat is not enough)', () => {
    const cases: Array<{ label: string; value: unknown; expectKept: boolean; expectedAmount?: number }> = [
      { label: '"500"', value: '500', expectKept: true, expectedAmount: 500 },
      { label: '"500.50"', value: '500.50', expectKept: true, expectedAmount: 500.5 },
      { label: '"0"', value: '0', expectKept: true, expectedAmount: 0 },
      { label: '"abc"', value: 'abc', expectKept: false },
      // parseFloat("500abc") === 500 — this is exactly the silent
      // truncation this fix must reject, never treat as a real 500.
      { label: '"500abc"', value: '500abc', expectKept: false },
      { label: '"" (empty string)', value: '', expectKept: false },
      { label: 'null', value: null, expectKept: false },
      { label: 'undefined', value: undefined, expectKept: false },
    ];

    for (const { label, value, expectKept, expectedAmount } of cases) {
      it(`price.value = ${label} -> ${expectKept ? `kept as ${expectedAmount}` : 'excluded'}`, async () => {
        const item = { ...realItem, price: { value, currency: 'GBP' } };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([item])));

        const outcome = await provider.searchProducts({ query: 'x' });

        if (expectKept) {
          expect(outcome.results).toHaveLength(1);
          expect(outcome.results[0].price).toBe(expectedAmount);
        } else {
          expect(outcome.results).toEqual([]);
        }
      });
    }
  });
});

describe('EbayBrowseSourcingProvider — itemLocationCountry extraction (Global Sourcing Engine)', () => {
  let provider: EbayBrowseSourcingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new EbayBrowseSourcingProvider();
    (EbayApplicationTokenManager.getAccessToken as any).mockResolvedValue('app-token-abc');
  });

  it('a real itemLocation.country is captured', async () => {
    const itemWithLocation = { ...realItem, itemLocation: { country: 'GB' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithLocation])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.itemLocationCountry).toBe('GB');
  });

  it('no itemLocation at all -> itemLocationCountry stays undefined, never inferred from the searched marketplace', async () => {
    const itemWithoutLocation = { ...realItem };
    delete (itemWithoutLocation as any).itemLocation;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithoutLocation])));

    const result = (await provider.searchProducts({ query: 'x', marketplaces: ['EBAY_FR'] })).results[0];

    expect(result.itemLocationCountry).toBeUndefined();
  });
});

describe('EbayBrowseSourcingProvider.getProductDetails', () => {
  it('is honestly not implemented yet — returns null, never a fabricated item', async () => {
    const provider = new EbayBrowseSourcingProvider();
    const result = await provider.getProductDetails('https://www.ebay.com/itm/123');
    expect(result).toBeNull();
  });
});

describe('EbayBrowseSourcingProvider — shipping cost extraction (Étape 4)', () => {
  let provider: EbayBrowseSourcingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new EbayBrowseSourcingProvider();
    (EbayApplicationTokenManager.getAccessToken as any).mockResolvedValue('app-token-abc');
  });

  it('a real shippingCost is captured, in its own currency', async () => {
    const itemWithShipping = {
      ...realItem,
      shippingOptions: [{ shippingCost: { value: '12.50', currency: 'GBP' } }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithShipping])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBe(12.5);
    expect(result.shippingCostCurrency).toBe('GBP');
  });

  it('a real reported free-shipping cost of 0 is captured as 0 — a known real value, not treated as missing', async () => {
    const freeShippingItem = {
      ...realItem,
      shippingOptions: [{ shippingCost: { value: '0.0', currency: 'GBP' } }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([freeShippingItem])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBe(0);
    expect(result.shippingCostCurrency).toBe('GBP');
  });

  it('no shippingOptions at all -> shippingCost stays undefined, never defaulted to 0', async () => {
    const itemWithoutShipping = { ...realItem };
    delete (itemWithoutShipping as any).shippingOptions;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithoutShipping])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBeUndefined();
    expect(result.shippingCostCurrency).toBeUndefined();
  });

  it('an empty shippingOptions array -> shippingCost stays undefined, never defaulted to 0', async () => {
    const itemWithEmptyShipping = { ...realItem, shippingOptions: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithEmptyShipping])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBeUndefined();
  });

  it('a shippingOptions entry with no shippingCost sub-object -> stays undefined, never defaulted to 0', async () => {
    const itemWithIncompleteShipping = { ...realItem, shippingOptions: [{ shippingOptionType: 'CALCULATED' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithIncompleteShipping])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBeUndefined();
  });

  it('multiple shipping options -> only the first is used (documented simplification, not a fabricated average or minimum)', async () => {
    const itemWithMultipleShipping = {
      ...realItem,
      shippingOptions: [
        { shippingCost: { value: '5.00', currency: 'GBP' } },
        { shippingCost: { value: '15.00', currency: 'GBP' } },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithMultipleShipping])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBe(5);
  });

  it('a non-numeric shippingCost value -> stays undefined, never NaN', async () => {
    const itemWithBadShipping = { ...realItem, shippingOptions: [{ shippingCost: { value: 'not-a-number', currency: 'GBP' } }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithBadShipping])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBeUndefined();
  });

  it('a CALCULATED-type shipping option with a reported cost is still extracted like any other', async () => {
    const itemWithCalculatedShipping = {
      ...realItem,
      shippingOptions: [{ shippingOptionType: 'CALCULATED', shippingCost: { value: '8.75', currency: 'GBP' } }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithCalculatedShipping])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBe(8.75);
    expect(result.shippingCostCurrency).toBe('GBP');
  });

  it('never assumes shippingOptions[0] is the cheapest — returns it verbatim even when a later option is cheaper', async () => {
    const itemWithExpensiveFirstOption = {
      ...realItem,
      shippingOptions: [
        { shippingCost: { value: '25.00', currency: 'GBP' } },
        { shippingCost: { value: '3.00', currency: 'GBP' } },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithExpensiveFirstOption])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    // Proves this is "first reported", not "cheapest": no min() is applied.
    expect(result.shippingCost).toBe(25);
  });

  it('the price field is read as a self-consistent (value, currency) pair — convertedFromValue/convertedFromCurrency are never applied as a second conversion', async () => {
    const itemWithConvertedPrice = {
      ...realItem,
      price: { value: '500.00', currency: 'EUR', convertedFromValue: '450.00', convertedFromCurrency: 'GBP' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithConvertedPrice])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.price).toBe(500);
    expect(result.currency).toBe('EUR');
  });

  it('shippingCost is read as a self-consistent (value, currency) pair — convertedFromValue/convertedFromCurrency are never applied as a second conversion', async () => {
    const itemWithConvertedShipping = {
      ...realItem,
      shippingOptions: [{ shippingCost: { value: '15.00', currency: 'EUR', convertedFromValue: '13.50', convertedFromCurrency: 'GBP' } }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithConvertedShipping])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.shippingCost).toBe(15);
    expect(result.shippingCostCurrency).toBe('EUR');
  });
});
