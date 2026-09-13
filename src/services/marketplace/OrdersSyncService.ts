/**
 * OrdersSyncService
 * Sync orders from a marketplace into ResellHub. The adapter and its
 * client config are resolved generically per marketplace (AdapterFactory /
 * getMarketplaceAdapterConfig) — callers today only ever pass Marketplace.EBAY
 * (see the sync-orders cron), Etsy support here is not yet activated by any caller.
 */

import { prisma } from '@/lib/prisma'
import { AdapterFactory, getMarketplaceAdapterConfig } from './AdapterFactory'
import { MarketplaceConnectionService } from './MarketplaceConnectionService'
import { RateLimitManager } from './RateLimitManager'
import { StatusMapper } from './StatusMapper'
import { Marketplace } from '@/types/marketplace'
import { ProductService } from '@/services/ProductService'

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
      // Config resolved per marketplace (see getMarketplaceAdapterConfig) —
      // no hardcoded eBay credentials here, so this same code path works
      // for any marketplace the caller passes in.
      const config = getMarketplaceAdapterConfig(marketplace)
      const connService = new MarketplaceConnectionService(config)

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
              const createdOrder = await prisma.order.create({
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

              // STOCK: only reached on first sight of this order — the
              // "existing" branch above (status/price updates on later
              // syncs of the same order) never re-enters here, so each
              // real sale reserves inventory exactly once regardless of
              // how many times this order is synced afterwards.
              for (const item of order.items || []) {
                if (!item.sku) {
                  console.error(
                    `[OrdersSyncService] Order ${order.externalOrderId} line "${item.title}" has no SKU — skipping inventory reservation`
                  )
                  continue
                }

                const product = await prisma.product.findUnique({
                  where: { workspaceId_sku: { workspaceId, sku: item.sku } },
                })

                if (!product) {
                  console.error(
                    `[OrdersSyncService] Order ${order.externalOrderId}: no product found for SKU "${item.sku}" in workspace ${workspaceId} — skipping inventory reservation`
                  )
                  continue
                }

                try {
                  await ProductService.reserveInventory(product.id, workspaceId, item.quantity)
                } catch (reserveError) {
                  // Insufficient inventory (or a missing Inventory row)
                  // must never block recording the sale or the rest of
                  // this sync run — reserveInventory's atomic guard
                  // already guarantees `available` never goes negative;
                  // we just log the discrepancy for manual reconciliation
                  // instead of silently dropping the order line below.
                  console.error(
                    `[OrdersSyncService] Order ${order.externalOrderId}: failed to reserve inventory for product ${product.id} (SKU "${item.sku}"): ${
                      reserveError instanceof Error ? reserveError.message : 'unknown error'
                    }`
                  )
                }

                await prisma.orderItem.create({
                  data: {
                    orderId: createdOrder.id,
                    productId: product.id,
                    title: item.title,
                    quantity: item.quantity,
                    price: item.price,
                  },
                })
              }
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
