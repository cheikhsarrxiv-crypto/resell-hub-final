/**
 * Tests for the eBay sync cron endpoints and the pagination/concurrency
 * changes made to ListingsSyncService/OrdersSyncService to make them
 * actually reachable in production (Vercel Cron -> route -> service).
 *
 * No real eBay Sandbox network access is available in this environment
 * (confirmed separately), so EbayAdapter's HTTP-calling methods are
 * mocked here (vi.spyOn on the prototype) — everything else (the real
 * route handlers, the real service pagination/concurrency logic, real
 * SyncLog state transitions) runs unmocked. Prisma itself is mocked
 * (vi.mock('@/lib/prisma')) since no database is reachable from this
 * session either — this is explicitly a logic test, not a live-DB test,
 * unlike listing-publish-token-wiring.test.ts which skips entirely
 * without a DB.
 */
import crypto from 'crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    marketplaceConnection: { findMany: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    order: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    listing: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { GET as syncOrdersGET } from '@/app/api/cron/sync-orders/route'
import { GET as syncListingsGET } from '@/app/api/cron/sync-listings/route'
import { OrdersSyncService } from '@/services/marketplace/OrdersSyncService'
import { ListingsSyncService } from '@/services/marketplace/ListingsSyncService'
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'
import { Marketplace } from '@/types/marketplace'
import { verifyCronSecret } from '@/lib/cronAuth'

process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'test-client-id'
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-client-secret'
process.env.EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/ebay'
// MarketplaceConnectionService's constructor builds a real TokenManager,
// which requires this even though getAccessToken() itself is mocked below.
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64')

const CRON_SECRET = 'test-cron-secret-not-a-real-secret'

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cron/sync-orders', { headers })
}

function makeOrder(id: string) {
  return {
    id,
    externalOrderId: id,
    buyerId: 'buyer-1',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    totalPrice: 10,
    status: 'FULFILLED',
    createdAt: new Date(),
    items: [],
    shippingAddress: undefined,
  }
}

function makeListing(id: string) {
  return {
    id,
    marketplaceId: Marketplace.EBAY,
    title: `Listing ${id}`,
    description: '',
    price: 10,
    quantity: 1,
    externalId: id,
    status: 'active' as const,
    marketplace: Marketplace.EBAY,
  }
}

// ============================================================================
// verifyCronSecret — direct unit tests
// ============================================================================

describe('verifyCronSecret', () => {
  const OLD_SECRET = process.env.CRON_SECRET

  afterEach(() => {
    process.env.CRON_SECRET = OLD_SECRET
  })

  it('returns false when CRON_SECRET is not configured (fail closed)', () => {
    delete process.env.CRON_SECRET
    expect(verifyCronSecret(makeRequest({ authorization: 'Bearer anything' }))).toBe(false)
  })

  it('returns false when no Authorization header is sent', () => {
    process.env.CRON_SECRET = CRON_SECRET
    expect(verifyCronSecret(makeRequest())).toBe(false)
  })

  it('returns false for a wrong secret', () => {
    process.env.CRON_SECRET = CRON_SECRET
    expect(verifyCronSecret(makeRequest({ authorization: 'Bearer wrong-value' }))).toBe(false)
  })

  it('returns true for the exact configured secret', () => {
    process.env.CRON_SECRET = CRON_SECRET
    expect(verifyCronSecret(makeRequest({ authorization: `Bearer ${CRON_SECRET}` }))).toBe(true)
  })
})

// ============================================================================
// TEST 1 & 2: cron routes reject missing/wrong secret
// ============================================================================

describe('Cron routes - auth', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET
    vi.clearAllMocks()
  })

  it('TEST 1: no secret header -> 401, no workspace query performed', async () => {
    const res = await syncOrdersGET(makeRequest())
    expect(res.status).toBe(401)
    expect(prisma.marketplaceConnection.findMany).not.toHaveBeenCalled()
  })

  it('TEST 2: wrong secret -> 401 (orders route)', async () => {
    const res = await syncOrdersGET(makeRequest({ authorization: 'Bearer wrong-secret' }))
    expect(res.status).toBe(401)
  })

  it('TEST 2: wrong secret -> 401 (listings route)', async () => {
    const res = await syncListingsGET(makeRequest({ authorization: 'Bearer wrong-secret' }))
    expect(res.status).toBe(401)
  })

  it('rejects (401) when CRON_SECRET is entirely unconfigured, even with a header sent', async () => {
    delete process.env.CRON_SECRET
    const res = await syncOrdersGET(makeRequest({ authorization: 'Bearer whatever' }))
    expect(res.status).toBe(401)
  })
})

// ============================================================================
// TEST 3, 4, 8, 9: cron route behavior with a valid secret
// ============================================================================

describe('Cron routes - processing with a valid secret', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('TEST 3: processes every connected eBay workspace and returns a summary', async () => {
    ;(prisma.marketplaceConnection.findMany as any).mockResolvedValue([
      { workspaceId: 'ws-1' },
      { workspaceId: 'ws-2' },
    ])
    const syncSpy = vi
      .spyOn(OrdersSyncService.prototype, 'syncOrders')
      .mockResolvedValue({ processed: 3, failed: 0 })

    const res = await syncOrdersGET(makeRequest({ authorization: `Bearer ${CRON_SECRET}` }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(prisma.marketplaceConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { marketplaceId: Marketplace.EBAY, status: 'connected' } })
    )
    expect(syncSpy).toHaveBeenCalledTimes(2)
    expect(body).toEqual({ workspacesTotal: 2, succeeded: 2, failed: 0, skipped: 0 })
  })

  it('TEST 4 & 8: a workspace that throws does not block the others, and each call uses its own real workspaceId', async () => {
    ;(prisma.marketplaceConnection.findMany as any).mockResolvedValue([
      { workspaceId: 'ws-fails' },
      { workspaceId: 'ws-ok' },
    ])
    const calledWith: string[] = []
    vi.spyOn(OrdersSyncService.prototype, 'syncOrders').mockImplementation(async (workspaceId: string) => {
      calledWith.push(workspaceId)
      if (workspaceId === 'ws-fails') {
        throw new Error('Connection status is expired')
      }
      return { processed: 1, failed: 0 }
    })

    const res = await syncOrdersGET(makeRequest({ authorization: `Bearer ${CRON_SECRET}` }))
    const body = await res.json()

    expect(calledWith).toEqual(['ws-fails', 'ws-ok']) // both were attempted — isolation confirmed
    expect(body).toEqual({ workspacesTotal: 2, succeeded: 1, failed: 1, skipped: 0 })
  })

  it('never falls back to a default workspace when there are zero connected workspaces', async () => {
    ;(prisma.marketplaceConnection.findMany as any).mockResolvedValue([])
    const syncSpy = vi.spyOn(OrdersSyncService.prototype, 'syncOrders')

    const res = await syncOrdersGET(makeRequest({ authorization: `Bearer ${CRON_SECRET}` }))
    const body = await res.json()

    expect(syncSpy).not.toHaveBeenCalled()
    expect(body).toEqual({ workspacesTotal: 0, succeeded: 0, failed: 0, skipped: 0 })
  })

  it('TEST 9: a failure containing sensitive-looking text never appears in the HTTP response', async () => {
    ;(prisma.marketplaceConnection.findMany as any).mockResolvedValue([{ workspaceId: 'ws-1' }])
    vi.spyOn(OrdersSyncService.prototype, 'syncOrders').mockRejectedValue(
      new Error('token=super-secret-access-token-should-never-leak')
    )

    const res = await syncOrdersGET(makeRequest({ authorization: `Bearer ${CRON_SECRET}` }))
    const rawBody = await res.text()

    expect(rawBody).not.toContain('super-secret-access-token-should-never-leak')
    expect(rawBody).not.toContain(CRON_SECRET)
    expect(JSON.parse(rawBody)).toEqual({ workspacesTotal: 1, succeeded: 0, failed: 1, skipped: 0 })
  })

  it('listings route mirrors the same summary shape', async () => {
    ;(prisma.marketplaceConnection.findMany as any).mockResolvedValue([{ workspaceId: 'ws-1' }])
    vi.spyOn(ListingsSyncService.prototype, 'syncListings').mockResolvedValue({ processed: 2, failed: 0 })

    const res = await syncListingsGET(makeRequest({ authorization: `Bearer ${CRON_SECRET}` }))
    const body = await res.json()
    expect(body).toEqual({ workspacesTotal: 1, succeeded: 1, failed: 0, skipped: 0 })
  })
})

// ============================================================================
// TEST 5 & 7: OrdersSyncService pagination + no infinite loop
// ============================================================================

describe('OrdersSyncService - pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null)
    ;(prisma.syncLog.create as any).mockResolvedValue({ id: 'synclog-orders-1' })
    ;(prisma.syncLog.update as any).mockResolvedValue({})
    ;(prisma.order.findFirst as any).mockResolvedValue(null)
    ;(prisma.order.create as any).mockResolvedValue({})
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-access-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('TEST 5: follows a full page with a short page and stops (2 pages, 140 orders)', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makeOrder(`o1-${i}`))
    const page2 = Array.from({ length: 40 }, (_, i) => makeOrder(`o2-${i}`))
    const getOrdersSpy = vi
      .spyOn(EbayAdapter.prototype, 'getOrders')
      .mockImplementation(async (_limit?: number, offset?: number) => (offset === 0 ? page1 : offset === 100 ? page2 : []))

    const service = new OrdersSyncService()
    const result = await service.syncOrders('ws-1', Marketplace.EBAY)

    expect(getOrdersSpy).toHaveBeenCalledTimes(2)
    expect(getOrdersSpy).toHaveBeenNthCalledWith(1, 100, 0)
    expect(getOrdersSpy).toHaveBeenNthCalledWith(2, 100, 100)
    expect(result).toEqual({ processed: 140, failed: 0 })
  })

  it('handles an empty first page correctly: one call, zero processed, sync still completes', async () => {
    const getOrdersSpy = vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValue([])

    const service = new OrdersSyncService()
    const result = await service.syncOrders('ws-1', Marketplace.EBAY)

    expect(getOrdersSpy).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ processed: 0, failed: 0 })
    expect(prisma.syncLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed', itemsProcessed: 0 }) })
    )
  })

  it('TEST 7: never loops indefinitely even if eBay kept returning full pages', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => makeOrder(`o-${i}`))
    const getOrdersSpy = vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValue(fullPage)

    const service = new OrdersSyncService()
    await service.syncOrders('ws-1', Marketplace.EBAY)

    expect(getOrdersSpy.mock.calls.length).toBeLessThanOrEqual(50)
  }, 20000)

  it('TEST 10: writes SyncLog in_progress -> completed with correct counts on success', async () => {
    vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeOrder('o-1')]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders('ws-1', Marketplace.EBAY)

    expect(prisma.syncLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workspaceId: 'ws-1', syncType: 'order', status: 'in_progress' }) })
    )
    expect(prisma.syncLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'synclog-orders-1' },
        data: expect.objectContaining({ status: 'completed', itemsProcessed: 1, itemsFailed: 0 }),
      })
    )
  })

  it('TEST 10: writes SyncLog as failed (with a safe message) when the connection cannot be used', async () => {
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockRejectedValue(
      new Error('Connection status is expired')
    )

    const service = new OrdersSyncService()
    await expect(service.syncOrders('ws-1', Marketplace.EBAY)).rejects.toThrow('Connection status is expired')

    expect(prisma.syncLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'synclog-orders-1' },
        data: expect.objectContaining({ status: 'failed', error: 'Connection status is expired' }),
      })
    )
  })

  it('concurrency guard: skips starting a new run when one is already in_progress for this workspace', async () => {
    ;(prisma.syncLog.findFirst as any).mockResolvedValue({
      id: 'existing-log',
      status: 'in_progress',
      startedAt: new Date(),
    })
    const getOrdersSpy = vi.spyOn(EbayAdapter.prototype, 'getOrders')

    const service = new OrdersSyncService()
    const result = await service.syncOrders('ws-1', Marketplace.EBAY)

    expect(result).toEqual({ processed: 0, failed: 0, skipped: true, reason: 'already_in_progress' })
    expect(prisma.syncLog.create).not.toHaveBeenCalled()
    expect(getOrdersSpy).not.toHaveBeenCalled()
  })
})

// ============================================================================
// TEST 6: ListingsSyncService pagination
// ============================================================================

describe('ListingsSyncService - pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null)
    ;(prisma.syncLog.create as any).mockResolvedValue({ id: 'synclog-listings-1' })
    ;(prisma.syncLog.update as any).mockResolvedValue({})
    ;(prisma.listing.findFirst as any).mockResolvedValue(null)
    ;(prisma.listing.create as any).mockResolvedValue({})
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-access-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('TEST 6: follows a full page with a short page and stops (2 pages, 150 listings)', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makeListing(`l1-${i}`))
    const page2 = Array.from({ length: 50 }, (_, i) => makeListing(`l2-${i}`))
    const getListingsSpy = vi
      .spyOn(EbayAdapter.prototype, 'getListings')
      .mockImplementation(async (_limit?: number, offset?: number) => (offset === 0 ? page1 : offset === 100 ? page2 : []))

    const service = new ListingsSyncService()
    const result = await service.syncListings('ws-1', Marketplace.EBAY)

    expect(getListingsSpy).toHaveBeenCalledTimes(2)
    expect(getListingsSpy).toHaveBeenNthCalledWith(1, 100, 0)
    expect(getListingsSpy).toHaveBeenNthCalledWith(2, 100, 100)
    expect(result).toEqual({ processed: 150, failed: 0 })
  })

  it('TEST 7: never loops indefinitely even if eBay kept returning full pages', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => makeListing(`l-${i}`))
    const getListingsSpy = vi.spyOn(EbayAdapter.prototype, 'getListings').mockResolvedValue(fullPage)

    const service = new ListingsSyncService()
    await service.syncListings('ws-1', Marketplace.EBAY)

    expect(getListingsSpy.mock.calls.length).toBeLessThanOrEqual(50)
  }, 20000)

  it('concurrency guard: skips starting a new run when one is already in_progress for this workspace', async () => {
    ;(prisma.syncLog.findFirst as any).mockResolvedValue({
      id: 'existing-log',
      status: 'in_progress',
      startedAt: new Date(),
    })
    const getListingsSpy = vi.spyOn(EbayAdapter.prototype, 'getListings')

    const service = new ListingsSyncService()
    const result = await service.syncListings('ws-1', Marketplace.EBAY)

    expect(result).toEqual({ processed: 0, failed: 0, skipped: true, reason: 'already_in_progress' })
    expect(prisma.syncLog.create).not.toHaveBeenCalled()
    expect(getListingsSpy).not.toHaveBeenCalled()
  })

  it('does not treat a stale (old) in_progress row as a real concurrent run', async () => {
    ;(prisma.syncLog.findFirst as any).mockResolvedValue(null) // simulates the stale-row time filter excluding it
    vi.spyOn(EbayAdapter.prototype, 'getListings').mockResolvedValue([])

    const service = new ListingsSyncService()
    const result = await service.syncListings('ws-1', Marketplace.EBAY)

    expect(result).toEqual({ processed: 0, failed: 0 })
    expect(prisma.syncLog.create).toHaveBeenCalled()
  })
})
