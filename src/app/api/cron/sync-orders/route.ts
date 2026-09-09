/**
 * GET /api/cron/sync-orders
 *
 * Vercel Cron endpoint (see vercel.json, every 5 minutes): syncs eBay
 * orders into ResellHub for every workspace with a connected eBay
 * MarketplaceConnection.
 *
 * - Protected by CRON_SECRET (see src/lib/cronAuth.ts) — rejects with 401
 *   if missing/incorrect, never logs or returns the secret.
 * - Iterates real workspaceIds from connected MarketplaceConnection rows
 *   only; never falls back to a default workspace.
 * - Each workspace is processed independently: a failure on one workspace
 *   is caught and counted, and does not stop the others from running.
 * - Response is a generic summary only (counts) — never access tokens,
 *   refresh tokens, client secrets, or any per-workspace sensitive data.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyCronSecret } from '@/lib/cronAuth'
import { OrdersSyncService } from '@/services/marketplace/OrdersSyncService'
import { Marketplace } from '@/types/marketplace'

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const connections = await prisma.marketplaceConnection.findMany({
    where: { marketplaceId: Marketplace.EBAY, status: 'connected' },
    select: { workspaceId: true },
  })

  const service = new OrdersSyncService()
  let succeeded = 0
  let failed = 0
  let skipped = 0

  for (const connection of connections) {
    try {
      const result = await service.syncOrders(connection.workspaceId, Marketplace.EBAY)
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
