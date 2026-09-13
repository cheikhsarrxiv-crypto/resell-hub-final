/**
 * Point 5: EtsyAdapter.updateOrderStatus() used to send Etsy's
 * createReceiptShipment endpoint (POST /shops/{shop_id}/receipts/{receipt_id}/tracking)
 * with hardcoded empty tracking_code/carrier_name — a request Etsy's own
 * docs say must include both fields. Fixed to take a real
 * MarketplaceOrderTrackingInfo ({ trackingNumber, carrier }) and reject
 * before ever calling Etsy when it's missing, partial, or empty.
 *
 * Verified before writing this fix (Etsy's own domain is egress-blocked
 * here, same as the rest of this session): a web search of Etsy's Open
 * API v3 docs confirms "The createReceiptShipment request body must
 * include tracking_code string ... and carrier_name string", and GitHub
 * discussions (etsy/open-api#1364, #1235) from real integrators confirm
 * those are exactly the JSON field names the endpoint expects (their
 * reported issues were with how they encoded the body, not the field
 * names) — so the endpoint path and field names already in this code were
 * correct; only the empty-string bug needed fixing.
 *
 * updateOrderStatus is still not called by anything in this codebase
 * (confirmed: no caller of adapter.updateOrderStatus exists — OrderService.
 * updateOrderStatus only does a local `prisma.order.update({status})` and
 * doesn't even accept tracking info as input), so this is adapter-level
 * only, same convention as the other adapter-focused test files.
 *
 * No real network here: global fetch is stubbed, and validateConnection's
 * network call is skipped by pre-setting shopId directly on the instance
 * (irrelevant to this fix — see etsy-order-sku.test.ts for the same
 * pattern).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'

function stubFetchOnce(response: { ok: boolean; status?: number; json?: any }) {
  const fetchMock = vi.fn(async (_url: string, _init?: any) => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    statusText: response.ok ? 'OK' : 'Error',
    json: async () => response.json ?? {},
    text: async () => JSON.stringify(response.json ?? {}),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function newEtsyAdapter() {
  const adapter = new EtsyAdapter({
    clientId: 'test-etsy-client-id',
    clientSecret: 'test-etsy-client-secret',
    redirectUri: 'http://localhost/api/marketplace/callback/etsy',
  })
  adapter.setAccessToken('fake-access-token')
  ;(adapter as any).shopId = 'shop-1' // skip validateConnection() — unrelated to this fix
  return adapter
}

function newEbayAdapter() {
  const adapter = new EbayAdapter({
    clientId: 'test-ebay-client-id',
    clientSecret: 'test-ebay-client-secret',
    redirectUri: 'http://localhost/api/marketplace/callback/ebay',
  })
  adapter.setAccessToken('fake-access-token')
  return adapter
}

describe('EtsyAdapter.updateOrderStatus — tracking info required to mark an order shipped', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shipped with valid tracking: sends the correct Etsy payload (tracking_code + carrier_name)', async () => {
    const fetchMock = stubFetchOnce({ ok: true, json: { tracking_code: 'TRACK-123', carrier_name: 'USPS' } })

    await newEtsyAdapter().updateOrderStatus('receipt-1', 'shipped', {
      trackingNumber: 'TRACK-123',
      carrier: 'USPS',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.etsy.com/v3/application/shops/shop-1/receipts/receipt-1/tracking')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ tracking_code: 'TRACK-123', carrier_name: 'USPS' })
  })

  it('missing tracking info entirely: rejects cleanly, never calls Etsy', async () => {
    const fetchMock = stubFetchOnce({ ok: true, json: {} })

    await expect(newEtsyAdapter().updateOrderStatus('receipt-1', 'shipped')).rejects.toThrow(/trackingNumber/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('trackingNumber present but carrier missing: rejects cleanly, never calls Etsy', async () => {
    const fetchMock = stubFetchOnce({ ok: true, json: {} })

    await expect(
      newEtsyAdapter().updateOrderStatus('receipt-1', 'shipped', { trackingNumber: 'TRACK-1', carrier: '' as any })
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('carrier present but trackingNumber missing: rejects cleanly, never calls Etsy', async () => {
    const fetchMock = stubFetchOnce({ ok: true, json: {} })

    await expect(
      newEtsyAdapter().updateOrderStatus('receipt-1', 'shipped', { trackingNumber: '', carrier: 'USPS' })
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never sends a request with an empty tracking_code or carrier_name, however the caller invokes it', async () => {
    const fetchMock = stubFetchOnce({ ok: true, json: {} })
    const attempts: Array<Promise<void>> = [
      newEtsyAdapter().updateOrderStatus('r1', 'shipped'),
      newEtsyAdapter().updateOrderStatus('r2', 'shipped', undefined),
      newEtsyAdapter().updateOrderStatus('r3', 'shipped', { trackingNumber: '', carrier: '' }),
      newEtsyAdapter().updateOrderStatus('r4', 'shipped', { trackingNumber: 'TRACK-1', carrier: '' }),
      newEtsyAdapter().updateOrderStatus('r5', 'shipped', { trackingNumber: '', carrier: 'USPS' }),
    ]

    for (const attempt of attempts) {
      await expect(attempt).rejects.toThrow()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an unsupported status is rejected before tracking is even checked (no network call, even with valid tracking)', async () => {
    const fetchMock = stubFetchOnce({ ok: true, json: {} })

    await expect(
      newEtsyAdapter().updateOrderStatus('receipt-1', 'delivered', { trackingNumber: 'TRACK-1', carrier: 'USPS' })
    ).rejects.toThrow(/only supports "shipped"/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a real Etsy API failure (e.g. 400) still surfaces as a normalized error, tracking having been valid', async () => {
    stubFetchOnce({ ok: false, status: 400, json: { error: 'invalid carrier' } })

    await expect(
      newEtsyAdapter().updateOrderStatus('receipt-1', 'shipped', { trackingNumber: 'TRACK-1', carrier: 'not-a-real-carrier' })
    ).rejects.toBeTruthy()
  })
})

describe('EbayAdapter.updateOrderStatus — no regression from the shared signature change', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('still sends { orderStatus: status } via PATCH, called the same way as before (2 args)', async () => {
    const fetchMock = stubFetchOnce({ ok: true, json: {} })

    await newEbayAdapter().updateOrderStatus('order-1', 'shipped')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/sell/fulfillment/v1/order/order-1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ orderStatus: 'shipped' })
  })

  it('ignores an unused trackingInfo third argument (structurally accepted, behaviorally irrelevant to eBay)', async () => {
    const fetchMock = stubFetchOnce({ ok: true, json: {} })

    await (newEbayAdapter().updateOrderStatus as any)('order-1', 'shipped', {
      trackingNumber: 'TRACK-1',
      carrier: 'USPS',
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ orderStatus: 'shipped' }) // unchanged — no tracking fields leaked in
  })
})
