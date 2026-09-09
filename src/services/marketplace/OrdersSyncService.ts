/**
 * OrdersSyncService
 * Sync orders from eBay to ResellHub
 */

import { prisma } from '@/lib/prisma'
import { EbayAdapter } from './adapters/EbayAdapter'
import { MarketplaceConnectionService } from './MarketplaceConnectionService'
import { RateLimitManager } from './RateLimitManager'
import { StatusMapper } from './StatusMapper'
import { Marketplace } from '@/types/marketplace'

const PAGE_SIZE = 100
// Safety cap: never page indefinitely (max 5000 orders processed per run).
const MAX_PAGES = 50
// A SyncLog stuck at 'in_progress' longer than this is treated as stale
// (e.g. a crashed invocation), not a real concurrent run. Well above the
// 5-minute orders cron interval.
const STALE_IN_PROGRESS_MS = 15 * 60 * 1000

export class OrdersSyncService {
  async syncOrders(workspaceId: string, marketplace: Marketplace) {
    // Concurrency guard using the existing SyncLog model: if a genuinely
    // recent run is still in_progress for this workspace, skip starting a
    // second one instead of racing two syncs against the same rows. This
    // reuses SyncLog rather than adding any new lock mechanism.
    const alreadyRunning = await prisma.syncLog.findFirst({
      where: {
        workspaceId,
        marketplace,
        syncType: 'order',
        status: 'in_progress',
        startedAt: { gt: new Date(Date.now() - STALE_IN_PROGRESS_MS) },
      },
    })
    if (alreadyRunning) {
      return { processed: 0, failed: 0, skipped: true, reason: 'already_in_progress' as const }
    }

    const syncLog = await prisma.syncLog.create({
      data: {
        workspaceId,
        marketplace,
        syncType: 'order',
        status: 'in_progress',
      },
    })

    try {
      const connService = new MarketplaceConnectionService({
        clientId: process.env.EBAY_CLIENT_ID || '',
        clientSecret: process.env.EBAY_CLIENT_SECRET || '',
        redirectUri: process.env.EBAY_REDIRECT_URI || '',
        sandboxMode: process.env.EBAY_SANDBOX_MODE !== 'false',
      })

      const token = await connService.getAccessToken(workspaceId, marketplace)

      const adapter = new EbayAdapter({
        clientId: process.env.EBAY_CLIENT_ID || '',
        clientSecret: process.env.EBAY_CLIENT_SECRET || '',
        redirectUri: process.env.EBAY_REDIRECT_URI || '',
        sandboxMode: process.env.EBAY_SANDBOX_MODE !== 'false',
      })

      adapter.setAccessToken(token)

      // Scoped to this single run/workspace: correctly gates the burst of
      // requests a multi-page sync makes for one eBay account. Does not
      // persist across separate cron invocations (in-memory only) — see
      // RateLimitManager's own header comment.
      const rateLimiter = new RateLimitManager()

      let processed = 0
      let failed = 0
      let offset = 0
      let pagesFetched = 0

      // Page through eBay's orders until a short page signals there's no
      // more (the adapter doesn't propagate eBay's total count, so "fewer
      // than PAGE_SIZE returned" is the only available signal), or the
      // safety cap is hit.
      while (pagesFetched < MAX_PAGES) {
        await rateLimiter.checkLimit(marketplace, workspaceId)

        const orders = await adapter.getOrders(PAGE_SIZE, offset)
        pagesFetched++

        for (const order of orders) {
          try {
            // Map status
            const mappedStatus = StatusMapper.mapToResellHub(marketplace, order.status)

            // Upsert order (idempotent) — externalOrderId isn't a unique key in the schema, look it up manually
            const existing = await prisma.order.findFirst({
              where: { workspaceId, externalOrderId: order.externalOrderId },
            })

            if (existing) {
              await prisma.order.update({
                where: { id: existing.id },
                data: {
                  status: mappedStatus,
                  customerEmail: order.buyerEmail || '',
                  totalPrice: order.totalPrice,
                  updatedAt: new Date(),
                },
              })
            } else {
              await prisma.order.create({
                data: {
                  workspaceId,
                  externalOrderId: order.externalOrderId,
                  customerId: order.buyerId,
                  customerName: order.buyerName,
                  customerEmail: order.buyerEmail || '',
                  totalPrice: order.totalPrice,
                  estimatedProfit: 0,
                  shippingAddress: order.shippingAddress?.street1 || '',
                  shippingCity: order.shippingAddress?.city || '',
                  shippingPostalCode: order.shippingAddress?.postalCode || '',
                  shippingCountry: order.shippingAddress?.country || '',
                  status: mappedStatus,
                },
              })
            }

            processed++
          } catch (error) {
            console.error(`Failed to sync order ${order.id}:`, error)
            failed++
          }
        }

        if (orders.length < PAGE_SIZE) {
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
          nextScheduledAt: new Date(Date.now() + 5 * 60 * 1000), // Next sync in 5 minutes
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

export default OrdersSyncService
