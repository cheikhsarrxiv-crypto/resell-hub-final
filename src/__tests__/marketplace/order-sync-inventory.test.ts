/**
 * Tests the inventory-reservation fix added to OrdersSyncService.syncOrders:
 * a newly-synced eBay order now looks up the local Product by SKU
 * (Product.sku, @@unique([workspaceId, sku]) — NOT Listing.externalId,
 * which eBay sets to its own listingId instead, see EbayAdapter.createListing),
 * creates an OrderItem, and reserves inventory via the same atomic
 * ProductService.reserveInventory primitive the direct order-creation path
 * already uses (src/services/OrderService.ts). An already-known order (a
 * later status-update sync) must never re-enter this logic.
 *
 * Same conventions as cron-sync.test.ts: no real eBay/DB access here, so
 * prisma is fully mocked and EbayAdapter.getOrders is spied on. This is a
 * logic test, not a live-DB test.
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
  },
}))

import { prisma } from '@/lib/prisma'
import { OrdersSyncService } from '@/services/marketplace/OrdersSyncService'
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'
import { Marketplace } from '@/types/marketplace'

process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'test-client-id'
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-client-secret'
process.env.EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/ebay'
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64')

const WORKSPACE_ID = 'ws-inventory-test'

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: 'evt-order-1',
    externalOrderId: 'ebay-order-1',
    buyerId: 'buyer-1',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    totalPrice: 29,
    status: 'FULFILLED',
    createdAt: new Date(),
    items: [{ listingId: '', title: 'Widget', quantity: 1, price: 29, sku: 'SKU-WIDGET' }],
    shippingAddress: undefined,
    ...overrides,
  }
}

function mockProduct(sku: string, id = `product-${sku}`) {
  return { id, workspaceId: WORKSPACE_ID, sku };
}

describe('OrdersSyncService — inventory reservation on new eBay orders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null)
    ;(prisma.syncLog.create as any).mockResolvedValue({ id: 'synclog-1' })
    ;(prisma.syncLog.update as any).mockResolvedValue({})
    ;(prisma.order.create as any).mockResolvedValue({ id: 'created-order-1' })
    // Default: enough stock — inventory.updateMany's atomic WHERE (available >= quantity)
    // matched a row, so the decrement was applied.
    ;(prisma.inventory.updateMany as any).mockResolvedValue({ count: 1 })
    ;(prisma.inventory.findUnique as any).mockResolvedValue({
      productId: 'product-SKU-WIDGET',
      workspaceId: WORKSPACE_ID,
      available: 9,
      reserved: 1,
    })
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. reserves inventory (atomic decrement) for a brand-new eBay order', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null) // order doesn't exist yet
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-WIDGET'))
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeOrder()])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_sku: { workspaceId: WORKSPACE_ID, sku: 'SKU-WIDGET' } },
    })
    expect(prisma.inventory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'product-SKU-WIDGET', workspaceId: WORKSPACE_ID, available: { gte: 1 } },
        data: { available: { decrement: 1 }, reserved: { increment: 1 } },
      })
    )
  })

  it('2. creates an OrderItem linked to the resolved product for the new order', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-WIDGET'))
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeOrder()])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(prisma.orderItem.create).toHaveBeenCalledWith({
      data: {
        orderId: 'created-order-1',
        productId: 'product-SKU-WIDGET',
        title: 'Widget',
        quantity: 1,
        price: 29,
      },
    })
  })

  it('3. an order that already exists (e.g. a status-update redelivery) never re-enters the stock logic', async () => {
    // The stock-reservation loop lives entirely inside the "order didn't
    // exist yet" branch (see OrdersSyncService.syncOrders) — when
    // order.findFirst finds a match, only order.update runs. This proves
    // that structurally: a second sync of an already-known order can never
    // reserve inventory or create an OrderItem a second time, regardless
    // of how many times it's synced afterwards.
    ;(prisma.order.findFirst as any).mockResolvedValue({ id: 'existing-order-1', status: 'pending' })
    ;(prisma.order.update as any).mockResolvedValue({})
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeOrder()])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.order.update).toHaveBeenCalledTimes(1)
    expect(prisma.order.create).not.toHaveBeenCalled()
    expect(prisma.product.findUnique).not.toHaveBeenCalled() // stock logic never entered
    expect(prisma.inventory.updateMany).not.toHaveBeenCalled() // no reservation
    expect(prisma.orderItem.create).not.toHaveBeenCalled() // no OrderItem
  })

  it('4. an unmatched SKU is skipped without failing the sync or the order', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.product.findUnique as any).mockResolvedValue(null) // no product for this SKU
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeOrder({ items: [{ listingId: '', title: 'Mystery Item', quantity: 1, price: 15, sku: 'SKU-DOES-NOT-EXIST' }] })])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 1, failed: 0 }) // order itself still counted as processed
    expect(prisma.inventory.updateMany).not.toHaveBeenCalled()
    expect(prisma.orderItem.create).not.toHaveBeenCalled() // no OrderItem without a valid productId
  })

  it('4b. a line item missing a SKU entirely is skipped the same way, without throwing', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeOrder({ items: [{ listingId: '', title: 'No SKU Item', quantity: 1, price: 5 }] })])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.product.findUnique).not.toHaveBeenCalled()
    expect(prisma.orderItem.create).not.toHaveBeenCalled()
  })

  it('5. insufficient inventory: the order/item is still recorded, no exception, no negative stock applied', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-WIDGET'))
    // The atomic guard's WHERE (available >= quantity) matched zero rows —
    // exactly how reserveInventory signals "not enough stock" — so no
    // decrement was ever applied (this IS the no-negative-stock guarantee).
    ;(prisma.inventory.updateMany as any).mockResolvedValue({ count: 0 })
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeOrder()])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await expect(service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)).resolves.toEqual({
      processed: 1,
      failed: 0,
    }) // must not throw / must not count as a failed order

    expect(prisma.inventory.updateMany).toHaveBeenCalledTimes(1) // reservation was attempted
    // Defined behavior: the sale is still recorded for accounting/reconciliation
    // even though the stock discrepancy needs manual follow-up.
    expect(prisma.orderItem.create).toHaveBeenCalledTimes(1)
  })

  it('6. a multi-line order reserves and records each line item independently', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.product.findUnique as any).mockImplementation(async ({ where }: any) =>
      mockProduct(where.workspaceId_sku.sku)
    )
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

    expect(prisma.inventory.updateMany).toHaveBeenCalledTimes(2)
    expect(prisma.inventory.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { productId: 'product-SKU-WIDGET', workspaceId: WORKSPACE_ID, available: { gte: 2 } },
        data: { available: { decrement: 2 }, reserved: { increment: 2 } },
      })
    )
    expect(prisma.inventory.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { productId: 'product-SKU-GADGET', workspaceId: WORKSPACE_ID, available: { gte: 1 } },
        data: { available: { decrement: 1 }, reserved: { increment: 1 } },
      })
    )
    expect(prisma.orderItem.create).toHaveBeenCalledTimes(2)
    expect(prisma.orderItem.create).toHaveBeenNthCalledWith(1, {
      data: { orderId: 'created-order-1', productId: 'product-SKU-WIDGET', title: 'Widget', quantity: 2, price: 29 },
    })
    expect(prisma.orderItem.create).toHaveBeenNthCalledWith(2, {
      data: { orderId: 'created-order-1', productId: 'product-SKU-GADGET', title: 'Gadget', quantity: 1, price: 15 },
    })
  })
})
