/**
 * POST /api/marketplace/disconnect/[marketplace]
 * Disconnect a marketplace connection for the authenticated user's workspace.
 *
 * REAL IMPLEMENTATION:
 * - Requires an authenticated session
 * - Workspace isolation: only the connection belonging to the session's
 *   workspaceId can be disconnected (enforced by the unique
 *   workspaceId_marketplaceId constraint used in the update query)
 * - Clears encrypted tokens and marks the connection as not_connected
 *   rather than deleting the row, preserving audit/history fields
 * - Never logs or returns token data
 */

import { auth } from '@/auth'
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService'
import { Marketplace } from '@/types/marketplace'
import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkspaceAccess, errorResponse } from '@/lib/security'

const SUPPORTED_MARKETPLACES: Record<string, Marketplace> = {
  EBAY: Marketplace.EBAY,
  ETSY: Marketplace.ETSY,
}

function getConnectionConfig(marketplace: Marketplace) {
  if (marketplace === Marketplace.EBAY) {
    return {
      clientId: process.env.EBAY_CLIENT_ID || '',
      clientSecret: process.env.EBAY_CLIENT_SECRET || '',
      redirectUri: process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/ebay',
      sandboxMode: process.env.EBAY_SANDBOX_MODE !== 'false',
    }
  }
  return {
    clientId: process.env.ETSY_CLIENT_ID || '',
    clientSecret: process.env.ETSY_CLIENT_SECRET || '',
    redirectUri: process.env.ETSY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/etsy',
    sandboxMode: false,
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { marketplace: string } }
) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // No fabricated "default" workspace: an account with no workspace on
    // its session has nothing to disconnect.
    if (!session.user.workspaceId) {
      return NextResponse.json(
        { error: 'No workspace found for this account' },
        { status: 403 }
      )
    }

    // Same ownership + verified-email check every other workspace-scoped
    // route in the app uses (src/lib/security.ts) — re-verified fresh
    // against the database, not just trusted from the JWT.
    const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId)

    const marketplaceParam = params.marketplace.toUpperCase()

    const marketplace = SUPPORTED_MARKETPLACES[marketplaceParam]
    if (!marketplace) {
      return NextResponse.json(
        { error: 'Marketplace not supported' },
        { status: 400 }
      )
    }

    const service = new MarketplaceConnectionService(getConnectionConfig(marketplace))

    // Workspace-scoped disconnect: only clears/updates the connection row
    // that matches (workspaceId, marketplace) for the current session.
    await service.disconnectMarketplace(workspaceId, marketplace)

    return NextResponse.json({
      status: 'disconnected',
      marketplace,
    })
  } catch (error) {
    console.error('[Marketplace Disconnect] Failed to disconnect marketplace connection')
    return errorResponse(error)
  }
}
