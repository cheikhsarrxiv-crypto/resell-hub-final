/**
 * ListingsSyncService
 * Sync listings from a marketplace into ResellHub. The adapter and its
 * client config are resolved generically per marketplace (AdapterFactory /
 * getMarketplaceAdapterConfig) — callers today only ever pass Marketplace.EBAY
 * (see the sync-listings cron), Etsy support here is not yet activated by any caller.
 */

import { prisma } from '@/lib/prisma'
import { AdapterFactory, getMarketplaceAdapterConfig } from './AdapterFactory'
import { MarketplaceConnectionService } from './MarketplaceConnectionService'
import { RateLimitManager } from './RateLimitManager'
import { Marketplace } from '@/types/marketplace'

const PAGE_SIZE = 100
// Safety cap: never page indefinitely, even if eBay kept returning full
// pages (max 5000 listings processed per run).
const MAX_PAGES = 50
// A SyncLog stuck at 'in_progress' longer than this is treated as stale
// (e.g. a crashed invocation), not a real concurrent run, so it doesn't
// block every future cron invocation forever. Well above the 30-minute
// listings cron interval.
const STALE_IN_PROGRESS_MS = 45 * 60 * 1000

export class ListingsSyncService {
  async syncListings(workspaceId: string, marketplace: Marketplace) {
    // Concurrency guard using the existing SyncLog model: if a genuinely
    // recent run is still in_progress for this workspace, skip starting a
    // second one instead of racing two syncs against the same rows. This
    // reuses SyncLog rather than adding any new lock mechanism.
    const alreadyRunning = await prisma.syncLog.findFirst({
      where: {
        workspaceId,
        marketplace,
        syncType: 'listing',
        status: 'in_progress',
        startedAt: { gt: new Date(Date.now() - STALE_IN_PROGRESS_MS) },
      },
    })
    if (alreadyRunning) {
      return { processed: 0, failed: 0, skipped: true, reason: 'already_in_progress' as const }
    }

    // Create sync log
    const syncLog = await prisma.syncLog.create({
      data: {
        workspaceId,
        marketplace,
        syncType: 'listing',
        status: 'in_progress',
      },
    })

    try {
      // Config resolved per marketplace (see getMarketplaceAdapterConfig) —
      // no hardcoded eBay credentials here, so this same code path works
      // for any marketplace the caller passes in.
      const config = getMarketplaceAdapterConfig(marketplace)
      const connService = new MarketplaceConnectionService(config)

      // Get access token
      const token = await connService.getAccessToken(workspaceId, marketplace)

      const adapter = AdapterFactory.createAdapter(marketplace, config)

      // setAccessToken() is adapter-specific (not part of the abstract
      // MarketplaceAdapter contract) — same cast MarketplaceConnectionService
      // already uses internally after building an adapter generically.
      ;(adapter as any).setAccessToken(token)

      // Scoped to this single run/workspace: correctly gates the burst of
      // requests a multi-page sync makes for one eBay account. Does not
      // persist across separate cron invocations (in-memory only) — see
      // RateLimitManager's own header comment.
      const rateLimiter = new RateLimitManager()

      let processed = 0
      let failed = 0
      let offset = 0
      let pagesFetched = 0

      // Page through eBay's inventory until a short page signals there's
      // no more (the adapter doesn't propagate eBay's total count, so
      // "fewer than PAGE_SIZE returned" is the only available signal), or
      // the safety cap is hit.
      while (pagesFetched < MAX_PAGES) {
        await rateLimiter.checkLimit(marketplace, workspaceId)

        const listings = await adapter.getListings(PAGE_SIZE, offset)
        pagesFetched++

        for (const listing of listings) {
          try {
            // Upsert listing (externalId isn't a unique key in the schema, so look it up manually)
            const externalId = listing.externalId || listing.id
            const existing = await prisma.listing.findFirst({
              where: { workspaceId, externalId },
            })

            if (existing) {
              await prisma.listing.update({
                where: { id: existing.id },
                data: {
                  title: listing.title,
                  description: listing.description || '',
                  price: listing.price,
                  quantity: listing.quantity,
                  syncStatus: 'synced',
                  updatedAt: new Date(),
                },
              })
            } else {
              await prisma.listing.create({
                data: {
                  productId: `ebay-${listing.id}`,
                  workspaceId,
                  title: listing.title,
                  description: listing.description || '',
                  price: listing.price,
                  quantity: listing.quantity,
                  externalId,
                  syncStatus: 'synced',
                },
              })
            }

            processed++
          } catch (error) {
            console.error(`Failed to sync listing ${listing.id}:`, error)
            failed++
          }
        }

        if (listings.length < PAGE_SIZE) {
          break
        }

        offset += PAGE_SIZE
      }

      // Update sync log
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'completed',
          itemsProcessed: processed,
          itemsFailed: failed,
          completedAt: new Date(),
          nextScheduledAt: new Date(Date.now() + 30 * 60 * 1000), // Next sync in 30 minutes
        },
      })

      return { processed, failed }
    } catch (error) {
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date(),
        },
      })

      throw error
    }
  }
}

export default ListingsSyncService
