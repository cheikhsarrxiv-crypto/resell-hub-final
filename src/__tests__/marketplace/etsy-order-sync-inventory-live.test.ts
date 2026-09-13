/**
 * Full-chain, real-DB proof of the requested Etsy pipeline:
 *   Etsy order -> SKU -> Product -> Inventory.available -> reserveInventory
 *   -> push new quantity to every active marketplace listing (correct
 *   identifier per marketplace)
 * driven end-to-end through OrdersSyncService.syncOrders(workspaceId, ETSY)
 * — not by calling ProductService/ListingService directly (see
 * inventory-identifier-per-marketplace.test.ts for that lower-level proof).
 *
 * Only the network boundary is mocked: EtsyAdapter.getOrders (no real Etsy
 * credentials here) and both adapters' updateInventory (no real eBay/Etsy
 * network access). Everything in between — OrdersSyncService, ProductService,
 * ListingService, real token decryption, real Prisma queries — is real,
 * same convention as inventory-identifier-per-marketplace.test.ts.
 *
 * Real DB (describe.skipIf(!dbAvailable)) — skips in this sandbox (no
 * Postgres access here) but runs wherever a DB is reachable (CI/local dev).
 */
import crypto from 'crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter'
import { OrdersSyncService } from '@/services/marketplace/OrdersSyncService'
import { Marketplace } from '@/types/marketplace'

const prisma = new PrismaClient()

let dbAvailable = true
try {
  await prisma.$queryRaw`SELECT 1`
} catch {
  dbAvailable = false
}

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64')
process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'test-ebay-client-id'
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-ebay-client-secret'
process.env.ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID || 'test-etsy-client-id'
process.env.ETSY_CLIENT_SECRET = process.env.ETSY_CLIENT_SECRET || 'test-etsy-client-secret'

async function setupWorkspace(available: number) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const user = await prisma.user.create({
    data: { email: `etsy-order-sync-${suffix}@example.com`, name: 'Test User', password: 'x' },
  })
  const workspace = await prisma.workspace.create({
    data: { name: 'Test WS', slug: `etsy-order-sync-${suffix}`, userId: user.id },
  })
  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      sku: `ETSY-ORDER-SKU-${suffix}`,
      title: 'Etsy order sync test product',
      description: 'Used only to test the Etsy order -> stock reservation -> push chain.',
    },
  })
  await prisma.inventory.create({
    data: { productId: product.id, workspaceId: workspace.id, quantity: available, available, reserved: 0 },
  })
  return { user, workspace, product }
}

async function connectMarketplace(workspaceId: string, name: 'ebay' | 'etsy') {
  const marketplace = await prisma.marketplace.upsert({
    where: { name },
    update: {},
    create: { name, displayName: name === 'ebay' ? 'eBay' : 'Etsy' },
  })
  const { TokenManager } = await import('@/services/marketplace/TokenManager')
  const tokenManager = new TokenManager()
  const encrypted = tokenManager.encryptToken(`real-${name}-access-token`, workspaceId)
  return prisma.marketplaceConnection.create({
    data: {
      workspaceId,
      marketplaceId: marketplace.name,
      status: 'connected',
      encryptedOauthToken: encrypted.encrypted,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })
}

async function createListing(
  productId: string,
  workspaceId: string,
  connectionId: string,
  externalId: string,
  status: string = 'active'
) {
  return prisma.listing.create({
    data: {
      productId,
      workspaceId,
      marketplaceConnectionId: connectionId,
      externalId,
      title: 'Test listing',
      description: 'Test listing description',
      price: 10,
      quantity: 5,
      status,
    },
  })
}

function makeEtsyOrder(sku: string, quantity: number, overrides: Partial<any> = {}) {
  return {
    id: 'etsy-order-1',
    externalOrderId: `etsy-receipt-${Math.random().toString(36).slice(2)}`,
    buyerId: 'buyer-1',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    totalPrice: 29,
    status: 'paid',
    createdAt: new Date(),
    items: [{ listingId: 'ETSY-LISTING-ANY', title: 'Test item', quantity, price: 29, sku }],
    shippingAddress: undefined,
    ...overrides,
  }
}

async function cleanup(ids: { userId: string; workspaceId: string; productId: string }) {
  await prisma.syncLog.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {})
  await prisma.orderItem.deleteMany({ where: { order: { workspaceId: ids.workspaceId } } }).catch(() => {})
  await prisma.order.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {})
  await prisma.listing.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {})
  await prisma.marketplaceConnection.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {})
  await prisma.inventory.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {})
  await prisma.product.delete({ where: { id: ids.productId } }).catch(() => {})
  await prisma.workspace.delete({ where: { id: ids.workspaceId } }).catch(() => {})
  await prisma.user.delete({ where: { id: ids.userId } }).catch(() => {})
}

describe.skipIf(!dbAvailable)('OrdersSyncService.syncOrders(ETSY) — full chain: order -> reserve -> push to marketplace(s)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a product listed on both eBay and Etsy: after an Etsy order syncs, each marketplace receives its own correct new quantity', async () => {
    const { user, workspace, product } = await setupWorkspace(10)
    const ebayConnection = await connectMarketplace(workspace.id, 'ebay')
    const etsyConnection = await connectMarketplace(workspace.id, 'etsy')
    await createListing(product.id, workspace.id, ebayConnection.id, 'EBAY-LISTING-1')
    const etsyListing = await createListing(product.id, workspace.id, etsyConnection.id, 'ETSY-LISTING-1')

    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeEtsyOrder(product.sku, 3)])
      .mockResolvedValueOnce([])
    const ebayUpdateInventory = vi.spyOn(EbayAdapter.prototype, 'updateInventory').mockResolvedValue(undefined)
    const etsyUpdateInventory = vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockResolvedValue(undefined)

    try {
      const service = new OrdersSyncService()
      const result = await service.syncOrders(workspace.id, Marketplace.ETSY)

      expect(result).toEqual({ processed: 1, failed: 0 })

      const inventory = await prisma.inventory.findUnique({
        where: { productId_workspaceId: { productId: product.id, workspaceId: workspace.id } },
      })
      expect(inventory?.available).toBe(7) // 10 - 3

      expect(ebayUpdateInventory).toHaveBeenCalledTimes(1)
      expect(ebayUpdateInventory).toHaveBeenCalledWith(product.sku, 7) // eBay: Product.sku
      expect(etsyUpdateInventory).toHaveBeenCalledTimes(1)
      expect(etsyUpdateInventory).toHaveBeenCalledWith(etsyListing.externalId, 7) // Etsy: Listing.externalId
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('no active Etsy listing for the product: Etsy adapter is never called for stock, even though the sold order came from Etsy', async () => {
    const { user, workspace, product } = await setupWorkspace(10)
    const ebayConnection = await connectMarketplace(workspace.id, 'ebay')
    const etsyConnection = await connectMarketplace(workspace.id, 'etsy')
    await createListing(product.id, workspace.id, ebayConnection.id, 'EBAY-LISTING-1', 'active')
    // The Etsy listing exists but is no longer active (sold out / delisted) —
    // syncListingInventory filters status: 'active', so it must be skipped.
    await createListing(product.id, workspace.id, etsyConnection.id, 'ETSY-LISTING-1', 'sold_out')

    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeEtsyOrder(product.sku, 2)])
      .mockResolvedValueOnce([])
    const ebayUpdateInventory = vi.spyOn(EbayAdapter.prototype, 'updateInventory').mockResolvedValue(undefined)
    const etsyUpdateInventory = vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockResolvedValue(undefined)

    try {
      const service = new OrdersSyncService()
      await service.syncOrders(workspace.id, Marketplace.ETSY)

      expect(ebayUpdateInventory).toHaveBeenCalledTimes(1)
      expect(ebayUpdateInventory).toHaveBeenCalledWith(product.sku, 8)
      expect(etsyUpdateInventory).not.toHaveBeenCalled() // no active Etsy listing -> no Etsy request
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('an Etsy stock-push failure never fails the order sync or rolls back the reservation', async () => {
    const { user, workspace, product } = await setupWorkspace(10)
    const etsyConnection = await connectMarketplace(workspace.id, 'etsy')
    await createListing(product.id, workspace.id, etsyConnection.id, 'ETSY-LISTING-1')

    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeEtsyOrder(product.sku, 4)])
      .mockResolvedValueOnce([])
    vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockRejectedValue(new Error('Etsy is down'))

    try {
      const service = new OrdersSyncService()
      const result = await service.syncOrders(workspace.id, Marketplace.ETSY)

      expect(result).toEqual({ processed: 1, failed: 0 }) // sync itself still succeeds

      const inventory = await prisma.inventory.findUnique({
        where: { productId_workspaceId: { productId: product.id, workspaceId: workspace.id } },
      })
      expect(inventory?.available).toBe(6) // 10 - 4, reservation persisted despite the push failure

      const orderItems = await prisma.orderItem.findMany({ where: { productId: product.id } })
      expect(orderItems).toHaveLength(1)
      expect(orderItems[0].quantity).toBe(4)
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('a re-synced (already existing) Etsy order never reserves a second time, even across two full syncOrders runs', async () => {
    const { user, workspace, product } = await setupWorkspace(10)
    const etsyConnection = await connectMarketplace(workspace.id, 'etsy')
    await createListing(product.id, workspace.id, etsyConnection.id, 'ETSY-LISTING-1')
    vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockResolvedValue(undefined)

    const order = makeEtsyOrder(product.sku, 2)

    try {
      const getOrdersSpy = vi.spyOn(EtsyAdapter.prototype, 'getOrders')

      getOrdersSpy.mockResolvedValueOnce([order]).mockResolvedValueOnce([])
      const service = new OrdersSyncService()
      await service.syncOrders(workspace.id, Marketplace.ETSY)

      let inventory = await prisma.inventory.findUnique({
        where: { productId_workspaceId: { productId: product.id, workspaceId: workspace.id } },
      })
      expect(inventory?.available).toBe(8) // 10 - 2, reserved once

      // Second sync run of the SAME order (e.g. a later status update on
      // Etsy's side) — the stale in_progress SyncLog from the first run has
      // already completed, so this is a genuinely new run.
      getOrdersSpy.mockResolvedValueOnce([{ ...order, status: 'shipped' }]).mockResolvedValueOnce([])
      const service2 = new OrdersSyncService()
      await service2.syncOrders(workspace.id, Marketplace.ETSY)

      inventory = await prisma.inventory.findUnique({
        where: { productId_workspaceId: { productId: product.id, workspaceId: workspace.id } },
      })
      expect(inventory?.available).toBe(8) // unchanged — no second decrement

      const orderItems = await prisma.orderItem.findMany({ where: { productId: product.id } })
      expect(orderItems).toHaveLength(1) // no second OrderItem either
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })
})
