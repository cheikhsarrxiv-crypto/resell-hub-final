/**
 * Etsy OAuth/scopes audit finding (Commercial Access prep): third-party
 * access to buyer email and the full shipping address has reportedly been
 * restricted by Etsy in some cases (buyer email requires an approval
 * separate from transactions_r; some regions reportedly limit which
 * address fields third-party apps can see). EtsyAdapter.mapOrder() must
 * stay correct — never throw, never silently discard genuinely-available
 * fields — when a receipt carries only some of these fields rather than
 * all or none.
 *
 * No real network: same convention as etsy-order-sku.test.ts — global
 * fetch is stubbed to serve a fixed receipts response, and the real
 * adapter code (getOrders -> mapOrder) is exercised end-to-end. shopId is
 * pre-set directly on the adapter instance to skip validateConnection()'s
 * own network calls (unrelated to this fix).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter'

function stubReceiptsResponse(results: any[]) {
  const fetchMock = vi.fn(async (_url: string, _init?: any) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ results }),
    text: async () => JSON.stringify({ results }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function makeReceipt(overrides: Partial<any> = {}): any {
  return {
    receipt_id: 111,
    buyer_user_id: 222,
    name: 'Buyer One',
    buyer_email: 'buyer@example.com',
    grandtotal: { amount: 2500, divisor: 100 },
    status: 'paid',
    created_timestamp: 1700000000,
    transactions: [],
    first_line: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    zip: '62704',
    country_iso: 'US',
    ...overrides,
  }
}

function newAdapter() {
  const adapter = new EtsyAdapter({
    clientId: 'test-etsy-client-id',
    clientSecret: 'test-etsy-client-secret',
    redirectUri: 'http://localhost/api/marketplace/callback/etsy',
  })
  adapter.setAccessToken('fake-access-token')
  ;(adapter as any).shopId = 'shop-1' // skip validateConnection() — unrelated to this fix
  return adapter
}

describe('EtsyAdapter.getOrders() — buyer_email robustness', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('non-regression: a full receipt with buyer_email maps it correctly', async () => {
    stubReceiptsResponse([makeReceipt()])
    const orders = await newAdapter().getOrders()
    expect(orders[0].buyerEmail).toBe('buyer@example.com')
  })

  it('buyer_email absent (field not present at all): buyerEmail is undefined, never a crash, never a fabricated value', async () => {
    const receipt = makeReceipt()
    delete receipt.buyer_email
    stubReceiptsResponse([receipt])

    const orders = await newAdapter().getOrders()

    expect(orders[0].buyerEmail).toBeUndefined()
  })

  it('buyer_email explicitly null: buyerEmail is undefined, never the literal string "null"', async () => {
    stubReceiptsResponse([makeReceipt({ buyer_email: null })])
    const orders = await newAdapter().getOrders()
    expect(orders[0].buyerEmail).toBeUndefined()
  })

  it('buyer_email empty string: treated as absent (undefined), not kept as an empty string', async () => {
    stubReceiptsResponse([makeReceipt({ buyer_email: '' })])
    const orders = await newAdapter().getOrders()
    expect(orders[0].buyerEmail).toBeUndefined()
  })
})

describe('EtsyAdapter.getOrders() — partial shipping address robustness', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('non-regression: a full address maps every field correctly, unchanged from before', async () => {
    stubReceiptsResponse([makeReceipt()])
    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress).toEqual({
      name: 'Buyer One',
      street1: '123 Main St',
      street2: undefined,
      city: 'Springfield',
      state: 'IL',
      postalCode: '62704',
      country: 'US',
      email: 'buyer@example.com',
    })
  })

  it('no address fields at all: shippingAddress is undefined (never a fabricated empty-string address)', async () => {
    const receipt = makeReceipt()
    delete receipt.first_line
    delete receipt.city
    delete receipt.state
    delete receipt.zip
    delete receipt.country_iso
    stubReceiptsResponse([receipt])

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress).toBeUndefined()
  })

  it('street line missing but city/state/zip/country present: the previous implementation silently discarded this entire address — it must now be preserved', async () => {
    const receipt = makeReceipt()
    delete receipt.first_line // the field the old gating condition relied on exclusively
    stubReceiptsResponse([receipt])

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress).toBeDefined()
    expect(orders[0].shippingAddress).toMatchObject({
      street1: '', // genuinely absent — never fabricated
      city: 'Springfield',
      state: 'IL',
      postalCode: '62704',
      country: 'US',
    })
  })

  it('only country present (e.g. a region-restricted receipt exposing just one field): still surfaced, not discarded', async () => {
    const receipt = makeReceipt()
    delete receipt.first_line
    delete receipt.city
    delete receipt.state
    delete receipt.zip
    stubReceiptsResponse([receipt])

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress).toEqual({
      name: 'Buyer One',
      street1: '',
      street2: undefined,
      city: '',
      state: '',
      postalCode: '',
      country: 'US',
      email: 'buyer@example.com',
    })
  })

  it('address present but buyer_email absent: shippingAddress.email is undefined, independent of the other address fields', async () => {
    const receipt = makeReceipt()
    delete receipt.buyer_email
    stubReceiptsResponse([receipt])

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress).toBeDefined()
    expect(orders[0].shippingAddress?.email).toBeUndefined()
    expect(orders[0].shippingAddress?.city).toBe('Springfield')
  })
})
