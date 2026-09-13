/**
 * Step 1 of the fulfillment data-model plan — full-chain, real-DB proof of
 * what order-fulfillment-data.test.ts already proves with mocked prisma:
 *  - OrderService.createOrder (the direct/manual order path) snapshots
 *    Product.purchasePrice onto the new OrderItem and sets Order.marketplace
 *    from the listing's connection when one exists.
 *  - A later edit to Product.purchasePrice never changes an
 *    already-created OrderItem's historical purchasePrice.
 *  - OrdersSyncService.syncOrders resolves Order.listingId against real
 *    Listing rows: exactly one active listing -> that id; zero or several
 *    -> null (never guesses).
 *  - Product.supplierSku is independent of Product.sku.
 *  - A Product created without weight/dimensions/supplierSku, and an Order
 *    row read back without ever setting the new columns, both stay valid
 *    (all new columns nullable — this is the backward-compatibility proof
 *    the migration relies on).
 *
 * Real DB (describe.skipIf(!dbAvailable)) — skips in this sandbox (no
 * Postgres access here) but runs wherever a DB is reachable. Same
 * conventions as etsy-order-sync-inventory-live.test.ts: only the
 * adapters' network calls are mocked, everything else (OrderService,
 * OrdersSyncService, ProductService, real Prisma queries) is real.
 */
import crypto from 'crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter'
import { OrderService } from '@/services/OrderService'
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
process.env.ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID || 'test-etsy-client-id'
process.env.ETSY_CLIENT_SECRET = process.env.ETSY_CLIENT_SECRET || 'test-etsy-client-secret'

async function setupWorkspace(purchasePrice: number, available = 10) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const user = await prisma.user.create({
    data: { email: `fulfillment-data-${suffix}@example.com`, name: 'Test User', password: 'x' },
  })
  const workspace = await prisma.workspace.create({
    data: { name: 'Test WS', slug: `fulfillment-data-${suffix}`, userId: user.id },
  })
  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      sku: `FULFILL-SKU-${suffix}`,
      title: 'Fulfillment data test product',
      description: 'Used only to test the step-1 fulfillment data model.',
      purchasePrice,
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
  connectionId: string | undefined,
  externalId: string | undefined,
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

function makeEtsyOrder(sku: string, quantity: number) {
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
  }
}

async function cleanup(ids: { userId: string; workspaceId: string; productId: string }) {
  await prisma.fulfillmentOrder.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {})
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

describe.skipIf(!dbAvailable)('OrderService.createOrder — marketplace tag and purchasePrice snapshot', () => {
  it('snapshots Product.purchasePrice onto the new OrderItem, and sets Order.marketplace from the connected listing', async () => {
    const { user, workspace, product } = await setupWorkspace(8.5)
    const connection = await connectMarketplace(workspace.id, 'etsy')
    const listing = await createListing(product.id, workspace.id, connection.id, 'ETSY-LISTING-DIRECT')

    try {
      const order = await OrderService.createOrder(workspace.id, {
        listingId: listing.id,
        customerName: 'Direct Buyer',
        customerEmail: 'direct@example.com',
        totalPrice: 29,
        marketplaceFees: 0,
        estimatedProfit: 20.5,
        shippingAddress: '1 Test Street',
        shippingCity: 'Testville',
        shippingPostalCode: '00000',
        shippingCountry: 'US',
        fulfillmentType: 'self' as const,
      })

      expect(order.marketplace).toBe('etsy')
      expect(order.items).toHaveLength(1)
      expect(order.items[0].purchasePrice).toBe(8.5)
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('leaves Order.marketplace null when the listing has no marketplace connection', async () => {
    const { user, workspace, product } = await setupWorkspace(3)
    const listing = await createListing(product.id, workspace.id, undefined, undefined)

    try {
      const order = await OrderService.createOrder(workspace.id, {
        listingId: listing.id,
        customerName: 'Direct Buyer',
        customerEmail: 'direct@example.com',
        totalPrice: 10,
        marketplaceFees: 0,
        estimatedProfit: 7,
        shippingAddress: '1 Test Street',
        shippingCity: 'Testville',
        shippingPostalCode: '00000',
        shippingCountry: 'US',
        fulfillmentType: 'self' as const,
      })

      expect(order.marketplace).toBeNull()
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it("a later edit to Product.purchasePrice never changes an already-created OrderItem's historical purchasePrice", async () => {
    const { user, workspace, product } = await setupWorkspace(5)
    const listing = await createListing(product.id, workspace.id, undefined, undefined)

    try {
      const order = await OrderService.createOrder(workspace.id, {
        listingId: listing.id,
        customerName: 'Direct Buyer',
        customerEmail: 'direct@example.com',
        totalPrice: 10,
        marketplaceFees: 0,
        estimatedProfit: 5,
        shippingAddress: '1 Test Street',
        shippingCity: 'Testville',
        shippingPostalCode: '00000',
        shippingCountry: 'US',
        fulfillmentType: 'self' as const,
      })

      // Cost basis changes for the product going forward...
      await prisma.product.update({ where: { id: product.id }, data: { purchasePrice: 99 } })

      // ...but the already-recorded sale's snapshot is untouched.
      const orderItem = await prisma.orderItem.findFirst({ where: { orderId: order.id } })
      expect(orderItem?.purchasePrice).toBe(5)
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })
})

describe.skipIf(!dbAvailable)('OrdersSyncService.syncOrders(ETSY) — Order.listingId resolution against real Listing rows', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exactly one active Etsy listing for the product: listingId resolves to it', async () => {
    const { user, workspace, product } = await setupWorkspace(4)
    const connection = await connectMarketplace(workspace.id, 'etsy')
    const listing = await createListing(product.id, workspace.id, connection.id, 'ETSY-LISTING-1')

    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeEtsyOrder(product.sku, 1)])
      .mockResolvedValueOnce([])
    vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockResolvedValue(undefined)

    try {
      const service = new OrdersSyncService()
      await service.syncOrders(workspace.id, Marketplace.ETSY)

      const order = await prisma.order.findFirst({ where: { workspaceId: workspace.id } })
      expect(order?.listingId).toBe(listing.id)
      expect(order?.marketplace).toBe('etsy')
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('zero active Etsy listings for the product: listingId stays null', async () => {
    const { user, workspace, product } = await setupWorkspace(4)
    await connectMarketplace(workspace.id, 'etsy')
    // No Listing created at all for this product.

    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeEtsyOrder(product.sku, 1)])
      .mockResolvedValueOnce([])

    try {
      const service = new OrdersSyncService()
      await service.syncOrders(workspace.id, Marketplace.ETSY)

      const order = await prisma.order.findFirst({ where: { workspaceId: workspace.id } })
      expect(order?.listingId).toBeNull()
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('two active Etsy listings for the same product: never guesses, listingId stays null', async () => {
    const { user, workspace, product } = await setupWorkspace(4)
    const connection = await connectMarketplace(workspace.id, 'etsy')
    await createListing(product.id, workspace.id, connection.id, 'ETSY-LISTING-A')
    await createListing(product.id, workspace.id, connection.id, 'ETSY-LISTING-B')

    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeEtsyOrder(product.sku, 1)])
      .mockResolvedValueOnce([])
    vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockResolvedValue(undefined)

    try {
      const service = new OrdersSyncService()
      await service.syncOrders(workspace.id, Marketplace.ETSY)

      const order = await prisma.order.findFirst({ where: { workspaceId: workspace.id } })
      expect(order?.listingId).toBeNull()
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('an inactive (sold_out) listing is not counted as a candidate: with one active + one sold_out, listingId still resolves to the active one', async () => {
    const { user, workspace, product } = await setupWorkspace(4)
    const connection = await connectMarketplace(workspace.id, 'etsy')
    const activeListing = await createListing(product.id, workspace.id, connection.id, 'ETSY-LISTING-ACTIVE', 'active')
    await createListing(product.id, workspace.id, connection.id, 'ETSY-LISTING-SOLDOUT', 'sold_out')

    vi.spyOn(EtsyAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeEtsyOrder(product.sku, 1)])
      .mockResolvedValueOnce([])
    vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockResolvedValue(undefined)

    try {
      const service = new OrdersSyncService()
      await service.syncOrders(workspace.id, Marketplace.ETSY)

      const order = await prisma.order.findFirst({ where: { workspaceId: workspace.id } })
      expect(order?.listingId).toBe(activeListing.id)
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })
})

describe.skipIf(!dbAvailable)('Backward compatibility of the new nullable columns', () => {
  it('a Product created without weight/dimensions/supplierSku stays valid, all new columns null', async () => {
    const { user, workspace, product } = await setupWorkspace(1)
    try {
      const fresh = await prisma.product.findUnique({ where: { id: product.id } })
      expect(fresh?.weightGrams).toBeNull()
      expect(fresh?.lengthCm).toBeNull()
      expect(fresh?.widthCm).toBeNull()
      expect(fresh?.heightCm).toBeNull()
      expect(fresh?.supplierSku).toBeNull()
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('Product.supplierSku is stored independently of Product.sku — setting one never changes the other', async () => {
    const { user, workspace, product } = await setupWorkspace(1)
    try {
      const updated = await prisma.product.update({
        where: { id: product.id },
        data: { supplierSku: 'SUPPLIER-XYZ-123' },
      })
      expect(updated.supplierSku).toBe('SUPPLIER-XYZ-123')
      expect(updated.sku).toBe(product.sku) // untouched
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('a Product can store weight/dimensions with the documented units, read back unchanged', async () => {
    const { user, workspace, product } = await setupWorkspace(1)
    try {
      const updated = await prisma.product.update({
        where: { id: product.id },
        data: { weightGrams: 450, lengthCm: 20, widthCm: 15, heightCm: 5 },
      })
      expect(updated.weightGrams).toBe(450)
      expect(updated.lengthCm).toBe(20)
      expect(updated.widthCm).toBe(15)
      expect(updated.heightCm).toBe(5)
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('an Order row created without ever setting the new shipping/marketplace columns is still fully readable, all new columns null', async () => {
    const { user, workspace, product } = await setupWorkspace(1)
    try {
      const order = await prisma.order.create({
        data: {
          workspaceId: workspace.id,
          customerId: 'CUST-LEGACY-1',
          customerName: 'Legacy Customer',
          customerEmail: 'legacy@example.com',
          totalPrice: 10,
          estimatedProfit: 5,
          shippingAddress: '1 Legacy St',
          shippingCity: 'Legacy City',
          shippingPostalCode: '00000',
          shippingCountry: 'US',
          status: 'pending',
        },
      })

      const fresh = await prisma.order.findUnique({ where: { id: order.id } })
      expect(fresh?.marketplace).toBeNull()
      expect(fresh?.shippingAddress2).toBeNull()
      expect(fresh?.shippingState).toBeNull()
      expect(fresh?.shippingPhone).toBeNull()
      expect(fresh?.shippingEmail).toBeNull()
      expect(fresh?.listingId).toBeNull()
      // Existing columns untouched and still correct.
      expect(fresh?.shippingAddress).toBe('1 Legacy St')
    } finally {
      await prisma.order.deleteMany({ where: { workspaceId: workspace.id } })
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })
})
