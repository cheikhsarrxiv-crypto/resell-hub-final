/**
 * ListingsSyncService
 * Sync listings from eBay to ResellHub
 */

import { prisma } from '@/lib/prisma'
import { EbayAdapter } from './adapters/EbayAdapter'
import { MarketplaceConnectionService } from './MarketplaceConnectionService'
import { Marketplace } from '@/types/marketplace'

export class ListingsSyncService {
  async syncListings(workspaceId: string, marketplace: Marketplace) {
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
      const connService = new MarketplaceConnectionService({
        clientId: process.env.EBAY_CLIENT_ID || '',
        clientSecret: process.env.EBAY_CLIENT_SECRET || '',
        redirectUri: process.env.EBAY_REDIRECT_URI || '',
        sandboxMode: process.env.EBAY_SANDBOX_MODE !== 'false',
      })

      // Get access token
      const token = await connService.getAccessToken(workspaceId, marketplace)

      const adapter = new EbayAdapter({
        clientId: process.env.EBAY_CLIENT_ID || '',
        clientSecret: process.env.EBAY_CLIENT_SECRET || '',
        redirectUri: process.env.EBAY_REDIRECT_URI || '',
        sandboxMode: process.env.EBAY_SANDBOX_MODE !== 'false',
      })

      adapter.setAccessToken(token)

      // Get listings from eBay
      const listings = await adapter.getListings(100, 0)

      let processed = 0
      let failed = 0

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
