/**
 * Proves the point-2 fix: OrdersSyncService and ListingsSyncService no
 * longer hardcode `new EbayAdapter(...)` with EBAY_* env vars — they go
 * through AdapterFactory.createAdapter() with a config resolved per
 * marketplace by getMarketplaceAdapterConfig() (src/services/marketplace/AdapterFactory.ts).
 *
 * What this proves:
 * - getMarketplaceAdapterConfig() reads EBAY_* env vars for Marketplace.EBAY
 *   and ETSY_* env vars for Marketplace.ETSY (never cross-wired), and
 *   rejects Depop/Vinted (no working OAuth flow for them today, untouched
 *   by this change).
 * - OrdersSyncService.syncOrders(workspaceId, EBAY) ends up calling
 *   EbayAdapter's HTTP methods (getOrders, setAccessToken) with the eBay
 *   config — never EtsyAdapter.
 * - OrdersSyncService.syncOrders(workspaceId, ETSY) ends up calling
 *   EtsyAdapter's HTTP methods with the Etsy config — never EbayAdapter.
 * - Same pair of proofs for ListingsSyncService.syncListings (getListings).
 *
 * No real DB/network here — same convention as order-sync-inventory.test.ts
 * and cron-sync.test.ts: prisma is fully mocked, and only the marketplace
 * adapters' HTTP-calling methods are spied on.
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
    listing: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { OrdersSyncService } from '@/services/marketplace/OrdersSyncService'
import { ListingsSyncService } from '@/services/marketplace/ListingsSyncService'
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService'
import { getMarketplaceAdapterConfig } from '@/services/marketplace/AdapterFactory'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter'
import { Marketplace } from '@/types/marketplace'

process.env.EBAY_CLIENT_ID = 'ebay-client-id'
process.env.EBAY_CLIENT_SECRET = 'ebay-client-secret'
process.env.EBAY_REDIRECT_URI = 'http://localhost:3000/api/marketplace/callback/ebay'
process.env.EBAY_SANDBOX_MODE = 'true'
process.env.ETSY_CLIENT_ID = 'etsy-client-id'
process.env.ETSY_CLIENT_SECRET = 'etsy-client-secret'
process.env.ETSY_REDIRECT_URI = 'http://localhost:3000/api/marketplace/callback/etsy'
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64')

const WORKSPACE_ID = 'ws-adapter-factory-test'

describe('getMarketplaceAdapterConfig — per-marketplace config resolution', () => {
  it('resolves eBay config from EBAY_* env vars', () => {
    const config = getMarketplaceAdapterConfig(Marketplace.EBAY)
    expect(config).toEqual({
      clientId: 'ebay-client-id',
      clientSecret: 'ebay-client-secret',
      redirectUri: 'http://localhost:3000/api/marketplace/callback/ebay',
      sandboxMode: true,
    })
  })

  it('resolves Etsy config from ETSY_* env vars, sandboxMode always false', () => {
    const config = getMarketplaceAdapterConfig(Marketplace.ETSY)
    expect(config).toEqual({
      clientId: 'etsy-client-id',
      clientSecret: 'etsy-client-secret',
      redirectUri: 'http://localhost:3000/api/marketplace/callback/etsy',
      sandboxMode: false,
    })
  })

  it('never mixes up eBay and Etsy credentials', () => {
    const ebayConfig = getMarketplaceAdapterConfig(Marketplace.EBAY)
    const etsyConfig = getMarketplaceAdapterConfig(Marketplace.ETSY)
    expect(ebayConfig.clientId).not.toBe(etsyConfig.clientId)
    expect(ebayConfig.clientSecret).not.toBe(etsyConfig.clientSecret)
    expect(ebayConfig.redirectUri).not.toBe(etsyConfig.redirectUri)
  })

  it('rejects Depop and Vinted — no configuration resolver wired up for them yet', () => {
    expect(() => getMarketplaceAdapterConfig(Marketplace.DEPOP)).toThrow()
    expect(() => getMarketplaceAdapterConfig(Marketplace.VINTED)).toThrow()
  })
})

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    externalOrderId: 'ext-order-1',
    buyerId: 'buyer-1',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    totalPrice: 29,
    status: 'FULFILLED',
    items: [],
    shippingAddress: undefined,
    ...overrides,
  }
}

function makeListing(overrides: Partial<any> = {}) {
  return {
    id: 'listing-1',
    marketplaceId: 'listing-1',
    title: 'Test listing',
    description: 'desc',
    price: 10,
    quantity: 5,
    status: 'active' as const,
    externalId: 'ext-listing-1',
    ...overrides,
  }
}

describe('OrdersSyncService — uses the adapter and config matching the requested marketplace', () => {
  let capturedConfig: any

  beforeEach(() => {
    vi.clearAllMocks()
    capturedConfig = undefined
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null)
    ;(prisma.syncLog.create as any).mockResolvedValue({ id: 'synclog-1' })
    ;(prisma.syncLog.update as any).mockResolvedValue({})
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.order.create as any).mockResolvedValue({ id: 'created-order-1' })

    // Capture the config each adapter/connection-service instance actually
    // received, without touching the real token-refresh/decryption path.
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockImplementation(async function (
      this: any
    ) {
      capturedConfig = this.config
      return 'fake-access-token'
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('eBay: calls EbayAdapter with the eBay config, never EtsyAdapter', async () => {
    const ebayGetOrders = vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValue([])
    const ebaySetToken = vi.spyOn(EbayAdapter.prototype, 'setAccessToken')
    const etsyGetOrders = vi.spyOn(EtsyAdapter.prototype, 'getOrders').mockResolvedValue([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(ebayGetOrders).toHaveBeenCalled()
    expect(ebaySetToken).toHaveBeenCalledWith('fake-access-token')
    expect(etsyGetOrders).not.toHaveBeenCalled()
    expect(capturedConfig).toEqual(getMarketplaceAdapterConfig(Marketplace.EBAY))
  })

  it('Etsy: calls EtsyAdapter with the Etsy config, never EbayAdapter', async () => {
    const etsyGetOrders = vi.spyOn(EtsyAdapter.prototype, 'getOrders').mockResolvedValue([])
    const etsySetToken = vi.spyOn(EtsyAdapter.prototype, 'setAccessToken')
    const ebayGetOrders = vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValue([])

    const service = new OrdersSyncService()
    await service.syncOrders(WORKSPACE_ID, Marketplace.ETSY)

    expect(etsyGetOrders).toHaveBeenCalled()
    expect(etsySetToken).toHaveBeenCalledWith('fake-access-token')
    expect(ebayGetOrders).not.toHaveBeenCalled()
    expect(capturedConfig).toEqual(getMarketplaceAdapterConfig(Marketplace.ETSY))
  })

  it('eBay sync still processes orders end-to-end through the generalized path', async () => {
    vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeOrder()]).mockResolvedValueOnce([])
    vi.spyOn(EbayAdapter.prototype, 'setAccessToken')

    const service = new OrdersSyncService()
    const result = await service.syncOrders(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.order.create).toHaveBeenCalledTimes(1)
  })
})

describe('ListingsSyncService — uses the adapter and config matching the requested marketplace', () => {
  let capturedConfig: any

  beforeEach(() => {
    vi.clearAllMocks()
    capturedConfig = undefined
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null)
    ;(prisma.syncLog.create as any).mockResolvedValue({ id: 'synclog-1' })
    ;(prisma.syncLog.update as any).mockResolvedValue({})
    ;(prisma.listing.findFirst as any).mockResolvedValue(null)
    ;(prisma.listing.create as any).mockResolvedValue({ id: 'created-listing-1' })

    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockImplementation(async function (
      this: any
    ) {
      capturedConfig = this.config
      return 'fake-access-token'
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('eBay: calls EbayAdapter with the eBay config, never EtsyAdapter', async () => {
    const ebayGetListings = vi.spyOn(EbayAdapter.prototype, 'getListings').mockResolvedValue([])
    const ebaySetToken = vi.spyOn(EbayAdapter.prototype, 'setAccessToken')
    const etsyGetListings = vi.spyOn(EtsyAdapter.prototype, 'getListings').mockResolvedValue([])

    const service = new ListingsSyncService()
    await service.syncListings(WORKSPACE_ID, Marketplace.EBAY)

    expect(ebayGetListings).toHaveBeenCalled()
    expect(ebaySetToken).toHaveBeenCalledWith('fake-access-token')
    expect(etsyGetListings).not.toHaveBeenCalled()
    expect(capturedConfig).toEqual(getMarketplaceAdapterConfig(Marketplace.EBAY))
  })

  it('Etsy: calls EtsyAdapter with the Etsy config, never EbayAdapter', async () => {
    const etsyGetListings = vi.spyOn(EtsyAdapter.prototype, 'getListings').mockResolvedValue([])
    const etsySetToken = vi.spyOn(EtsyAdapter.prototype, 'setAccessToken')
    const ebayGetListings = vi.spyOn(EbayAdapter.prototype, 'getListings').mockResolvedValue([])

    const service = new ListingsSyncService()
    await service.syncListings(WORKSPACE_ID, Marketplace.ETSY)

    expect(etsyGetListings).toHaveBeenCalled()
    expect(etsySetToken).toHaveBeenCalledWith('fake-access-token')
    expect(ebayGetListings).not.toHaveBeenCalled()
    expect(capturedConfig).toEqual(getMarketplaceAdapterConfig(Marketplace.ETSY))
  })

  it('eBay sync still processes listings end-to-end through the generalized path', async () => {
    vi.spyOn(EbayAdapter.prototype, 'getListings').mockResolvedValueOnce([makeListing()]).mockResolvedValueOnce([])
    vi.spyOn(EbayAdapter.prototype, 'setAccessToken')

    const service = new ListingsSyncService()
    const result = await service.syncListings(WORKSPACE_ID, Marketplace.EBAY)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(prisma.listing.create).toHaveBeenCalledTimes(1)
  })
})
