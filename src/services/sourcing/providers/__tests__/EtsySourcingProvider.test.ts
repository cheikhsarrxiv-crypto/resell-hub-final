/**
 * Real behavioral tests for EtsySourcingProvider. Never calls the real
 * Etsy endpoint: global.fetch is mocked. Proves the provider only ever
 * returns what a mocked response actually contained — no fabricated
 * result, no invented field — and correctly reports itself unconfigured
 * when ETSY_CLIENT_ID is absent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EtsySourcingProvider } from '@/services/sourcing/providers/EtsySourcingProvider';

function searchResponse(results: any[]) {
  return { ok: true, status: 200, json: async () => ({ results, count: results.length }) } as any;
}

const realItem = {
  listing_id: 987654321,
  title: 'Vintage Chanel Wool Blazer',
  url: 'https://www.etsy.com/listing/987654321/vintage-chanel-wool-blazer',
  price: { amount: 45000, divisor: 100, currency_code: 'USD' },
  quantity: 1,
  state: 'active',
  shop_id: 111,
  shipping_profile_id: 222,
  taxonomy_id: 333,
};

describe('EtsySourcingProvider.isConfigured', () => {
  const originalClientId = process.env.ETSY_CLIENT_ID;

  afterEach(() => {
    if (originalClientId === undefined) delete process.env.ETSY_CLIENT_ID;
    else process.env.ETSY_CLIENT_ID = originalClientId;
  });

  it('reflects whether ETSY_CLIENT_ID is set', () => {
    delete process.env.ETSY_CLIENT_ID;
    expect(new EtsySourcingProvider().isConfigured()).toBe(false);

    process.env.ETSY_CLIENT_ID = 'real-keystring';
    expect(new EtsySourcingProvider().isConfigured()).toBe(true);
  });
});

describe('EtsySourcingProvider.searchProducts', () => {
  let provider: EtsySourcingProvider;
  const originalClientId = process.env.ETSY_CLIENT_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETSY_CLIENT_ID = 'real-keystring';
    provider = new EtsySourcingProvider();
  });

  afterEach(() => {
    if (originalClientId === undefined) delete process.env.ETSY_CLIENT_ID;
    else process.env.ETSY_CLIENT_ID = originalClientId;
  });

  it('simple search: returns exactly what the mocked Etsy response contained, nothing invented', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([realItem])));

    const outcome = await provider.searchProducts({ query: 'Chanel blazer' });

    expect(outcome.results).toHaveLength(1);
    const result = outcome.results[0];
    expect(result.source).toBe('etsy');
    expect(result.sourceId).toBe('987654321');
    expect(result.sourceUrl).toBe(realItem.url);
    expect(result.title).toBe('Vintage Chanel Wool Blazer');
  });

  it('computes the real decimal price from amount/divisor, never assuming divisor=100', async () => {
    const item = { ...realItem, price: { amount: 12345, divisor: 1000, currency_code: 'EUR' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([item])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.price).toBe(12.345);
    expect(result.currency).toBe('EUR');
  });

  it('sends the x-api-key header with ETSY_CLIENT_ID, never a Bearer/OAuth token (this endpoint is API-key-only)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'x' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['x-api-key']).toBe('real-keystring');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('folds brand and category into free-text keywords, never sends a numeric category as taxonomy_id (different ID space from eBay)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'blazer', brand: 'Chanel', category: '12345' });

    const [url] = fetchMock.mock.calls[0];
    const decoded = decodeURIComponent(url).replace(/\+/g, ' ');
    expect(decoded).toContain('keywords=blazer Chanel 12345');
    expect(decoded).not.toContain('taxonomy_id');
  });

  it('never forwards minPrice/maxPrice/condition — not confirmed safe for cross-currency filtering (see this provider\'s own header)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'x', minPrice: 100, maxPrice: 400, currency: 'EUR', condition: 'used' });

    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain('min_price');
    expect(url).not.toContain('max_price');
    expect(url).not.toContain('condition');
  });

  it('does not declare price_filter or condition_filter capabilities, matching what it actually forwards', () => {
    expect(provider.capabilities).not.toContain('price_filter');
    expect(provider.capabilities).not.toContain('condition_filter');
  });

  it('worldwide has no effect on the request — Etsy already searches its whole marketplace in one call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'x', worldwide: true });
    const [urlWorldwide] = fetchMock.mock.calls[0];

    fetchMock.mockClear();
    await provider.searchProducts({ query: 'x', worldwide: false });
    const [urlDefault] = fetchMock.mock.calls[0];

    expect(urlWorldwide).toBe(urlDefault);
  });

  it('Phase 3: model/size/color are folded into the free-text keyword search, never a structured filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'bag', model: 'Cut', size: '42', color: 'Black' });

    const [url] = fetchMock.mock.calls[0];
    const decoded = decodeURIComponent(url).replace(/\+/g, ' ');
    expect(decoded).toContain('keywords=bag Cut 42 Black');
  });

  it('pagination: forwards limit/offset to the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await provider.searchProducts({ query: 'x', limit: 5, offset: 10 });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('limit=5');
    expect(url).toContain('offset=10');
  });

  it('never populates images, seller, shippingCost, or itemLocationCountry — honestly not fetched in this version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([realItem])));

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.images).toEqual([]);
    expect(result.seller).toBeUndefined();
    expect(result.shippingCost).toBeUndefined();
    expect(result.itemLocationCountry).toBeUndefined();
    expect(result.brand).toBeUndefined();
    expect(result.condition).toBeUndefined();
  });

  it("authenticityStatus: a normal listing is 'claimed', NEVER 'verified' — Etsy has no institutional authenticity program", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([realItem])));
    const result = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(result.authenticityStatus).toBe('claimed');
    expect(result.authenticitySource).toContain('no institutional authenticity verification');
  });

  it("authenticityStatus: an item with no usable title -> 'unverified'", async () => {
    const emptyItem = { ...realItem, title: '' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([emptyItem])));
    const result = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(result.authenticityStatus).toBe('unverified');
  });

  it('item with no price object at all -> excluded from results, never price=0', async () => {
    const itemWithNoPrice = { ...realItem, price: undefined };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([itemWithNoPrice])));

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
    expect(outcome.error).toBeUndefined();
  });

  it('item with divisor=0 -> excluded from results (would divide by zero), never NaN/Infinity', async () => {
    const item = { ...realItem, price: { amount: 100, divisor: 0, currency_code: 'USD' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([item])));

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
  });

  it('a mix of valid and invalid items -> only the items with an exploitable price are returned', async () => {
    const validItem = { ...realItem, listing_id: 1 };
    const noPriceItem = { ...realItem, listing_id: 2, price: undefined };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([validItem, noPriceItem])));

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results.map((r) => r.sourceId)).toEqual(['1']);
  });

  it('no results from Etsy -> empty array, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([])));
    const outcome = await provider.searchProducts({ query: 'a very specific item nobody sells' });
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toBeUndefined();
  });

  it('ETSY_CLIENT_ID missing at call time -> structured auth error, no fetch attempted', async () => {
    delete process.env.ETSY_CLIENT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.error?.kind).toBe('auth');
  });

  it('Etsy API error response -> structured error, no fabricated results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Etsy internal error' }) })
    );

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
    expect(outcome.error).toEqual({ provider: 'etsy', message: 'Etsy internal error', kind: 'upstream_error' });
  });

  it('a 401 from Etsy -> classified as an auth error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const outcome = await provider.searchProducts({ query: 'x' });
    expect(outcome.error?.kind).toBe('auth');
  });

  it('a 429 from Etsy -> classified as a rate_limit error', async () => {
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

  it('marketplace is always the constant ETSY — a single unified marketplace, never per-item metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(searchResponse([realItem])));
    const result = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(result.marketplace).toBe('ETSY');
  });
});

describe('EtsySourcingProvider.getProductDetails', () => {
  it('is honestly not implemented yet — returns null, never a fabricated item', async () => {
    const provider = new EtsySourcingProvider();
    const result = await provider.getProductDetails('https://www.etsy.com/listing/123');
    expect(result).toBeNull();
  });
});
