/**
 * Retry-publish safety fix — EtsyAdapter.createListing() tests.
 * Network is always mocked (global.fetch stubbed) — no real Etsy call is
 * ever made, matching this project's sibling eBay test
 * (src/__tests__/marketplace/ebay-listing-mapping.test.ts) "no real
 * publication" rule.
 *
 * createListing() is two real Etsy calls: POST a draft listing (never
 * visible on Etsy, safe to retry on a transient failure) then PATCH it to
 * state:'active' (the real point of no return — what actually makes it
 * live). See that method's own header comment for the full reasoning.
 * This file covers only the NEW retry/ambiguous-publish behavior; field
 * mapping itself is unchanged and not re-tested here.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter';
import { ErrorType } from '@/types/marketplace';

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json: any }>) {
  let call = 0;
  return vi.fn(async (_url: string, _init?: any) => {
    const r = responses[call];
    call++;
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      statusText: r.ok ? 'OK' : 'Error',
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    } as any;
  });
}

async function makeAdapterWithShop() {
  const adapter = new EtsyAdapter({ clientId: 'test-client-id', clientSecret: 'test-secret', redirectUri: 'http://localhost' });
  adapter.setAccessToken('fake-access-token');
  // requireShopId() resolves via validateConnection() -> /users/me + /users/{id}/shops.
  const resolveShopFetch = mockFetchSequence([
    { ok: true, json: { user_id: 111 } },
    { ok: true, json: { shop_id: 999 } },
  ]);
  vi.stubGlobal('fetch', resolveShopFetch);
  await adapter.validateConnection();
  return adapter;
}

const listing = {
  title: 'Prada Cut Out Sneakers',
  description: 'A real description',
  price: 449,
  quantity: 1,
  sku: 'ADKSY-SKU-1',
  etsy: { whoMade: 'i_did' as const, whenMade: '2020_2025', taxonomyId: 1234 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EtsyAdapter.createListing — retry-publish safety fix', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a 429 at step 1 (create draft listing) followed by a success results in exactly one successful publish, never a duplicate', async () => {
    const adapter = await makeAdapterWithShop();
    const fetchMock = mockFetchSequence([
      { ok: false, status: 429, json: { error: 'Rate limited' } }, // step 1, attempt 1
      { ok: true, json: { listing_id: 12345, state: 'draft' } }, // step 1, attempt 2 (retried)
      { ok: true, json: { listing_id: 12345, state: 'active', title: listing.title, description: listing.description, price: { amount: 44900, divisor: 100, currency_code: 'USD' }, quantity: 1 } }, // step 2 (activate)
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const promise = adapter.createListing(listing);
    await vi.advanceTimersByTimeAsync(2000); // past step 1's own retry wait

    const result = await promise;
    expect(result.id).toBe('12345');
    // Exactly 3 real calls — step 1 retried once, step 2 (activate) called
    // exactly once. Never a 4th call: the activation step itself is never
    // retried, and a successful publish is never repeated.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('a 401 (permanent auth failure) at step 1 is never retried — exactly one fetch call, immediate failure', async () => {
    const adapter = await makeAdapterWithShop();
    const fetchMock = mockFetchSequence([{ ok: false, status: 401, json: { error: 'Invalid token' } }]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(adapter.createListing(listing)).rejects.toMatchObject({ type: ErrorType.AUTH_EXPIRED });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it(
    "a 429 at the FINAL activation step (the point of no return) is never automatically retried, and is tagged ambiguousPublish — Etsy's real state is unknown, never assumed failed",
    async () => {
      const adapter = await makeAdapterWithShop();
      const fetchMock = mockFetchSequence([
        { ok: true, json: { listing_id: 12345, state: 'draft' } }, // step 1
        { ok: false, status: 429, json: { error: 'Rate limited' } }, // step 2 (activate) — never retried
      ]);
      vi.stubGlobal('fetch', fetchMock);

      let caught: any;
      try {
        await adapter.createListing(listing);
      } catch (error) {
        caught = error;
      }

      expect(caught.type).toBe(ErrorType.RATE_LIMIT_EXCEEDED);
      expect(caught.ambiguousPublish).toBe(true);
      // Exactly 2 calls — the activation step's own transient failure is
      // never retried automatically, unlike step 1.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );

  it('a 400 (definitive rejection, not a transient error) at the FINAL activation step is NOT tagged ambiguousPublish — a real, confirmed rejection', async () => {
    const adapter = await makeAdapterWithShop();
    const fetchMock = mockFetchSequence([
      { ok: true, json: { listing_id: 12345, state: 'draft' } },
      { ok: false, status: 400, json: { error: 'Listing already active' } },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    let caught: any;
    try {
      await adapter.createListing(listing);
    } catch (error) {
      caught = error;
    }

    expect(caught.type).toBe(ErrorType.VALIDATION_ERROR);
    expect(caught.ambiguousPublish).toBeFalsy();
  });
});
