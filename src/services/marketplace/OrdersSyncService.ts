/**
 * OrdersSyncService
 * Sync orders from eBay to ResellHub
 */

import { prisma } from '@/lib/prisma'
import { EbayAdapter } from './adapters/EbayAdapter'
import { MarketplaceConnectionService } from './MarketplaceConnectionService'
import { StatusMapper } from './StatusMapper'
import { Marketplace } from '@/types/marketplace'

export class OrdersSyncService {
  async syncOrders(workspaceId: string, marketplace: Marketplace) {
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

      // Get orders from eBay
      const orders = await adapter.getOrders(100, 0)

      let processed = 0
      let failed = 0

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
