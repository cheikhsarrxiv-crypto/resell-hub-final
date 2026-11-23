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
import { SubscriptionService } from '@/services/SubscriptionService'
import { verifyBoundState } from '@/lib/oauthStateBinding'
import { consumeOAuthState } from '@/lib/oauthStateConsumption'
import { getMarketplaceConnectionConfig, MarketplaceConfigError } from '@/lib/marketplaceOAuthConfig'
import { Marketplace } from '@/types/marketplace'
import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkspaceAccess } from '@/lib/security'

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
  const marketplaceParam = params.marketplace.toUpperCase()
  const stateCookieName = `oauth_state_${marketplaceParam.toLowerCase()}`
  // Tracks whether the state cookie has been confirmed genuine and
  // should be deleted on whatever response we return from here on —
  // including an error redirect if the token exchange itself fails
  // afterward. Once validated, the state must never be usable again.
  let consumedState = false

  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.redirect(new URL('/login', req.url))
    }

    // No fabricated "default" workspace: an account with no workspace on
    // its session cannot complete a marketplace connection at all.
    if (!session.user.workspaceId) {
      return NextResponse.redirect(
        new URL(
          `/dashboard/settings/integrations?status=error&error=${encodeURIComponent(
            'No workspace found for this account'
          )}`,
          req.url
        )
      )
    }

    // Same ownership + verified-email check every other workspace-scoped
    // route in the app uses (src/lib/security.ts) — re-verified fresh
    // against the database, not just trusted from the JWT.
    const workspaceId = await verifyWorkspaceAccess(session.user.workspaceId)

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

    // CSRF protection: the state returned by the marketplace must match
    // the one generated and stored in an httpOnly cookie when this flow
    // was initiated (connect/route.ts) — a well-formed-looking state is
    // not enough on its own. A missing cookie (expired, never set, or
    // already consumed by a previous callback) or a mismatch means this
    // request wasn't triggered by a flow this browser actually started.
    const expectedState = req.cookies.get(stateCookieName)?.value

    // B.11.1: the cookie is the state BOUND to the workspace + user that started the flow. The CURRENT
    // verified session (workspaceId above, session.user.id) must be that workspace + user: a session or
    // workspace change between connect and callback is rejected, never re-attributed. A rejected flow whose
    // cookie was ours (expired / other workspace) is consumed so it can never be replayed.
    const verdict =
      state.length === 64
        ? verifyBoundState(expectedState, state, {
            marketplace: marketplaceParam.toLowerCase(),
            workspaceId,
            userId: session.user.id,
          })
        : ({ ok: false, reason: 'malformed_state', consume: false } as const)

    if (!verdict.ok) {
      const rejection = NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 })
      if (verdict.consume) rejection.cookies.delete(stateCookieName)
      return rejection
    }

    // B.11.1-R: SERVER-SIDE single use. Deleting the browser cookie is not a guarantee (a copy of the cookie
    // stays valid), so the first request records the state in a durable ledger with an atomic unique insert
    // BEFORE any code exchange; every other request with the same state (replay, parallel, other instance) gets
    // 'replay'. If the ledger cannot be written, this throws and nothing is exchanged (fail closed).
    const consumption = await consumeOAuthState({
      workspaceId,
      marketplace: marketplaceParam.toLowerCase(),
      state,
    })
    if (consumption === 'replay') {
      const replayed = NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 })
      replayed.cookies.delete(stateCookieName)
      return replayed
    }

    // State confirmed genuine, bound to this workspace and now consumed durably — it can never be
    // replayed, regardless of whether the token exchange below succeeds.
    consumedState = true

    // PKCE (Etsy only): retrieve the code_verifier persisted by the
    // connect route. Undefined for eBay (cookie never set for it).
    const pkceCookieName = `pkce_verifier_${marketplaceParam.toLowerCase()}`
    const codeVerifier = req.cookies.get(pkceCookieName)?.value

    const service = new MarketplaceConnectionService(
      getMarketplaceConnectionConfig(marketplace === Marketplace.EBAY ? 'ebay' : 'etsy')
    )

    // Enforce the plan's marketplace-connection limit — but only for a
    // brand new connection. handleOAuthCallback() below upserts, so
    // reconnecting/refreshing an existing connection to this same
    // marketplace must stay allowed even at the limit; it doesn't add to
    // the count.
    const existingConnection = await service.getConnection(workspaceId, marketplace)
    if (!existingConnection && (await SubscriptionService.isLimitReached(workspaceId, 'marketplaces'))) {
      const response = NextResponse.redirect(
        new URL(
          `/dashboard/settings/integrations?status=error&error=${encodeURIComponent(
            'Marketplace connection limit reached for your plan'
          )}`,
          req.url
        )
      )
      response.cookies.delete(stateCookieName)
      return response
    }

    // Real code -> token exchange + encrypted storage (workspace-scoped)
    await service.handleOAuthCallback(workspaceId, marketplace, code, state, codeVerifier)

    // No token or sensitive data is included in the redirect or logs.
    const response = NextResponse.redirect(
      new URL(
        `/dashboard/settings/integrations?status=connected&marketplace=${marketplace}`,
        req.url
      )
    )
    response.cookies.delete(stateCookieName)
    if (codeVerifier) {
      response.cookies.delete(pkceCookieName)
    }
    return response
  } catch (error) {
    // Log only a generic message; never log the raw error object, which
    // could contain OAuth codes or partial token data from upstream.
    // Only a reason code for a refused configuration (never a value or a secret).
    if (error instanceof MarketplaceConfigError) {
      console.error(`[Marketplace Callback] refused: configuration (${error.reason})`)
    }
    console.error('[Marketplace Callback] OAuth callback failed for workspace-scoped connection attempt')

    // SECURITY (R3-C.9): the redirect URL ends up in browser history, proxies and logs, so an
    // upstream error message (which can carry provider details or token fragments) is never put
    // in it. Only a message this route itself understands is shown; everything else is generic.
    const rawMessage = error instanceof Error ? error.message : ''
    const errorMsg = /^Failed to validate [A-Za-z]+ connection$/.test(rawMessage)
      ? rawMessage
      : 'Connection failed. Please try again.'
    const response = NextResponse.redirect(
      new URL(
        `/dashboard/settings/integrations?status=error&error=${encodeURIComponent(errorMsg)}`,
        req.url
      )
    )
    if (consumedState) {
      response.cookies.delete(stateCookieName)
    }
    return response
  }
}
