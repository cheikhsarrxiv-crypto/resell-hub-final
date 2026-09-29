/**
 * Phase 12C-Prep — EbayAdapter.createListing() field mapping tests.
 * Network is always mocked (global.fetch stubbed) — no real eBay call is
 * ever made, matching this phase's absolute "no real publication" rule.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'
import { ErrorType } from '@/types/marketplace'
import { ErrorNormalizer } from '@/services/marketplace/ErrorNormalizer'

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json: any }>) {
  let call = 0
  return vi.fn(async (_url: string, _init?: any) => {
    const r = responses[call]
    call++
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      statusText: r.ok ? 'OK' : 'Error',
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    } as any
  })
}

function makeAdapter() {
  const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' })
  adapter.setAccessToken('fake-access-token')
  return adapter
}

const fullListing = {
  title: 'Prada Cut Out Sneakers',
  description: 'A real description',
  price: 449,
  quantity: 1,
  sku: 'ADKSY-SKU-1',
  currency: 'EUR',
  condition: 'USED_EXCELLENT',
  images: ['https://img.example/1.jpg', 'https://img.example/2.jpg'],
  ebay: { categoryId: 15709, marketplaceId: 'EBAY_FR' },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('A. EbayAdapter.createListing — full field mapping, no hardcoded values', () => {
  it('sends the real currency, never a hardcoded EUR when a different one is given', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { sku: 'ADKSY-SKU-1' } },
      { ok: true, json: { offerId: 'OFFER-1' } },
      { ok: true, json: { listingId: 'LISTING-1' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await makeAdapter().createListing({ ...fullListing, currency: 'GBP' })

    const offerBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(offerBody.pricingSummary.price.currency).toBe('GBP')
  })

  it('sends the real condition, never a hardcoded USED_GOOD', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: {} },
      { ok: true, json: { offerId: 'OFFER-1' } },
      { ok: true, json: { listingId: 'LISTING-1' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await makeAdapter().createListing({ ...fullListing, condition: 'NEW' })

    const inventoryBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(inventoryBody.condition).toBe('NEW')
  })

  it('sends the real category as categoryId on the offer, never invented', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: {} },
      { ok: true, json: { offerId: 'OFFER-1' } },
      { ok: true, json: { listingId: 'LISTING-1' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await makeAdapter().createListing({ ...fullListing, ebay: { categoryId: 93427, marketplaceId: 'EBAY_FR' } })

    const offerBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(offerBody.categoryId).toBe('93427')
  })

  it('sends the real images as product.imageUrls', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: {} },
      { ok: true, json: { offerId: 'OFFER-1' } },
      { ok: true, json: { listingId: 'LISTING-1' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await makeAdapter().createListing(fullListing)

    const inventoryBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(inventoryBody.product.imageUrls).toEqual(['https://img.example/1.jpg', 'https://img.example/2.jpg'])
  })

  it('never sends an imageUrls field at all when no images are given (never fabricates one)', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: {} },
      { ok: true, json: { offerId: 'OFFER-1' } },
      { ok: true, json: { listingId: 'LISTING-1' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const { images, ...withoutImages } = fullListing
    await makeAdapter().createListing(withoutImages)

    const inventoryBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(inventoryBody.product.imageUrls).toBeUndefined()
  })

  it('the real target marketplaceId is used consistently in the offer body AND the X-EBAY-C-MARKETPLACE-ID header for every call, never a hardcoded EBAY_FR', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: {} },
      { ok: true, json: { offerId: 'OFFER-1' } },
      { ok: true, json: { listingId: 'LISTING-1' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await makeAdapter().createListing({ ...fullListing, ebay: { categoryId: 15709, marketplaceId: 'EBAY_GB' } })

    const offerBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(offerBody.marketplaceId).toBe('EBAY_GB')

    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_GB')
    }
  })

  it('sends the real price and quantity unchanged', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: {} },
      { ok: true, json: { offerId: 'OFFER-1' } },
      { ok: true, json: { listingId: 'LISTING-1' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await makeAdapter().createListing({ ...fullListing, price: 123.45, quantity: 3 })

    const inventoryBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const offerBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(inventoryBody.availability.shipToLocationAvailability.quantity).toBe(3)
    expect(offerBody.pricingSummary.price.value).toBe('123.45')
  })

  it('uses the real SKU when given, never overwrites it', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: {} },
      { ok: true, json: { offerId: 'OFFER-1' } },
      { ok: true, json: { listingId: 'LISTING-1' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await makeAdapter().createListing({ ...fullListing, sku: 'MY-REAL-SKU' })

    const inventoryBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(inventoryBody.sku).toBe('MY-REAL-SKU')
  })
})

describe('B. EbayAdapter.createListing — missing required data blocks BEFORE any network call', () => {
  const cases: Array<[string, Partial<typeof fullListing>]> = [
    ['currency', { currency: undefined as any }],
    ['condition', { condition: undefined as any }],
  ]

  it.each(cases)('missing %s -> throws, zero fetch calls', async (_field, overrides) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeAdapter().createListing({ ...fullListing, ...overrides })).rejects.toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('missing ebay.categoryId -> throws, zero fetch calls (never invents a category)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { ebay, ...rest } = fullListing
    await expect(
      makeAdapter().createListing({ ...rest, ebay: { categoryId: undefined as any, marketplaceId: 'EBAY_FR' } })
    ).rejects.toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('missing ebay.marketplaceId -> throws, zero fetch calls (never guesses a target marketplace)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      makeAdapter().createListing({ ...fullListing, ebay: { categoryId: 15709, marketplaceId: undefined as any } })
    ).rejects.toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('missing ebay entirely -> throws, zero fetch calls', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { ebay, ...withoutEbay } = fullListing
    await expect(makeAdapter().createListing(withoutEbay)).rejects.toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the thrown error is categorized as a normal eBay VALIDATION_ERROR (400), not a new/invented error type', async () => {
    vi.stubGlobal('fetch', vi.fn())

    let caught: any
    try {
      const { ebay, ...rest } = fullListing
      await makeAdapter().createListing(rest)
    } catch (error) {
      caught = error
    }

    expect(caught.type).toBe(ErrorType.VALIDATION_ERROR)
    expect(caught.statusCode).toBe(400)
  })
})

describe('F. EbayAdapter — API error categorization (network always mocked)', () => {
  it('409 conflict is categorized (falls back to UNKNOWN via the existing generic path — no fabricated CONFLICT type)', async () => {
    const fetchMock = mockFetchSequence([{ ok: false, status: 409, json: { message: 'Conflict' } }])
    vi.stubGlobal('fetch', fetchMock)

    let caught: any
    try {
      await makeAdapter().createListing(fullListing)
    } catch (error) {
      caught = error
    }
    // 409 isn't one of EbayAdapter's explicitly special-cased statuses
    // (401/403/400/404/429/5xx) — it must still produce a real,
    // structured NormalizedError, never crash uncaught.
    expect(caught.statusCode).toBe(409)
    expect(typeof caught.type).toBe('string')
  })

  it('a network-level failure (fetch itself throws, e.g. timeout) is categorized as NETWORK_ERROR', async () => {
    const timeoutError = new Error('timeout') as any
    timeoutError.code = 'ETIMEDOUT'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError))

    let caught: any
    try {
      await makeAdapter().createListing(fullListing)
    } catch (error) {
      caught = error
    }
    expect(caught.type).toBe(ErrorType.NETWORK_ERROR)
    expect(caught.retryable).toBe(true)
  })

  it('a 403 is categorized as AUTH_INVALID, distinct from a 401 AUTH_EXPIRED', async () => {
    const fetchMock = mockFetchSequence([{ ok: false, status: 403, json: {} }])
    vi.stubGlobal('fetch', fetchMock)

    let caught: any
    try {
      await makeAdapter().createListing(fullListing)
    } catch (error) {
      caught = error
    }
    expect(caught.type).toBe(ErrorType.AUTH_INVALID)
  })

  it('ErrorNormalizer never invents a new ErrorType for eBay beyond its existing, real categories', () => {
    const knownTypes = Object.values(ErrorType)
    for (const status of [400, 401, 403, 404, 429, 500, 502, 503]) {
      const normalized = ErrorNormalizer.normalize({ status }, 'ebay')
      expect(knownTypes).toContain(normalized.type)
    }
  })
})
