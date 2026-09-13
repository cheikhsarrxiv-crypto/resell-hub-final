/**
 * GET /api/cron/sync-orders
 *
 * Vercel Cron endpoint (see vercel.json, every 5 minutes): syncs orders
 * into ResellHub for every workspace with a connected eBay or Etsy
 * MarketplaceConnection. Depop/Vinted are intentionally excluded — they
 * have no working OAuth connection flow (see AdapterFactory).
 *
 * - Protected by CRON_SECRET (see src/lib/cronAuth.ts) — rejects with 401
 *   if missing/incorrect, never logs or returns the secret.
 * - Iterates real workspaceIds from connected MarketplaceConnection rows
 *   only; never falls back to a default workspace.
 * - Each workspace+marketplace pair is processed independently and
 *   sequentially: a failure on one does not stop the others, and there is
 *   no concurrent sync for the same pair within a single run (one
 *   MarketplaceConnection row per (workspaceId, marketplaceId) — see the
 *   @@unique constraint on the model). eBay and Etsy rows for the same
 *   workspace are separate pairs, so one marketplace's failure or in-
 *   progress sync (OrdersSyncService's own SyncLog guard is keyed by
 *   marketplace) never blocks or interferes with the other.
 * - Response is a generic summary only (counts) — never access tokens,
 *   refresh tokens, client secrets, or any per-workspace sensitive data.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyCronSecret } from '@/lib/cronAuth'
import { OrdersSyncService } from '@/services/marketplace/OrdersSyncService'
import { Marketplace } from '@/types/marketplace'

const SYNCED_MARKETPLACES = [Marketplace.EBAY, Marketplace.ETSY]

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const connections = await prisma.marketplaceConnection.findMany({
    where: { marketplaceId: { in: SYNCED_MARKETPLACES }, status: 'connected' },
    select: { workspaceId: true, marketplaceId: true },
  })

  const service = new OrdersSyncService()
  let succeeded = 0
  let failed = 0
  let skipped = 0

  for (const connection of connections) {
    try {
      const result = await service.syncOrders(connection.workspaceId, connection.marketplaceId as Marketplace)
      if (result.skipped) {
        skipped++
      } else {
        succeeded++
      }
    } catch (error) {
      failed++
      console.error(
        `[Cron sync-orders] Failed for workspace ${connection.workspaceId}:`,
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  return NextResponse.json({
    workspacesTotal: connections.length,
    succeeded,
    failed,
    skipped,
  })
}
