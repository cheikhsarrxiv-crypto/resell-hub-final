/**
 * Etsy images fix — tests for EtsyAdapter.uploadListingImage, the real
 * multipart/form-data call to Etsy's own
 * POST /v3/application/shops/{shop_id}/listings/{listing_id}/images
 * (endpoint/parameters verified against gordonturner/etsy-open-api-client's
 * ShopListingImageApi.md — see that method's own header comment). Network
 * is always mocked (global.fetch stubbed) — no real Etsy call is ever made.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter';

function mockFetchOnce(response: { ok: boolean; status?: number; json: any }) {
  return vi.fn(async (_url: string, _init?: any) => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 201 : 400),
    statusText: response.ok ? 'Created' : 'Error',
    json: async () => response.json,
  }) as any);
}

async function makeAdapterWithShop() {
  const adapter = new EtsyAdapter({ clientId: 'test-client-id', clientSecret: 'test-secret', redirectUri: 'http://localhost' });
  adapter.setAccessToken('fake-access-token');
  // requireShopId() calls validateConnection() -> /users/me + /users/{id}/shops
  // when shopId isn't already known — stub both calls once, then the real
  // uploadListingImage call itself is the fetch under test. callEtsyApi
  // reads the response via .text() (never .json() directly — see that
  // method's own body), so both must be provided.
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ user_id: 111 }) })
    .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ shop_id: 999 }) });
  vi.stubGlobal('fetch', fetchMock);
  await adapter.validateConnection();
  return { adapter, fetchMock };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EtsyAdapter.uploadListingImage', () => {
  it('POSTs multipart/form-data to the exact documented endpoint, with shop_id/listing_id in the path and rank in the form body', async () => {
    const { adapter } = await makeAdapterWithShop();
    const uploadFetch = mockFetchOnce({
      ok: true,
      json: { listing_image_id: 555, listing_id: 12345, rank: 1, url_fullxfull: 'https://etsy.example/full.jpg' },
    });
    vi.stubGlobal('fetch', uploadFetch);

    const result = await adapter.uploadListingImage('12345', {
      data: Buffer.from([1, 2, 3, 4]),
      filename: 'image-1.jpg',
      contentType: 'image/jpeg',
      rank: 1,
    });

    expect(result).toEqual({ listingImageId: '555', rank: 1, url: 'https://etsy.example/full.jpg' });

    const [url, init] = uploadFetch.mock.calls[0];
    expect(url).toBe('https://api.etsy.com/v3/application/shops/999/listings/12345/images');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer fake-access-token');
    expect(init.headers['x-api-key']).toBe('test-client-id');
    // Never manually set Content-Type — fetch must compute the multipart
    // boundary itself from the FormData body (see this adapter's own
    // comment on why setting it manually would break the upload).
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('rank')).toBe('1');
    const imagePart = init.body.get('image');
    expect(imagePart).toBeInstanceOf(Blob);
    expect((imagePart as Blob).type).toBe('image/jpeg');
  });

  it('a real Etsy error response (e.g. invalid image) throws a normalized, non-secret error', async () => {
    const { adapter } = await makeAdapterWithShop();
    vi.stubGlobal('fetch', mockFetchOnce({ ok: false, status: 400, json: { error: 'Invalid image format' } }));

    await expect(
      adapter.uploadListingImage('12345', { data: Buffer.from([1]), filename: 'bad.jpg', contentType: 'image/jpeg', rank: 1 })
    ).rejects.toBeTruthy();
  });

  it('never sends a hotlinked URL as the image — only real file bytes', async () => {
    const { adapter } = await makeAdapterWithShop();
    const uploadFetch = mockFetchOnce({ ok: true, json: { listing_image_id: 1, rank: 2 } });
    vi.stubGlobal('fetch', uploadFetch);

    await adapter.uploadListingImage('12345', { data: Buffer.from([9, 9]), filename: 'x.png', contentType: 'image/png', rank: 2 });

    const [, init] = uploadFetch.mock.calls[0];
    expect(init.body.has('image_url')).toBe(false);
    expect(init.body.has('url')).toBe(false);
    expect(init.body.get('image')).toBeInstanceOf(Blob);
  });
});
