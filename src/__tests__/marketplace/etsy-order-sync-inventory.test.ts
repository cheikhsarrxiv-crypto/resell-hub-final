/**
 * Proves OrdersSyncService.syncOrders' stock-reservation branch — the same
 * generic code already tested for eBay in order-sync-inventory.test.ts —
 * behaves identically for Etsy, now that:
 *  - the cron routes dispatch Etsy connections to this same service
 *    (point 3, src/app/api/cron/sync-orders/route.ts),
 *  - EtsyAdapter.mapOrder() actually populates item.sku (point 4), and
 *  - AdapterFactory/getMarketplaceAdapterConfig resolve Etsy's own config
 *    generically (point 2).
 *
 * OrdersSyncService.syncOrders itself has NO per-marketplace branching in
 * its stock logic — it was always keyed purely on item.sku -> Product,
 * regardless of which adapter produced the order. So there is nothing
 * Etsy-specific to add here; this file exists to prove that claim with
 * the same rigor order-sync-inventory.test.ts already applied to eBay,
 * one-for-one, rather than assert it from reading the code alone.
 *
 * Same conventions as order-sync-inventory.test.ts: no real Etsy/DB access
 * here, so prisma is fully mocked and EtsyAdapter.getOrders is spied on.
 * This is a logic test, not a live-DB test — see
 * etsy-order-sync-inventory-live.test.ts for the real-DB, full-chain
 * (order -> reserve -> push-to-marketplace) proof.
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
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter'
import { Marketplace } from '@/types/marketplace'

process.env.ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID || 'test-etsy-client-id'
process.env.ETSY_CLIENT_SECRET = process.env.ETSY_CLIENT_SECRET || 'test-etsy-client-secret'
process.env.ETSY_REDIRECT_URI = process.env.ETSY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/etsy'
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64')

const WORKSPACE_ID = 'ws-etsy-inventory-test'

function makeEtsyOrder(overrides: Partial<any> = {}) {
  return {
    id: 'etsy-order-1',
    externalOrderId: 'etsy-receipt-1',
    buyerId: 'buyer-1',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    totalPrice: 29,
    status: 'paid',
    createdAt: new Date(),
    items: [{ listingId: 'ETSY-LISTING-1', title: 'Handmade Mug', quantity: 1, price: 29, sku: 'SKU-MUG' }],
    shippingAddress: undefined,
    ...overrides,
  }
}

function mockProduct(sku: string, id = `product-${sku}`) {
  return { id, workspaceId: WORKSPACE_ID, sku }
}

describe('OrdersSyncService — inventory reservation on new Etsy orders (parity with eBay)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null)
    ;(prisma.syncLog.create as any).mockResolvedValue({ id: 'synclog-etsy-1' })
    ;(prisma.syncLog.update as any).mockResolvedValue({})
    ;(prisma.order.create as any).mockResolvedValue({ id: 'created-order-etsy-1' })
    ;(prisma.inventory.updateMany as any).mockResolvedValue({ count: 1 })
    ;(prisma.inventory.findUnique as any).mockResolvedValue({
      productId: 'product-SKU-MUG',
      workspaceId: WORKSPACE_ID,
      available: 9,
      reserved: 1,
    })
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. reserves inventory (atomic decrement) for a brand-new Etsy order, via Etsy SKU -> Product', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-MUG'))
    vi.spyOn(EtsyAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeEtsyOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.ETSY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_sku: { workspaceId: WORKSPACE_ID, sku: 'SKU-MUG' } },
    })
    expect(prisma.inventory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'product-SKU-MUG', workspaceId: WORKSPACE_ID, available: { gte: 1 } },
        data: { available: { decrement: 1 }, reserved: { increment: 1 } },
      })
    )
  })

  it('2. creates an OrderItem linked to the resolved product for the new Etsy order', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-MUG'))
    vi.spyOn(EtsyAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeEtsyOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.ETSY)

    expect(prisma.orderItem.create).toHaveBeenCalledWith({
      data: { orderId: 'created-order-etsy-1', productId: 'product-SKU-MUG', title: 'Handmade Mug', quantity: 1, price: 29 },
    })
  })

  it('3. an Etsy order that already exists (a later status-update sync) never re-enters the stock logic: no second decrement', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue({ id: 'existing-order-1', status: 'pending' })
    ;(prisma.order.update as any).mockResolvedValue({})
    vi.spyOn(EtsyAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeEtsyOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.ETSY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.order.update).toHaveBeenCalledTimes(1)
    expect(prisma.order.create).not.toHaveBeenCalled()
    expect(prisma.product.findUnique).not.toHaveBeenCalled()
    expect(prisma.inventory.updateMany).not.toHaveBeenCalled() // no second decrement
    expect(prisma.orderItem.create).not.toHaveBeenCalled()
  })

  it("4. an Etsy SKU that doesn't match any Product is skipped without failing the sync or the order", async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.product.findUnique as any).mockResolvedValue(null) // no product for this SKU
    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([
        makeEtsyOrder({ items: [{ listingId: 'ETSY-LISTING-X', title: 'Mystery Item', quantity: 1, price: 15, sku: 'SKU-DOES-NOT-EXIST' }] }),
      ])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.ETSY)

    expect(result).toEqual({ processed: 1, failed: 0 }) // order itself still counted as processed
    expect(prisma.inventory.updateMany).not.toHaveBeenCalled()
    expect(prisma.orderItem.create).not.toHaveBeenCalled()
  })

  it('4b. an Etsy line item with no SKU at all (a listing without a SKU set) is skipped the same way, without throwing', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeEtsyOrder({ items: [{ listingId: 'ETSY-LISTING-X', title: 'No SKU Item', quantity: 1, price: 5 }] })])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.ETSY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.product.findUnique).not.toHaveBeenCalled()
    expect(prisma.orderItem.create).not.toHaveBeenCalled()
  })

  it('5. insufficient inventory on an Etsy order: still recorded, no exception, no negative stock applied', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.product.findUnique as any).mockResolvedValue(mockProduct('SKU-MUG'))
    ;(prisma.inventory.updateMany as any).mockResolvedValue({ count: 0 }) // atomic guard: not enough stock
    vi.spyOn(EtsyAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeEtsyOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await expect(service.syncOrders(WORKSPACE_ID, Marketplace.ETSY)).resolves.toEqual({ processed: 1, failed: 0 })

    expect(prisma.inventory.updateMany).toHaveBeenCalledTimes(1) // reservation was attempted
    expect(prisma.orderItem.create).toHaveBeenCalledTimes(1) // sale still recorded
  })

  it('6. an Etsy order with multiple lines and multiple SKUs reserves and records each line independently', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.product.findUnique as any).mockImplementation(async ({ where }: any) => mockProduct(where.workspaceId_sku.sku))
    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([
        makeEtsyOrder({
          items: [
            { listingId: 'ETSY-LISTING-MUG', title: 'Handmade Mug', quantity: 2, price: 29, sku: 'SKU-MUG' },
            { listingId: 'ETSY-LISTING-CANDLE', title: 'Candle', quantity: 3, price: 12, sku: 'SKU-CANDLE' },
            { listingId: 'ETSY-LISTING-CARD', title: 'Greeting Card', quantity: 1, price: 4, sku: 'SKU-CARD' },
          ],
        }),
      ])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.ETSY)

    expect(prisma.inventory.updateMany).toHaveBeenCalledTimes(3)
    expect(prisma.inventory.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { productId: 'product-SKU-MUG', workspaceId: WORKSPACE_ID, available: { gte: 2 } },
        data: { available: { decrement: 2 }, reserved: { increment: 2 } },
      })
    )
    expect(prisma.inventory.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { productId: 'product-SKU-CANDLE', workspaceId: WORKSPACE_ID, available: { gte: 3 } },
        data: { available: { decrement: 3 }, reserved: { increment: 3 } },
      })
    )
    expect(prisma.inventory.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: { productId: 'product-SKU-CARD', workspaceId: WORKSPACE_ID, available: { gte: 1 } },
        data: { available: { decrement: 1 }, reserved: { increment: 1 } },
      })
    )
    expect(prisma.orderItem.create).toHaveBeenCalledTimes(3)
    expect(prisma.orderItem.create).toHaveBeenNthCalledWith(1, {
      data: { orderId: 'created-order-etsy-1', productId: 'product-SKU-MUG', title: 'Handmade Mug', quantity: 2, price: 29 },
    })
    expect(prisma.orderItem.create).toHaveBeenNthCalledWith(2, {
      data: { orderId: 'created-order-etsy-1', productId: 'product-SKU-CANDLE', title: 'Candle', quantity: 3, price: 12 },
    })
    expect(prisma.orderItem.create).toHaveBeenNthCalledWith(3, {
      data: { orderId: 'created-order-etsy-1', productId: 'product-SKU-CARD', title: 'Greeting Card', quantity: 1, price: 4 },
    })
  })

  it('7. a multi-line order where only some lines have a matching SKU: matched lines reserve, unmatched lines are skipped, sync still succeeds', async () => {
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.product.findUnique as any).mockImplementation(async ({ where }: any) =>
      where.workspaceId_sku.sku === 'SKU-KNOWN' ? mockProduct('SKU-KNOWN') : null
    )
    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([
        makeEtsyOrder({
          items: [
            { listingId: 'L1', title: 'Known Item', quantity: 1, price: 10, sku: 'SKU-KNOWN' },
            { listingId: 'L2', title: 'Unknown Item', quantity: 1, price: 20, sku: 'SKU-UNKNOWN' },
          ],
        }),
      ])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.ETSY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.inventory.updateMany).toHaveBeenCalledTimes(1) // only the known SKU
    expect(prisma.orderItem.create).toHaveBeenCalledTimes(1)
  })
})
