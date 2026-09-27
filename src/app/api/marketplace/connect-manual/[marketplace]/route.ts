/**
 * POST /api/marketplace/connect-manual/[marketplace]
 * Multi-marketplace auth architecture (Option B) — connects a marketplace
 * whose real authentication model has no OAuth flow at all (today: Vinted
 * Pro Integrations — an access key + signing key the workspace generates
 * manually in Vinted's own Pro portal, outside ADKSY, and pastes here).
 *
 * Deliberately a separate route from /connect and /callback, never
 * reusing their OAuth-shaped machinery (authUrl, state, PKCE cookies) —
 * none of that has any meaning for a marketplace with no redirect flow.
 * The OAuth connect/callback routes are entirely unmodified by this file.
 *
 * SECURITY:
 * - Requires an authenticated session; workspaceId is re-verified via
 *   verifyWorkspaceAccess, never trusted from the JWT alone — same
 *   pattern every other workspace-scoped marketplace route already uses.
 * - Only marketplaces whose real auth type is 'manual_credentials'
 *   (getMarketplaceAuthType) are accepted — an OAuth marketplace (eBay/
 *   Etsy/Depop) sent here is rejected with 400, never silently routed
 *   through the wrong path.
 * - The request body is validated by connectManualCredentialsSchema
 *   before ever reaching the service.
 * - Never logs or returns the submitted credential values, at any point
 *   — only a generic success/error status.
 */

import { auth } from '@/auth'
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService'
import { Marketplace, getMarketplaceAuthType } from '@/types/marketplace'
import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkspaceAccess, errorResponse } from '@/lib/security'
import { connectManualCredentialsSchema } from '@/lib/validations'

// This route reads the authenticated session and writes a real DB row —
// must never be statically rendered or cached.
export const dynamic = 'force-dynamic'

// Deliberately only the marketplaces whose real auth type is
// 'manual_credentials' — never eBay/Etsy/Depop, which stay on
// /connect + /callback exclusively. Kept as an explicit allowlist here
// (like every other marketplace route's own SUPPORTED_MARKETPLACES),
// re-checked against getMarketplaceAuthType() below so the two can never
// silently drift apart.
const SUPPORTED_MARKETPLACES: Record<string, Marketplace> = {
  VINTED: Marketplace.VINTED,
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
    // its session has nothing to connect.
    if (!session.user.workspaceId) {
      return NextResponse.json(
        { error: 'No workspace found for this account' },
        { status: 403 }
      )
    }

    // Same ownership + verified-email check every other workspace-scoped
    // route in the app uses — re-verified fresh against the database.
    const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId)

    const marketplaceParam = params.marketplace.toUpperCase()
    const marketplace = SUPPORTED_MARKETPLACES[marketplaceParam]

    if (!marketplace || getMarketplaceAuthType(marketplace) !== 'manual_credentials') {
      return NextResponse.json(
        { error: 'Marketplace not supported for manual credential connection' },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => null)
    const result = connectManualCredentialsSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // clientId/clientSecret/redirectUri are OAuth-only concepts — Vinted
    // needs none of them (accepted here only for config-shape consistency
    // with the OAuth marketplaces' own ConnectionConfig, same convention
    // already used for Etsy's unused sandboxMode).
    const service = new MarketplaceConnectionService({
      clientId: '',
      clientSecret: '',
      redirectUri: '',
    })

    await service.connectWithManualCredentials(workspaceId, marketplace, result.data.credentials)

    return NextResponse.json({
      status: 'connected',
      marketplace,
    })
  } catch (error) {
    // Generic log line only — never the request body, never anything
    // derived from `credentials`.
    console.error('[Marketplace Connect Manual] Failed to connect marketplace with manual credentials')
    return errorResponse(error)
  }
}
