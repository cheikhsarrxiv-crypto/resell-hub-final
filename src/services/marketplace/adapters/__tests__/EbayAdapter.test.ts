/**
 * Listing-reconciliation fix — tests for EbayAdapter.findPublishedOfferBySku,
 * the real eBay-side lookup used to reconcile a Listing stuck at
 * syncStatus='syncing' (see ListingReconciliationService and its own
 * __tests__). Network is always mocked (global.fetch stubbed) — no real
 * eBay call is ever made, matching the rest of this file's sibling
 * (ebay-listing-mapping.test.ts) "no real publication" rule.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter';

function mockFetchOnce(response: { ok: boolean; status?: number; json: any }) {
  return vi.fn(async (_url: string, _init?: any) => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    statusText: response.ok ? 'OK' : 'Error',
    json: async () => response.json,
    text: async () => JSON.stringify(response.json),
  }) as any);
}

function makeAdapter() {
  const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' });
  adapter.setAccessToken('fake-access-token');
  return adapter;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EbayAdapter.findPublishedOfferBySku', () => {
  it('found: a PUBLISHED offer for this exact sku+marketplaceId returns its real listingId', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: {
        offers: [
          { offerId: 'OFFER-1', sku: 'ADKSY-SKU-1', marketplaceId: 'EBAY_GB', status: 'PUBLISHED', listing: { listingId: 'LISTING-REAL-1' } },
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await makeAdapter().findPublishedOfferBySku('ADKSY-SKU-1', 'EBAY_GB');

    expect(result).toEqual({ status: 'found', listingId: 'LISTING-REAL-1', offerId: 'OFFER-1' });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('sku=ADKSY-SKU-1');
    expect(url).toContain('marketplace_id=EBAY_GB');
  });

  it('not_found: a real, successful eBay response with no matching offer at all', async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: { offers: [], total: 0 } });
    vi.stubGlobal('fetch', fetchMock);

    const result = await makeAdapter().findPublishedOfferBySku('SKU-NEVER-PUBLISHED', 'EBAY_GB');
    expect(result).toEqual({ status: 'not_found' });
  });

  it('not_found: offers exist for this sku but none are PUBLISHED — an unpublished dangling offer is never mistaken for a real publish', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: { offers: [{ offerId: 'OFFER-1', sku: 'ADKSY-SKU-1', marketplaceId: 'EBAY_GB', status: 'UNPUBLISHED' }] },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await makeAdapter().findPublishedOfferBySku('ADKSY-SKU-1', 'EBAY_GB');
    expect(result).toEqual({ status: 'not_found' });
  });

  it('not_found: an offer for this sku exists on a DIFFERENT marketplaceId is never treated as a match', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: { offers: [{ offerId: 'OFFER-1', sku: 'ADKSY-SKU-1', marketplaceId: 'EBAY_US', status: 'PUBLISHED', listing: { listingId: 'LISTING-US-1' } }] },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await makeAdapter().findPublishedOfferBySku('ADKSY-SKU-1', 'EBAY_GB');
    expect(result).toEqual({ status: 'not_found' });
  });

  it('not_found: a 404 response is treated the same as a confirmed-empty result', async () => {
    const fetchMock = mockFetchOnce({ ok: false, status: 404, json: { errors: [{ message: 'Not found' }] } });
    vi.stubGlobal('fetch', fetchMock);

    const result = await makeAdapter().findPublishedOfferBySku('ADKSY-SKU-1', 'EBAY_GB');
    expect(result).toEqual({ status: 'not_found' });
  });

  it('unable_to_verify: a 401/auth failure never becomes "not_found"', async () => {
    const fetchMock = mockFetchOnce({ ok: false, status: 401, json: { errors: [{ message: 'Invalid token' }] } });
    vi.stubGlobal('fetch', fetchMock);

    const result = await makeAdapter().findPublishedOfferBySku('ADKSY-SKU-1', 'EBAY_GB');
    expect(result.status).toBe('unable_to_verify');
  });

  it('unable_to_verify: a rate-limit (429) never becomes "not_found"', async () => {
    const fetchMock = mockFetchOnce({ ok: false, status: 429, json: { errors: [{ message: 'Rate limited' }] } });
    vi.stubGlobal('fetch', fetchMock);

    const result = await makeAdapter().findPublishedOfferBySku('ADKSY-SKU-1', 'EBAY_GB');
    expect(result.status).toBe('unable_to_verify');
  });

  it('unable_to_verify: a network-level failure (fetch rejects) never becomes "not_found"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));

    const result = await makeAdapter().findPublishedOfferBySku('ADKSY-SKU-1', 'EBAY_GB');
    expect(result.status).toBe('unable_to_verify');
  });

  it('unable_to_verify: no access token set on the adapter', async () => {
    const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' });
    const result = await adapter.findPublishedOfferBySku('ADKSY-SKU-1', 'EBAY_GB');
    expect(result).toEqual({ status: 'unable_to_verify', reason: 'Access token required.' });
  });
});
