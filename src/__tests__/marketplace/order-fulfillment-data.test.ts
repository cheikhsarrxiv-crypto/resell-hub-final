/**
 * Step 1 of the fulfillment data-model plan: OrdersSyncService.syncOrders
 * now also persists, on a newly-created Order:
 *  - marketplace (the origin marketplace, 'ebay' | 'etsy')
 *  - the full shipping address (shippingAddress2, shippingState,
 *    shippingPhone, shippingEmail — in addition to the existing
 *    shippingAddress/City/PostalCode/Country)
 *  - listingId, best-effort-resolved (see "listingId resolution" below)
 * and on each OrderItem it creates:
 *  - purchasePrice, a historical snapshot of Product.purchasePrice at the
 *    moment of the sale (never re-read from Product afterwards).
 *
 * Same conventions as order-sync-inventory.test.ts / etsy-order-sync-inventory.test.ts:
 * no real DB/network here, prisma is fully mocked, adapters' getOrders is
 * spied. See order-fulfillment-data-live.test.ts for the real-DB,
 * full-chain proof of the same behavior (listingId with real Listing rows,
 * purchasePrice immutability after a later Product edit, OrderService.createOrder).
 */
import crypto from 'crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    syncLog: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    order: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    orderItem: { create: vi.fn() },
    product: { findUnique: vi.fn() },
    inventory: { updateMany: vi.fn(), findUnique: vi.fn() },
    listing: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { OrdersSyncService } from '@/services/marketplace/OrdersSyncService'
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter'
import { Marketplace } from '@/types/marketplace'

process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'test-ebay-client-id'
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-ebay-client-secret'
process.env.EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/ebay'
process.env.ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID || 'test-etsy-client-id'
process.env.ETSY_CLIENT_SECRET = process.env.ETSY_CLIENT_SECRET || 'test-etsy-client-secret'
process.env.ETSY_REDIRECT_URI = process.env.ETSY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/etsy'
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64')

const WORKSPACE_ID = 'ws-fulfillment-data-test'

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    externalOrderId: 'ext-order-1',
    buyerId: 'buyer-1',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    totalPrice: 29,
    status: 'FULFILLED',
    createdAt: new Date(),
    items: [{ listingId: '', title: 'Widget', quantity: 1, price: 29, sku: 'SKU-WIDGET' }],
    shippingAddress: {
      name: 'Jane Doe',
      street1: '123 Main St',
      street2: 'Apt 4B',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62704',
      country: 'US',
      phone: '+15551234567',
      email: 'jane@example.com',
    },
    ...overrides,
  }
}

function mockProduct(sku: string, overrides: Partial<any> = {}) {
  return { id: `product-${sku}`, workspaceId: WORKSPACE_ID, sku, purchasePrice: 5.5, ...overrides }
}

describe('OrdersSyncService — marketplace tag and full shipping address on new orders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null)
    ;(prisma.syncLog.create as any).mockResolvedValue({ id: 'synclog-1' })
    ;(prisma.syncLog.update as any).mockResolvedValue({})
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.order.create as any).mockResolvedValue({ id: 'created-order-1' })
    ;(prisma.inventory.updateMany as any).mockResolvedValue({ count: 1 })
    ;(prisma.inventory.findUnique as any).mockResolvedValue({ available: 9, reserved: 1 })
    ;(prisma.listing.findMany as any).mockResolvedValue([])
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("an eBay order's created Order row gets marketplace: 'ebay' and the full address", async () => {
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-WIDGET'))
    vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          marketplace: 'ebay',
          shippingAddress: '123 Main St',
          shippingAddress2: 'Apt 4B',
          shippingCity: 'Springfield',
          shippingState: 'IL',
          shippingPostalCode: '62704',
          shippingCountry: 'US',
          shippingPhone: '+15551234567',
          shippingEmail: 'jane@example.com',
        }),
      })
    )
  })

  it("an Etsy order's created Order row gets marketplace: 'etsy'", async () => {
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-WIDGET'))
    vi.spyOn(EtsyAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.ETSY)

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ marketplace: 'etsy' }) })
    )
  })

  it('optional address fields (street2, state, phone, email) absent: the order is still created, with null for those fields, no error', async () => {
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-WIDGET'))
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([
        makeOrder({
          shippingAddress: { name: 'John Smith', street1: '456 Oak Ave', city: 'Austin', postalCode: '73301', country: 'US' },
        }),
      ])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shippingAddress: '456 Oak Ave',
          shippingAddress2: null,
          shippingState: null,
          shippingPhone: null,
          shippingEmail: null,
        }),
      })
    )
  })

  it('no shippingAddress at all on the marketplace order: the order is still created, all shipping fields fall back cleanly, no error', async () => {
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-WIDGET'))
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeOrder({ shippingAddress: undefined })])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shippingAddress: '',
          shippingAddress2: null,
          shippingCity: '',
          shippingState: null,
          shippingPostalCode: '',
          shippingCountry: '',
          shippingPhone: null,
          shippingEmail: null,
        }),
      })
    )
  })
})

describe('OrdersSyncService — OrderItem.purchasePrice snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null)
    ;(prisma.syncLog.create as any).mockResolvedValue({ id: 'synclog-1' })
    ;(prisma.syncLog.update as any).mockResolvedValue({})
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.order.create as any).mockResolvedValue({ id: 'created-order-1' })
    ;(prisma.inventory.updateMany as any).mockResolvedValue({ count: 1 })
    ;(prisma.inventory.findUnique as any).mockResolvedValue({ available: 9, reserved: 1 })
    ;(prisma.listing.findMany as any).mockResolvedValue([])
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("OrderItem.purchasePrice is snapshotted from the resolved Product's current purchasePrice", async () => {
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-WIDGET', { purchasePrice: 12.34 }))
    vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(prisma.orderItem.create).toHaveBeenCalledWith({
      data: {
        orderId: 'created-order-1',
        productId: 'product-SKU-WIDGET',
        title: 'Widget',
        quantity: 1,
        price: 29,
        purchasePrice: 12.34,
      },
    })
  })

  it('a multi-line order snapshots each product purchasePrice independently', async () => {
    ;(prisma.product.findUnique as any).mockImplementation(async ({ where }: any) => {
      const sku = where.workspaceId_sku.sku
      return mockProduct(sku, { purchasePrice: sku === 'SKU-WIDGET' ? 10 : 3.5 })
    })
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([
        makeOrder({
          items: [
            { listingId: '', title: 'Widget', quantity: 2, price: 29, sku: 'SKU-WIDGET' },
            { listingId: '', title: 'Gadget', quantity: 1, price: 15, sku: 'SKU-GADGET' },
          ],
        }),
      ])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(prisma.orderItem.create).toHaveBeenCalledTimes(2)
    expect(prisma.orderItem.create).toHaveBeenNthCalledWith(1, {
      data: { orderId: 'created-order-1', productId: 'product-SKU-WIDGET', title: 'Widget', quantity: 2, price: 29, purchasePrice: 10 },
    })
    expect(prisma.orderItem.create).toHaveBeenNthCalledWith(2, {
      data: { orderId: 'created-order-1', productId: 'product-SKU-GADGET', title: 'Gadget', quantity: 1, price: 15, purchasePrice: 3.5 },
    })
  })

  it("a SKU repeated across two lines still snapshots the same correct purchasePrice on each resulting OrderItem", async () => {
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-WIDGET', { purchasePrice: 7 }))
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([
        makeOrder({
          items: [
            { listingId: '', title: 'Widget', quantity: 1, price: 29, sku: 'SKU-WIDGET' },
            { listingId: '', title: 'Widget (again)', quantity: 1, price: 29, sku: 'SKU-WIDGET' },
          ],
        }),
      ])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(prisma.orderItem.create).toHaveBeenCalledTimes(2)
    expect(prisma.orderItem.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ purchasePrice: 7 }) }))
    expect(prisma.orderItem.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ purchasePrice: 7 }) }))
  })
})

describe('OrdersSyncService — Order.listingId resolution (0 / 1 / many active listings)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null)
    ;(prisma.syncLog.create as any).mockResolvedValue({ id: 'synclog-1' })
    ;(prisma.syncLog.update as any).mockResolvedValue({})
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.order.create as any).mockResolvedValue({ id: 'created-order-1' })
    ;(prisma.inventory.updateMany as any).mockResolvedValue({ count: 1 })
    ;(prisma.inventory.findUnique as any).mockResolvedValue({ available: 9, reserved: 1 })
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-WIDGET'))
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('0 active listings for this product on this marketplace: listingId stays null', async () => {
    ;(prisma.listing.findMany as any).mockResolvedValue([])
    vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ listingId: null }) }))
  })

  it('exactly 1 active listing: listingId is that listing id', async () => {
    ;(prisma.listing.findMany as any).mockResolvedValue([{ id: 'listing-abc' }])
    vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ listingId: 'listing-abc' }) }))
    expect(prisma.listing.findMany).toHaveBeenCalledWith({
      where: {
        productId: 'product-SKU-WIDGET',
        workspaceId: WORKSPACE_ID,
        status: 'active',
        deletedAt: null,
        connection: { marketplaceId: Marketplace.EBAY },
      },
      select: { id: true },
    })
  })

  it('multiple active listings match: never guesses, listingId stays null', async () => {
    ;(prisma.listing.findMany as any).mockResolvedValue([{ id: 'listing-abc' }, { id: 'listing-xyz' }])
    vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ listingId: null }) }))
  })

  it('no line item resolves a Product at all: listing.findMany is never called, listingId stays null', async () => {
    ;(prisma.product.findUnique as any).mockResolvedValue(null)
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeOrder({ items: [{ listingId: '', title: 'Unknown', quantity: 1, price: 5, sku: 'SKU-UNKNOWN' }] })])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(prisma.listing.findMany).not.toHaveBeenCalled()
    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ listingId: null }) }))
  })
})
