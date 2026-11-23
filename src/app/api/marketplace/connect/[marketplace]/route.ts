/**
 * GET /api/marketplace/connect/[marketplace]
 * Initiate OAuth connection to marketplace
 */

import { auth } from '@/auth'
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService'
import { Marketplace } from '@/types/marketplace'
import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkspaceAccess, errorResponse } from '@/lib/security'
import { getMarketplaceConnectionConfig, MarketplaceConfigError } from '@/lib/marketplaceOAuthConfig'
import { createBoundStateCookieValue } from '@/lib/oauthStateBinding'

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

const SUPPORTED_MARKETPLACES: Record<string, Marketplace> = {
  EBAY: Marketplace.EBAY,
  ETSY: Marketplace.ETSY,
}

export async function GET(
  req: NextRequest,
  { params }: { params: { marketplace: string } }
) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // No fabricated "default" workspace: an account with no workspace on
    // its session cannot initiate a marketplace connection at all.
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

    // Validate marketplace
    const marketplace = SUPPORTED_MARKETPLACES[marketplaceParam]
    if (!marketplace) {
      return NextResponse.json(
        { error: 'Marketplace not supported' },
        { status: 400 }
      )
    }

    // B.11.1: fail-closed configuration check (Sandbox/Production, credentials, callback) BEFORE any
    // OAuth URL is built. Only a reason code is logged, never a value or a secret.
    let connectionConfig
    try {
      connectionConfig = getMarketplaceConnectionConfig(marketplace === Marketplace.EBAY ? 'ebay' : 'etsy')
    } catch (configError) {
      if (configError instanceof MarketplaceConfigError) {
        console.error(`[Marketplace Connect] refused: configuration (${configError.reason})`)
        return NextResponse.json(
          { error: 'Marketplace connection is not available: configuration refused', code: 'MARKETPLACE_CONFIG_INVALID' },
          { status: 503 }
        )
      }
      throw configError
    }

    const service = new MarketplaceConnectionService(connectionConfig)

    const { authUrl, state, codeVerifier } = await service.initiateConnection(workspaceId, marketplace)

    const response = NextResponse.json({
      authUrl,
      state,
    })

    const isProduction = process.env.NODE_ENV === 'production'

    // CSRF protection for the OAuth "state" parameter: bind it to this
    // browser via a short-lived httpOnly cookie, the same pattern already
    // used below for Etsy's PKCE code_verifier. The callback route
    // compares the state it receives from the marketplace against this
    // cookie (TokenManager.verifyOAuthState) before doing anything else,
    // and deletes it immediately after — one-time-use, 10-minute TTL.
    // B.11.1: the cookie value is the state BOUND (HMAC) to the verified workspace and user that start
    // the flow; the callback rejects any other workspace/user. Not the bare state anymore.
    const boundState = createBoundStateCookieValue(state, {
      marketplace: marketplaceParam.toLowerCase(),
      workspaceId,
      userId: session.user.id,
    })
    response.cookies.set(`oauth_state_${marketplaceParam.toLowerCase()}`, boundState, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 600, // 10 minutes — matches the PKCE cookie below
      path: '/',
    })

    // PKCE (Etsy only): persist the code_verifier in a short-lived,
    // httpOnly cookie so the callback route can retrieve it. Never
    // logged, never returned in the JSON body, never stored in the DB.
    if (codeVerifier) {
      response.cookies.set(`pkce_verifier_${marketplaceParam.toLowerCase()}`, codeVerifier, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 600, // 10 minutes — plenty for the OAuth redirect round-trip
        path: '/',
      })
    }

    return response
  } catch (error) {
    console.error('Connect marketplace error:', error)
    return errorResponse(error)
  }
}
