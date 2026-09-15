/**
 * Priority 1 fix: ListingsSyncService.syncListings used to fabricate
 * `productId: \`ebay-${listing.id}\`` for any newly-discovered listing —
 * a string that is never a real Product.id, violating the FK and failing
 * every import of a listing ADKSY didn't already know about (for both
 * eBay and Etsy, since the bug lives in the shared, marketplace-agnostic
 * code path, not in either adapter).
 *
 * Fixed to resolve a REAL Product by (workspaceId, sku) — the same
 * primitive OrdersSyncService already uses — and to never fabricate an
 * id. If no SKU is available, or no Product matches it, the listing is
 * skipped (logged, counted as failed) rather than crashing or inventing
 * data. marketplaceConnectionId is now also correctly set (previously
 * always null even on success).
 *
 * eBay's getListings() already returns SKU as both id/externalId (its
 * Inventory API is SKU-keyed). Etsy's getListings() does not currently
 * surface a SKU at all (lives in the listing's inventory sub-resource) —
 * so every newly-discovered Etsy listing exercises the "no SKU" branch
 * today; that is a known, separate limitation (extending EtsyAdapter is
 * out of scope for this fix), not something this test pretends is solved.
 *
 * No real DB/network here — same convention as order-sync-inventory.test.ts:
 * prisma is fully mocked, EbayAdapter.getListings/EtsyAdapter.getListings
 * are spied.
 */
import crypto from 'crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    syncLog: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    listing: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    product: { findUnique: vi.fn() },
    marketplaceConnection: { findUnique: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { ListingsSyncService } from '@/services/marketplace/ListingsSyncService'
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

const WORKSPACE_ID = 'ws-listings-sync-matching-test'

function makeEbayListing(overrides: Partial<any> = {}) {
  return {
    id: 'SKU-WIDGET',
    marketplaceId: Marketplace.EBAY,
    title: 'Widget',
    description: 'A widget',
    price: 19.99,
    quantity: 3,
    externalId: 'SKU-WIDGET',
    status: 'active' as const,
    marketplace: Marketplace.EBAY,
    sku: 'SKU-WIDGET',
    ...overrides,
  }
}

function makeEtsyListing(overrides: Partial<any> = {}) {
  return {
    id: 'ETSY-LISTING-1',
    marketplaceId: Marketplace.ETSY,
    title: 'Handmade Mug',
    description: 'A mug',
    price: 12,
    quantity: 5,
    externalId: 'ETSY-LISTING-1',
    status: 'active' as const,
    marketplace: Marketplace.ETSY,
    // no `sku` — Etsy's getListings() does not surface one today.
    ...overrides,
  }
}

describe('ListingsSyncService — resolves a real Product, never fabricates an id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null)
    ;(prisma.syncLog.create as any).mockResolvedValue({ id: 'synclog-1' })
    ;(prisma.syncLog.update as any).mockResolvedValue({})
    ;(prisma.listing.findFirst as any).mockResolvedValue(null) // not already known
    ;(prisma.listing.create as any).mockResolvedValue({ id: 'created-listing-1' })
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('eBay: a listing whose SKU matches a real Product is imported with the real productId and marketplaceConnectionId', async () => {
    ;(prisma.product.findUnique as any).mockResolvedValue({ id: 'product-widget-real-id', workspaceId: WORKSPACE_ID, sku: 'SKU-WIDGET' })
    ;(prisma.marketplaceConnection.findUnique as any).mockResolvedValue({ id: 'connection-ebay-1' })
    vi.spyOn(EbayAdapter.prototype, 'getListings').mockResolvedValueOnce([makeEbayListing()]).mockResolvedValueOnce([])

    const service = new ListingsSyncService()
    const result = await service.syncListings(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_sku: { workspaceId: WORKSPACE_ID, sku: 'SKU-WIDGET' } },
    })
    expect(prisma.marketplaceConnection.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_marketplaceId: { workspaceId: WORKSPACE_ID, marketplaceId: Marketplace.EBAY } },
    })
    expect(prisma.listing.create).toHaveBeenCalledWith({
      data: {
        productId: 'product-widget-real-id', // the REAL Product.id — never `ebay-${listing.id}`
        workspaceId: WORKSPACE_ID,
        marketplaceConnectionId: 'connection-ebay-1', // previously always missing/null
        title: 'Widget',
        description: 'A widget',
        price: 19.99,
        quantity: 3,
        externalId: 'SKU-WIDGET',
        syncStatus: 'synced',
      },
    })
  })

  it('eBay: a listing whose SKU matches no Product is skipped — no fabricated productId, no crash, counted as failed', async () => {
    ;(prisma.product.findUnique as any).mockResolvedValue(null) // no matching product
    vi.spyOn(EbayAdapter.prototype, 'getListings')
      .mockResolvedValueOnce([makeEbayListing({ sku: 'SKU-UNKNOWN', id: 'SKU-UNKNOWN', externalId: 'SKU-UNKNOWN' })])
      .mockResolvedValueOnce([])

    const service = new ListingsSyncService()
    const result = await service.syncListings(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 0, failed: 1 })
    expect(prisma.listing.create).not.toHaveBeenCalled()
  })

  it('Etsy: a listing with no SKU at all is skipped — no fabricated productId, no crash, counted as failed', async () => {
    vi.spyOn(EtsyAdapter.prototype, 'getListings').mockResolvedValueOnce([makeEtsyListing()]).mockResolvedValueOnce([])

    const service = new ListingsSyncService()
    const result = await service.syncListings(WORKSPACE_ID, Marketplace.ETSY)

    expect(result).toEqual({ processed: 0, failed: 1 })
    expect(prisma.product.findUnique).not.toHaveBeenCalled() // never even attempted without a SKU
    expect(prisma.listing.create).not.toHaveBeenCalled()
  })

  it('an already-known listing (found by externalId) is updated normally, product/connection resolution is never touched', async () => {
    ;(prisma.listing.findFirst as any).mockResolvedValue({ id: 'existing-listing-1' })
    vi.spyOn(EbayAdapter.prototype, 'getListings').mockResolvedValueOnce([makeEbayListing()]).mockResolvedValueOnce([])

    const service = new ListingsSyncService()
    const result = await service.syncListings(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.listing.update).toHaveBeenCalledWith({
      where: { id: 'existing-listing-1' },
      data: expect.objectContaining({ title: 'Widget', syncStatus: 'synced' }),
    })
    expect(prisma.listing.create).not.toHaveBeenCalled()
    expect(prisma.product.findUnique).not.toHaveBeenCalled()
    expect(prisma.marketplaceConnection.findUnique).not.toHaveBeenCalled()
  })

  it('a multi-listing page resolves each listing to its own correct product independently', async () => {
    ;(prisma.product.findUnique as any).mockImplementation(async ({ where }: any) => ({
      id: `product-${where.workspaceId_sku.sku}`,
      workspaceId: WORKSPACE_ID,
      sku: where.workspaceId_sku.sku,
    }))
    ;(prisma.marketplaceConnection.findUnique as any).mockResolvedValue({ id: 'connection-ebay-1' })
    vi.spyOn(EbayAdapter.prototype, 'getListings')
      .mockResolvedValueOnce([
        makeEbayListing({ sku: 'SKU-A', id: 'SKU-A', externalId: 'SKU-A', title: 'Item A' }),
        makeEbayListing({ sku: 'SKU-B', id: 'SKU-B', externalId: 'SKU-B', title: 'Item B' }),
      ])
      .mockResolvedValueOnce([])

    const service = new ListingsSyncService()
    const result = await service.syncListings(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 2, failed: 0 })
    expect(prisma.listing.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ productId: 'product-SKU-A' }) }))
    expect(prisma.listing.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ productId: 'product-SKU-B' }) }))
  })
})
