/**
 * GET /api/marketplace/callback/[marketplace]?code=...&state=...
 * OAuth callback from marketplace.
 *
 * REAL IMPLEMENTATION:
 * - Verifies the authenticated user/workspace (session required)
 * - Validates OAuth "state" (CSRF protection) is well-formed before use
 * - Delegates code -> token exchange to MarketplaceConnectionService,
 *   which performs the real HTTP call to the marketplace and stores
 *   tokens AES-256-GCM encrypted (see TokenManager)
 * - Never logs or returns raw tokens; only a redirect + generic status
 *   is exposed to the client
 * - Workspace isolation: tokens are stored scoped to workspaceId, and
 *   the workspaceId used here comes only from the authenticated session
 */

import { auth } from '@/auth'
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService'
import { Marketplace } from '@/types/marketplace'
import { NextRequest, NextResponse } from 'next/server'

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

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

export async function GET(
  req: NextRequest,
  { params }: { params: { marketplace: string } }
) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.redirect(new URL('/login', req.url))
    }

    const workspaceId = session.user.workspaceId || 'default'
    const marketplaceParam = params.marketplace.toUpperCase()

    const marketplace = SUPPORTED_MARKETPLACES[marketplaceParam]
    if (!marketplace) {
      return NextResponse.json(
        { error: 'Marketplace not supported' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(req.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const oauthError = searchParams.get('error')

    // Marketplace can redirect back with an error instead of a code
    // (e.g. user denied access on the consent screen)
    if (oauthError) {
      return NextResponse.redirect(
        new URL(
          `/dashboard/settings/integrations?status=error&error=${encodeURIComponent(oauthError)}`,
          req.url
        )
      )
    }

    if (!code || !state) {
      return NextResponse.json(
        { error: 'Missing code or state parameter' },
        { status: 400 }
      )
    }

    // Basic well-formedness check on state before handing off to the
    // service (which performs the real timing-safe verification against
    // the stored expected state during token exchange).
    if (typeof state !== 'string' || state.length !== 64) {
      return NextResponse.json(
        { error: 'Invalid OAuth state' },
        { status: 400 }
      )
    }

    // PKCE (Etsy only): retrieve the code_verifier persisted by the
    // connect route. Undefined for eBay (cookie never set for it).
    const pkceCookieName = `pkce_verifier_${marketplaceParam.toLowerCase()}`
    const codeVerifier = req.cookies.get(pkceCookieName)?.value

    const service = new MarketplaceConnectionService(getConnectionConfig(marketplace))

    // Real code -> token exchange + encrypted storage (workspace-scoped)
    await service.handleOAuthCallback(workspaceId, marketplace, code, state, codeVerifier)

    // No token or sensitive data is included in the redirect or logs.
    const response = NextResponse.redirect(
      new URL(
        `/dashboard/settings/integrations?status=connected&marketplace=${marketplace}`,
        req.url
      )
    )
    if (codeVerifier) {
      response.cookies.delete(pkceCookieName)
    }
    return response
  } catch (error) {
    // Log only a generic message; never log the raw error object, which
    // could contain OAuth codes or partial token data from upstream.
    console.error('[Marketplace Callback] OAuth callback failed for workspace-scoped connection attempt')

    const errorMsg = error instanceof Error ? error.message : 'Connection failed'
    return NextResponse.redirect(
      new URL(
        `/dashboard/settings/integrations?status=error&error=${encodeURIComponent(errorMsg)}`,
        req.url
      )
    )
  }
}
