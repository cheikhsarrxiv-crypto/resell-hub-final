/**
 * Priority 2, real-DB proof of the part that listing-duplicate-prevention.test.ts
 * (mocked prisma, single-threaded) cannot exercise: two genuinely concurrent
 * ListingService.createListing() calls racing against the actual database.
 *
 * The application-level guard (fast-path check + reservation write) closes
 * most of the window, but two requests that both read "nothing exists yet"
 * before either writes can still both reach prisma.listing.create() — only a
 * real DB constraint can make one of those two INSERTs fail. That constraint
 * is the partial unique index from migration
 * 20260914000000_prevent_duplicate_listing_publication:
 *   CREATE UNIQUE INDEX "Listing_active_product_connection_key"
 *   ON "Listing" ("productId", "marketplaceConnectionId") WHERE "deletedAt" IS NULL;
 * Without that index applied, this test's first case fails (the adapter gets
 * called twice, two Listing rows exist) — it only passes once the index is
 * live, which is exactly the proof Priority 2 needed and the mocked test
 * cannot provide.
 *
 * Real DB (describe.skipIf(!dbAvailable)) — skips wherever Postgres isn't
 * reachable. Same convention as order-fulfillment-data-live.test.ts: only
 * EbayAdapter's network call is mocked, everything else (ListingService,
 * MarketplaceConnectionService, TokenManager, real Prisma queries) is real.
 */
import crypto from 'crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'
import { ListingService } from '@/services/ListingService'
import { CreateListingInput } from '@/lib/validations'

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
process.env.EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/ebay'

async function setupWorkspace() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const user = await prisma.user.create({
    data: { email: `dup-prevention-${suffix}@example.com`, name: 'Test User', password: 'x' },
  })
  const workspace = await prisma.workspace.create({
    data: { name: 'Test WS', slug: `dup-prevention-${suffix}`, userId: user.id },
  })
  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      sku: `DUP-SKU-${suffix}`,
      title: 'Duplicate-prevention test product',
      description: 'Used only to test the real-DB concurrency guard.',
    },
  })
  return { user, workspace, product }
}

async function connectEbay(workspaceId: string) {
  const marketplace = await prisma.marketplace.upsert({
    where: { name: 'ebay' },
    update: {},
    create: { name: 'ebay', displayName: 'eBay' },
  })
  const { TokenManager } = await import('@/services/marketplace/TokenManager')
  const tokenManager = new TokenManager()
  const encrypted = tokenManager.encryptToken('real-ebay-access-token', workspaceId)
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

function makeInput(productId: string, overrides: Partial<CreateListingInput> = {}): CreateListingInput {
  return {
    productId,
    title: 'Concurrency test listing',
    description: 'A listing used to test the concurrent-publish guard.',
    price: 10,
    quantity: 5,
    marketplaceIds: ['ebay'],
    fulfillmentType: 'self' as const,
    ...overrides,
  }
}

async function cleanup(ids: { userId: string; workspaceId: string; productId: string }) {
  await prisma.listing.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {})
  await prisma.marketplaceConnection.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {})
  await prisma.product.delete({ where: { id: ids.productId } }).catch(() => {})
  await prisma.workspace.delete({ where: { id: ids.workspaceId } }).catch(() => {})
  await prisma.user.delete({ where: { id: ids.userId } }).catch(() => {})
}

describe.skipIf(!dbAvailable)('ListingService.createListing() — real-DB concurrency guard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('two simultaneous createListing calls for the same product+connection result in exactly one real marketplace call and one synced Listing row', async () => {
    const { user, workspace, product } = await setupWorkspace()
    const connection = await connectEbay(workspace.id)
    let externalIdCounter = 0
    const createSpy = vi.spyOn(EbayAdapter.prototype, 'createListing').mockImplementation(async () => ({
      externalId: `EBAY-CONCURRENT-${++externalIdCounter}`,
    }) as any)

    try {
      const [resultA, resultB] = await Promise.all([
        ListingService.createListing(workspace.id, makeInput(product.id)),
        ListingService.createListing(workspace.id, makeInput(product.id)),
      ])

      // The real marketplace side must only ever be published once for
      // this (product, connection) pair, however the two requests raced.
      expect(createSpy).toHaveBeenCalledTimes(1)

      const listings = await prisma.listing.findMany({
        where: { productId: product.id, marketplaceConnectionId: connection.id, deletedAt: null },
      })
      expect(listings).toHaveLength(1)
      expect(listings[0].syncStatus).toBe('synced')

      // Both calls return the same row (the winner), never two different ones.
      expect(resultA[0].id).toBe(listings[0].id)
      expect(resultB[0].id).toBe(listings[0].id)
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })

  it('a real ListingService.deleteListing() soft-delete, then a real republish, is allowed by the partial index and calls the marketplace again', async () => {
    const { user, workspace, product } = await setupWorkspace()
    const connection = await connectEbay(workspace.id)
    let externalIdCounter = 0
    const createSpy = vi.spyOn(EbayAdapter.prototype, 'createListing').mockImplementation(async () => ({
      externalId: `EBAY-REPUBLISH-${++externalIdCounter}`,
    }) as any)
    vi.spyOn(EbayAdapter.prototype, 'deleteListing').mockResolvedValue(undefined as any)

    try {
      const [firstListing] = await ListingService.createListing(workspace.id, makeInput(product.id))
      expect(createSpy).toHaveBeenCalledTimes(1)

      await ListingService.deleteListing(firstListing.id, workspace.id)

      const [secondListing] = await ListingService.createListing(workspace.id, makeInput(product.id))

      // The soft-deleted row must not block the new one — the partial
      // index only covers deletedAt IS NULL, and the DB must agree.
      expect(createSpy).toHaveBeenCalledTimes(2)
      expect(secondListing.id).not.toBe(firstListing.id)

      const activeListings = await prisma.listing.findMany({
        where: { productId: product.id, marketplaceConnectionId: connection.id, deletedAt: null },
      })
      expect(activeListings).toHaveLength(1)
      expect(activeListings[0].id).toBe(secondListing.id)
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id })
    }
  })
})
