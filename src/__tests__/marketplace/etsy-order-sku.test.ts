/**
 * Point 4: EtsyAdapter.getOrders()/mapOrder() must surface the real SKU
 * Etsy returns on each receipt transaction (line item), the same way
 * EbayAdapter.getOrders() already does via `item.sku` (see
 * ebay-oauth.test.ts / the eBay Fulfillment API response shape).
 *
 * Verified before writing this: Etsy's Open API v3 Transaction object
 * (embedded inline in every /shops/{shopId}/receipts response, under
 * `results[].transactions[]`) has its own top-level `sku` field —
 * `string | null`, independent of `listing_id`. This is not documented in
 * detail on Etsy's reference pages (only reachable via web search in this
 * sandbox — direct fetches to developer.etsy.com/etsy.com are egress-
 * blocked here), but is confirmed by a real transaction JSON sample
 * (`"sku":"NY098","product_id":...`) and by the field list of a
 * swagger-generated Etsy v3 TypeScript client
 * (IShopReceiptTransaction.sku?: string | null in etsy-ts/similar
 * generated clients). It is nullable: a listing with no SKU set has
 * transaction.sku === null.
 *
 * No real network here — same convention as ebay-oauth.test.ts's
 * createListing tests: global fetch is stubbed to serve a fixed JSON
 * receipts response, and the real adapter code (getOrders -> mapOrder) is
 * exercised end-to-end against it. shopId is pre-set directly on the
 * adapter instance to skip the separate validateConnection() network
 * calls (out of scope here — shop_id resolution is unrelated to this fix).
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

function makeReceipt(overrides: Partial<any> = {}) {
  return {
    receipt_id: 111,
    buyer_user_id: 222,
    name: 'Buyer One',
    buyer_email: 'buyer@example.com',
    grandtotal: { amount: 2500, divisor: 100 },
    status: 'paid',
    created_timestamp: 1700000000,
    transactions: [],
    ...overrides,
  }
}

function makeTransaction(overrides: Partial<any> = {}) {
  return {
    listing_id: 999,
    title: 'A test item',
    quantity: 1,
    price: { amount: 1000, divisor: 100 },
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

describe('EtsyAdapter.getOrders() — SKU extraction on order line items', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a single-line receipt with a SKU: sku is correctly surfaced, other fields unaffected (no regression)', async () => {
    stubReceiptsResponse([
      makeReceipt({
        transactions: [makeTransaction({ sku: 'ETSY-SKU-1', title: 'Handmade Mug', quantity: 2, listing_id: 42 })],
      }),
    ])

    const orders = await newAdapter().getOrders()

    expect(orders).toHaveLength(1)
    expect(orders[0].items).toHaveLength(1)
    expect(orders[0].items[0]).toEqual({
      listingId: '42',
      title: 'Handmade Mug',
      quantity: 2,
      price: 10,
      sku: 'ETSY-SKU-1',
    })
    // Receipt-level mapping (buyer, total, status) still correct alongside the sku fix.
    expect(orders[0].externalOrderId).toBe('111')
    expect(orders[0].buyerName).toBe('Buyer One')
    expect(orders[0].totalPrice).toBe(25)
  })

  it('multiple lines with different SKUs are each mapped to their own correct SKU, in order', async () => {
    stubReceiptsResponse([
      makeReceipt({
        transactions: [
          makeTransaction({ sku: 'SKU-AAA', title: 'Item A', listing_id: 1 }),
          makeTransaction({ sku: 'SKU-BBB', title: 'Item B', listing_id: 2 }),
          makeTransaction({ sku: 'SKU-CCC', title: 'Item C', listing_id: 3 }),
        ],
      }),
    ])

    const orders = await newAdapter().getOrders()

    expect(orders[0].items.map((i) => i.sku)).toEqual(['SKU-AAA', 'SKU-BBB', 'SKU-CCC'])
    expect(orders[0].items.map((i) => i.listingId)).toEqual(['1', '2', '3'])
    // Each SKU landed on its own line, never bled into a neighboring one.
    expect(orders[0].items[0].title).toBe('Item A')
    expect(orders[0].items[1].title).toBe('Item B')
    expect(orders[0].items[2].title).toBe('Item C')
  })

  it('a transaction with no sku field at all maps to undefined, does not throw', async () => {
    stubReceiptsResponse([makeReceipt({ transactions: [makeTransaction()] })]) // no `sku` key

    const orders = await newAdapter().getOrders()

    expect(orders[0].items[0].sku).toBeUndefined()
  })

  it('a transaction with sku explicitly null maps to undefined, does not throw', async () => {
    stubReceiptsResponse([makeReceipt({ transactions: [makeTransaction({ sku: null })] })])

    const orders = await newAdapter().getOrders()

    expect(orders[0].items[0].sku).toBeUndefined()
  })

  it('a transaction with an empty-string sku maps to undefined (treated as no SKU)', async () => {
    stubReceiptsResponse([makeReceipt({ transactions: [makeTransaction({ sku: '' })] })])

    const orders = await newAdapter().getOrders()

    expect(orders[0].items[0].sku).toBeUndefined()
  })

  it('a receipt with a mix of SKU-present and SKU-missing lines handles both cleanly in one sync pass', async () => {
    stubReceiptsResponse([
      makeReceipt({
        transactions: [
          makeTransaction({ sku: 'SKU-PRESENT', listing_id: 1 }),
          makeTransaction({ sku: null, listing_id: 2 }),
        ],
      }),
    ])

    const orders = await newAdapter().getOrders()

    expect(orders[0].items[0].sku).toBe('SKU-PRESENT')
    expect(orders[0].items[1].sku).toBeUndefined()
    // The whole sync still completes and returns both lines — a missing
    // SKU on one line never drops or fails the other line or the receipt.
    expect(orders[0].items).toHaveLength(2)
  })

  it('never throws when a receipt has zero transactions', async () => {
    stubReceiptsResponse([makeReceipt({ transactions: [] })])

    const orders = await newAdapter().getOrders()

    expect(orders[0].items).toEqual([])
  })
})
