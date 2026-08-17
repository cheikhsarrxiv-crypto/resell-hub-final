/**
 * GET /api/marketplace/connect/[marketplace]
 * Initiate OAuth connection to marketplace
 */

import { auth } from '@/auth'
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService'
import { Marketplace } from '@/types/marketplace'
import { NextRequest, NextResponse } from 'next/server'

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
  // Etsy has no sandbox environment — sandboxMode is accepted for config
  // shape consistency but unused by EtsyAdapter (see adapter comments).
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = session.user.workspaceId || 'default'
    const marketplaceParam = params.marketplace.toUpperCase()

    // Validate marketplace
    const marketplace = SUPPORTED_MARKETPLACES[marketplaceParam]
    if (!marketplace) {
      return NextResponse.json(
        { error: 'Marketplace not supported' },
        { status: 400 }
      )
    }

    const service = new MarketplaceConnectionService(getConnectionConfig(marketplace))

    const { authUrl, state, codeVerifier } = await service.initiateConnection(workspaceId, marketplace)

    const response = NextResponse.json({
      authUrl,
      state,
    })

    // PKCE (Etsy only): persist the code_verifier in a short-lived,
    // httpOnly cookie so the callback route can retrieve it. Never
    // logged, never returned in the JSON body, never stored in the DB.
    if (codeVerifier) {
      response.cookies.set(`pkce_verifier_${marketplaceParam.toLowerCase()}`, codeVerifier, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600, // 10 minutes — plenty for the OAuth redirect round-trip
        path: '/',
      })
    }

    return response
  } catch (error) {
    console.error('Connect marketplace error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initiate connection' },
      { status: 500 }
    )
  }
}
