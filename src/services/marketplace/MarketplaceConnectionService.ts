/**
 * MarketplaceConnectionService
 * Handle marketplace connection lifecycle: connect, disconnect, refresh, sync
 */

import { prisma } from '@/lib/prisma'
import { TokenManager } from './TokenManager'
import { AdapterFactory } from './AdapterFactory'
import { Marketplace } from '@/types/marketplace'

interface ConnectionConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  sandboxMode?: boolean
}

export class MarketplaceConnectionService {
  private tokenManager: TokenManager
  private config: ConnectionConfig

  constructor(config: ConnectionConfig) {
    this.tokenManager = new TokenManager()
    this.config = config
  }

  /**
   * Initiate OAuth connection
   */
  async initiateConnection(workspaceId: string, marketplace: Marketplace): Promise<{
    authUrl: string
    state: string
    codeVerifier?: string
  }> {
    const state = this.tokenManager.generateOAuthState()

    // Store state in cache/session (you'd use Redis in production)
    // For now, just return it and expect the callback to verify

    const adapter = AdapterFactory.createAdapter(marketplace, {
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri,
      sandboxMode: this.config.sandboxMode,
    })

    const authUrl = adapter.getOAuthUrl(state, [])

    // PKCE (Etsy): the adapter generates its own verifier inside
    // getOAuthUrl() and exposes it via getCodeVerifier(), an adapter-
    // specific extra method (not part of the abstract contract — eBay
    // doesn't implement it, so this is simply undefined for eBay).
    const codeVerifier =
      typeof (adapter as any).getCodeVerifier === 'function'
        ? (adapter as any).getCodeVerifier()
        : undefined

    return { authUrl, state, codeVerifier }
  }

  /**
   * Handle OAuth callback
   */
  async handleOAuthCallback(
    workspaceId: string,
    marketplace: Marketplace,
    code: string,
    state: string,
    codeVerifier?: string
  ): Promise<{
    connectionId: string
    marketplace: Marketplace
    status: string
  }> {
    // Verify state (in production, check against stored state)
    if (!state || state.length !== 64) {
      throw new Error('Invalid OAuth state')
    }

    const adapter = AdapterFactory.createAdapter(marketplace, {
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri,
      sandboxMode: this.config.sandboxMode,
    })

    // PKCE (Etsy only): pass the verifier through before exchanging the
    // code. No-op for adapters that don't implement setCodeVerifier (eBay).
    if (codeVerifier && typeof (adapter as any).setCodeVerifier === 'function') {
      ;(adapter as any).setCodeVerifier(codeVerifier)
    }

    // Exchange code for tokens
    const { accessToken, refreshToken, expiresIn } = await adapter.exchangeAuthCode(code)

    // Encrypt tokens
    const encryptedAccess = this.tokenManager.encryptToken(accessToken, workspaceId)
    const encryptedRefresh = refreshToken
      ? this.tokenManager.encryptToken(refreshToken, workspaceId)
      : null

    // Get seller info (call marketplace API with new token)
    ;(adapter as any).setAccessToken(accessToken)
    const isValid = await adapter.validateConnection()

    if (!isValid) {
      throw new Error(`Failed to validate ${marketplace} connection`)
    }

    // Some adapters resolve a marketplace-specific seller/shop identifier
    // during validateConnection() (e.g. Etsy's shop_id). Reuse the existing
    // sellerId column rather than adding a new one — no migration needed.
    const sellerId =
      typeof (adapter as any).getShopId === 'function'
        ? (adapter as any).getShopId()
        : undefined

    // Create or update connection
    const connection = await prisma.marketplaceConnection.upsert({
      where: {
        workspaceId_marketplaceId: {
          workspaceId,
          marketplaceId: marketplace,
        },
      },
      update: {
        status: 'connected',
        encryptedOauthToken: encryptedAccess.encrypted,
        encryptedRefreshToken: encryptedRefresh?.encrypted,
        tokenExpiresAt: this.tokenManager.calculateTokenExpiry(expiresIn),
        lastApiCallAt: new Date(),
        consecutiveErrors: 0,
        ...(sellerId ? { sellerId } : {}),
      },
      create: {
        workspaceId,
        marketplaceId: marketplace,
        status: 'connected',
        encryptedOauthToken: encryptedAccess.encrypted,
        encryptedRefreshToken: encryptedRefresh?.encrypted,
        tokenExpiresAt: this.tokenManager.calculateTokenExpiry(expiresIn),
        lastApiCallAt: new Date(),
        consecutiveErrors: 0,
        ...(sellerId ? { sellerId } : {}),
      },
    })

    return {
      connectionId: connection.id,
      marketplace,
      status: 'connected',
    }
  }

  /**
   * Get active connection
   */
  async getConnection(workspaceId: string, marketplace: Marketplace) {
    return prisma.marketplaceConnection.findUnique({
      where: {
        workspaceId_marketplaceId: {
          workspaceId,
          marketplaceId: marketplace,
        },
      },
    })
  }

  /**
   * Get or refresh access token
   */
  async getAccessToken(workspaceId: string, marketplace: Marketplace): Promise<string> {
    const connection = await this.getConnection(workspaceId, marketplace)

    if (!connection) {
      throw new Error('No connection found')
    }

    if (connection.status !== 'connected') {
      throw new Error(`Connection status is ${connection.status}`)
    }

    // Check if token needs refresh
    if (connection.tokenExpiresAt && this.tokenManager.shouldRefreshToken(connection.tokenExpiresAt)) {
      if (!connection.encryptedRefreshToken) {
        throw new Error('Cannot refresh token: no refresh token stored')
      }

      try {
        const decrypted = this.tokenManager.decryptToken(
          {
            encrypted: connection.encryptedRefreshToken,
            iv: connection.id, // Use connection ID as salt (not ideal but works)
          },
          workspaceId
        )

        const adapter = AdapterFactory.createAdapter(marketplace, {
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          redirectUri: this.config.redirectUri,
          sandboxMode: this.config.sandboxMode,
        })

        const { accessToken, expiresIn } = await adapter.refreshToken(decrypted)

        // Store new token
        const encrypted = this.tokenManager.encryptToken(accessToken, workspaceId)

        await prisma.marketplaceConnection.update({
          where: { id: connection.id },
          data: {
            encryptedOauthToken: encrypted.encrypted,
            tokenExpiresAt: this.tokenManager.calculateTokenExpiry(expiresIn),
            lastApiCallAt: new Date(),
          },
        })

        return accessToken
      } catch (error) {
        // Mark connection as expired
        await prisma.marketplaceConnection.update({
          where: { id: connection.id },
          data: {
            status: 'expired',
            lastSyncError: `Token refresh failed: ${error}`,
          },
        })
        throw error
      }
    }

    // Decrypt and return stored token
    if (!connection.encryptedOauthToken) {
      throw new Error('No access token stored')
    }

    return this.tokenManager.decryptToken(
      {
        encrypted: connection.encryptedOauthToken,
        iv: connection.id,
      },
      workspaceId
    )
  }

  /**
   * Disconnect marketplace
   * Idempotent: if no connection exists for this workspace/marketplace,
   * this is treated as already-disconnected rather than an error.
   */
  async disconnectMarketplace(workspaceId: string, marketplace: Marketplace) {
    const existing = await prisma.marketplaceConnection.findUnique({
      where: {
        workspaceId_marketplaceId: {
          workspaceId,
          marketplaceId: marketplace,
        },
      },
    })

    if (!existing) {
      return null
    }

    return prisma.marketplaceConnection.update({
      where: {
        workspaceId_marketplaceId: {
          workspaceId,
          marketplaceId: marketplace,
        },
      },
      data: {
        status: 'not_connected',
        encryptedOauthToken: null,
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
      },
    })
  }
}

export default MarketplaceConnectionService
