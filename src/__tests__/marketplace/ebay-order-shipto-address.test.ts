/**
 * Step 0 of the fulfillment audit's plan: EbayAdapter.getOrders()/getOrder()
 * read fulfillmentStartInstructions[].shippingStep.shippingAddress — a path
 * that does not exist on eBay's real Fulfillment API response. The real
 * shipping-address container is shippingStep.shipTo (an ExtendedContact),
 * so order.shippingAddress was always undefined and every synced eBay order
 * got a blank address in the DB (shippingAddress/City/PostalCode/Country all
 * fell back to '' in OrdersSyncService).
 *
 * Verified against eBay's real Fulfillment API type reference before fixing
 * (developer.ebay.com itself is egress-blocked in this sandbox, so this was
 * done via web search, corroborated by two independent results):
 * - FulfillmentStartInstruction.shippingStep.shipTo is of type ExtendedContact:
 *   fullName, email, primaryPhone (a PhoneNumber object: { phoneNumber }),
 *   contactAddress: { addressLine1, addressLine2, city, stateOrProvince,
 *   postalCode, countryCode, county }.
 * - fulfillmentStartInstructions can contain more than one instruction
 *   (e.g. a PREPARE_FOR_PICKUP / Click & Collect one alongside a SHIP_TO
 *   one) — blindly taking index [0] can silently grab the wrong one.
 * - primaryPhone is not returned by eBay at all for orders older than 90
 *   days — a real eBay limitation, not something this mapping should (or
 *   even could) work around.
 *
 * No real eBay network here: global fetch is stubbed with realistic eBay
 * Fulfillment API response fixtures, same convention as
 * ebay-oauth.test.ts's createListing tests.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'

function stubFetchOnce(json: any) {
  const fetchMock = vi.fn(async (_url: string, _init?: any) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => json,
    text: async () => JSON.stringify(json),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function newAdapter() {
  const adapter = new EbayAdapter({
    clientId: 'test-ebay-client-id',
    clientSecret: 'test-ebay-client-secret',
    redirectUri: 'http://localhost/api/marketplace/callback/ebay',
  })
  adapter.setAccessToken('fake-access-token')
  return adapter
}

function makeRawOrder(overrides: Partial<any> = {}) {
  return {
    orderId: '12-34567-89012',
    orderStatus: 'IN_PROGRESS',
    creationDate: '2024-01-15T10:30:00.000Z',
    buyer: { username: 'buyer123', email: 'buyer@example.com' },
    pricingSummary: { total: { value: '29.99', currency: 'USD' } },
    lineItems: [{ title: 'Widget', quantity: 2, lineItemPrice: { value: '29.99' }, sku: 'SKU-WIDGET' }],
    fulfillmentStartInstructions: [
      {
        fulfillmentInstructionsType: 'SHIP_TO',
        shippingStep: {
          shipTo: {
            fullName: 'Jane Doe',
            email: 'jane@example.com',
            primaryPhone: { phoneNumber: '+15551234567' },
            contactAddress: {
              addressLine1: '123 Main St',
              addressLine2: 'Apt 4B',
              city: 'Springfield',
              stateOrProvince: 'IL',
              postalCode: '62704',
              countryCode: 'US',
            },
          },
        },
      },
    ],
    ...overrides,
  }
}

describe('EbayAdapter.getOrders() — shipTo address mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a complete shipTo is correctly mapped to every Address field', async () => {
    stubFetchOnce({ orders: [makeRawOrder()] })

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress).toEqual({
      name: 'Jane Doe',
      street1: '123 Main St',
      street2: 'Apt 4B',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62704',
      country: 'US',
      phone: '+15551234567',
      email: 'jane@example.com',
    })
  })

  it('addressLine2 absent: street2 is undefined, everything else still maps', async () => {
    stubFetchOnce({
      orders: [
        makeRawOrder({
          fulfillmentStartInstructions: [
            {
              fulfillmentInstructionsType: 'SHIP_TO',
              shippingStep: {
                shipTo: {
                  fullName: 'Jane Doe',
                  email: 'jane@example.com',
                  primaryPhone: { phoneNumber: '+15551234567' },
                  contactAddress: {
                    addressLine1: '123 Main St',
                    city: 'Springfield',
                    stateOrProvince: 'IL',
                    postalCode: '62704',
                    countryCode: 'US',
                  },
                },
              },
            },
          ],
        }),
      ],
    })

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress?.street2).toBeUndefined()
    expect(orders[0].shippingAddress?.street1).toBe('123 Main St')
    expect(orders[0].shippingAddress?.city).toBe('Springfield')
  })

  it('optional fields absent/null (email, phone, state): required fields still map, optional ones are undefined, never throws', async () => {
    stubFetchOnce({
      orders: [
        makeRawOrder({
          fulfillmentStartInstructions: [
            {
              fulfillmentInstructionsType: 'SHIP_TO',
              shippingStep: {
                shipTo: {
                  fullName: 'John Smith',
                  email: null,
                  primaryPhone: null, // eBay omits this entirely for orders > 90 days old
                  contactAddress: {
                    addressLine1: '456 Oak Ave',
                    addressLine2: null,
                    city: 'Austin',
                    stateOrProvince: null,
                    postalCode: '73301',
                    countryCode: 'US',
                  },
                },
              },
            },
          ],
        }),
      ],
    })

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress).toEqual({
      name: 'John Smith',
      street1: '456 Oak Ave',
      street2: undefined,
      city: 'Austin',
      state: undefined,
      postalCode: '73301',
      country: 'US',
      phone: undefined,
      email: undefined,
    })
  })

  it('an order with no fulfillmentStartInstructions at all: shippingAddress is undefined, never throws', async () => {
    stubFetchOnce({ orders: [makeRawOrder({ fulfillmentStartInstructions: undefined })] })

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress).toBeUndefined()
  })

  it('an order with an empty fulfillmentStartInstructions array: shippingAddress is undefined, never throws', async () => {
    stubFetchOnce({ orders: [makeRawOrder({ fulfillmentStartInstructions: [] })] })

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress).toBeUndefined()
  })

  it('an instruction with no shipTo container (e.g. DIGITAL) maps to an undefined address without throwing', async () => {
    stubFetchOnce({
      orders: [
        makeRawOrder({
          fulfillmentStartInstructions: [{ fulfillmentInstructionsType: 'DIGITAL', shippingStep: undefined }],
        }),
      ],
    })

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress).toBeUndefined()
  })

  it('multiple instructions: the SHIP_TO one is used even when it is not first', async () => {
    stubFetchOnce({
      orders: [
        makeRawOrder({
          fulfillmentStartInstructions: [
            {
              // A Click & Collect instruction first — has no real buyer shipTo, must NOT be used.
              fulfillmentInstructionsType: 'PREPARE_FOR_PICKUP',
              shippingStep: { shipTo: { fullName: 'STORE PICKUP - do not use', contactAddress: { addressLine1: 'Store address', city: 'WrongCity', postalCode: '00000', countryCode: 'XX' } } },
            },
            {
              fulfillmentInstructionsType: 'SHIP_TO',
              shippingStep: {
                shipTo: {
                  fullName: 'Real Buyer',
                  contactAddress: { addressLine1: '789 Real St', city: 'RealCity', postalCode: '11111', countryCode: 'US' },
                },
              },
            },
          ],
        }),
      ],
    })

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress?.name).toBe('Real Buyer')
    expect(orders[0].shippingAddress?.city).toBe('RealCity')
    expect(orders[0].shippingAddress?.street1).toBe('789 Real St')
  })

  it('multiple instructions with no fulfillmentInstructionsType tag at all: falls back to the first instruction that actually has a shipTo', async () => {
    stubFetchOnce({
      orders: [
        makeRawOrder({
          fulfillmentStartInstructions: [
            { shippingStep: undefined }, // no type tag, no shipTo — must be skipped
            { shippingStep: { shipTo: { fullName: 'Untagged Buyer', contactAddress: { addressLine1: '1 Untagged Way', city: 'Untagged', postalCode: '22222', countryCode: 'US' } } } },
          ],
        }),
      ],
    })

    const orders = await newAdapter().getOrders()

    expect(orders[0].shippingAddress?.name).toBe('Untagged Buyer')
  })

  it('no regression: order id, buyer, price, status, and line items (title/quantity/price/sku) still map correctly alongside the address fix', async () => {
    stubFetchOnce({ orders: [makeRawOrder()] })

    const orders = await newAdapter().getOrders()

    expect(orders[0].id).toBe('12-34567-89012')
    expect(orders[0].externalOrderId).toBe('12-34567-89012')
    expect(orders[0].buyerId).toBe('buyer123')
    expect(orders[0].buyerName).toBe('buyer123')
    expect(orders[0].buyerEmail).toBe('buyer@example.com')
    expect(orders[0].totalPrice).toBe(29.99)
    expect(orders[0].status).toBe('IN_PROGRESS')
    expect(orders[0].createdAt).toEqual(new Date('2024-01-15T10:30:00.000Z'))
    expect(orders[0].items).toEqual([{ title: 'Widget', quantity: 2, price: 29.99, sku: 'SKU-WIDGET' }])
  })

  it('a multi-line order maps every line item correctly alongside the address fix', async () => {
    stubFetchOnce({
      orders: [
        makeRawOrder({
          lineItems: [
            { title: 'Widget', quantity: 2, lineItemPrice: { value: '10.00' }, sku: 'SKU-A' },
            { title: 'Gadget', quantity: 1, lineItemPrice: { value: '15.00' }, sku: 'SKU-B' },
          ],
        }),
      ],
    })

    const orders = await newAdapter().getOrders()

    expect(orders[0].items).toEqual([
      { title: 'Widget', quantity: 2, price: 10.0, sku: 'SKU-A' },
      { title: 'Gadget', quantity: 1, price: 15.0, sku: 'SKU-B' },
    ])
  })
})

describe('EbayAdapter.getOrder() — same shipTo mapping fix, single-order getter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps a complete shipTo the same way as getOrders()', async () => {
    stubFetchOnce(makeRawOrder())

    const order = await newAdapter().getOrder('12-34567-89012')

    expect(order.shippingAddress).toEqual({
      name: 'Jane Doe',
      street1: '123 Main St',
      street2: 'Apt 4B',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62704',
      country: 'US',
      phone: '+15551234567',
      email: 'jane@example.com',
    })
    // No regression on the rest of the single-order mapping either.
    expect(order.id).toBe('12-34567-89012')
    expect(order.totalPrice).toBe(29.99)
    expect(order.status).toBe('IN_PROGRESS')
  })

  it('no fulfillmentStartInstructions: shippingAddress is undefined, never throws', async () => {
    stubFetchOnce(makeRawOrder({ fulfillmentStartInstructions: undefined }))

    const order = await newAdapter().getOrder('12-34567-89012')

    expect(order.shippingAddress).toBeUndefined()
  })
})
