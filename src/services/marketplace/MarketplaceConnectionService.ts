/**
 * MarketplaceConnectionService
 * Handle marketplace connection lifecycle: connect, disconnect, refresh, sync
 */

import { prisma } from '@/lib/prisma'
import { TokenManager } from './TokenManager'
import { AdapterFactory } from './AdapterFactory'
import {
  Marketplace,
  ManualCredentials,
  getMarketplaceAuthType,
  isOAuthConnectable,
  isManualCredentialConnectable,
} from '@/types/marketplace'

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

    // Multi-marketplace auth architecture (Option B): getOAuthUrl is no
    // longer part of every adapter's mandatory contract — a marketplace
    // with no OAuth flow at all (Vinted) never implements it. This never
    // actually triggers for eBay/Etsy today (the connect route's own
    // SUPPORTED_MARKETPLACES already excludes Vinted), but fails with a
    // clear, specific message rather than a generic "is not a function"
    // if it's ever called for a non-OAuth marketplace by mistake.
    if (!isOAuthConnectable(adapter)) {
      throw new Error(`${marketplace} does not support OAuth — use connectWithManualCredentials() instead`)
    }

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

    // Same guard as initiateConnection — never actually triggered for
    // eBay/Etsy (the callback route's own SUPPORTED_MARKETPLACES already
    // excludes Vinted), but fails clearly rather than with "is not a
    // function" if this is ever reached for a non-OAuth marketplace.
    if (!isOAuthConnectable(adapter)) {
      throw new Error(`${marketplace} does not support OAuth — use connectWithManualCredentials() instead`)
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
   * Connect a marketplace whose real authentication model has no OAuth
   * flow at all — today: Vinted Pro Integrations (access key + signing
   * key, generated manually in Vinted's own Pro portal, entered directly
   * here). Multi-marketplace auth architecture, Option B.
   *
   * Mirrors handleOAuthCallback()'s own shape/ordering as closely as
   * that different auth model allows: adapter resolved -> credentials
   * handed to it -> validateConnection() as the real gate before any DB
   * write -> encrypt -> upsert. Never encrypts/persists anything before
   * validateConnection() succeeds — unlike an invalid OAuth code (which
   * fails inside exchangeAuthCode before this point), invalid manual
   * credentials are only ever caught here, so nothing is written on a
   * bad value.
   *
   * SECURITY:
   * - workspaceId is trusted exactly as every other method here already
   *   does (caller — the route — is responsible for verifyWorkspaceAccess,
   *   the same trust boundary handleOAuthCallback/disconnectMarketplace
   *   already rely on).
   * - Never logs `credentials` (or any of its values) — only the
   *   marketplace name and workspaceId ever appear in a thrown error
   *   message.
   * - Idempotent: same (workspaceId, marketplace) upsert key as the OAuth
   *   path — calling this again with new credentials replaces the old
   *   ones; calling it again with the same credentials is a no-op change
   *   to stored data (still a valid upsert, not an error).
   */
  async connectWithManualCredentials(
    workspaceId: string,
    marketplace: Marketplace,
    credentials: ManualCredentials
  ): Promise<{
    connectionId: string
    marketplace: Marketplace
    status: string
  }> {
    if (getMarketplaceAuthType(marketplace) !== 'manual_credentials') {
      throw new Error(`${marketplace} does not use manual credential authentication`)
    }

    const credentialEntries = Object.entries(credentials)

    if (credentialEntries.length === 0 || credentialEntries.some(([, value]) => !value || !value.trim())) {
      throw new Error('Invalid credentials: every provided value must be a non-empty string')
    }

    // MarketplaceConnection has exactly two encrypted-secret columns
    // (see this method's own comment further below on reusing them) —
    // a marketplace needing a third independent secret would need a real
    // schema change, so this is rejected explicitly rather than silently
    // dropping a field.
    if (credentialEntries.length > 2) {
      throw new Error(
        `${marketplace}: manual credential authentication supports at most 2 secret values; got ${credentialEntries.length}`
      )
    }

    const adapter = AdapterFactory.createAdapter(marketplace, {
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri,
      sandboxMode: this.config.sandboxMode,
    })

    if (!isManualCredentialConnectable(adapter)) {
      // Defensive backstop: getMarketplaceAuthType() and the adapter's
      // own declared capability should never disagree, but if they ever
      // did, this fails loudly rather than silently calling a method
      // that doesn't exist.
      throw new Error(`${marketplace}'s adapter does not implement ManualCredentialConnectable`)
    }

    adapter.setManualCredentials(credentials)

    // The real gate — never a network call ADKSY invents itself (see
    // VintedAdapter's own validateConnection: it still throws its
    // documented "BLOCKED, no partner access" error today; that error
    // propagates unmodified from here, so this method genuinely cannot
    // succeed against the real VintedAdapter until real API access
    // exists — never a fabricated success).
    const isValid = await adapter.validateConnection()
    if (!isValid) {
      throw new Error(`Failed to validate ${marketplace} connection`)
    }

    // Reuses the exact same two encrypted-string columns the OAuth path
    // uses. Checked deliberately (multi-marketplace auth architecture
    // audit, Étape 7): TokenManager.encryptToken/decryptToken are pure
    // string encryption with no OAuth-specific semantics, and these two
    // columns are nullable, independent text columns — storing an
    // (accessKey, signingKey) pair in them instead of an (accessToken,
    // refreshToken) pair is not ambiguous at the DB level (still exactly
    // two independent encrypted secrets per connection), so no migration
    // is needed. See this task's own final report for the full reasoning
    // on why a rename was considered and deliberately not done.
    const [, primaryValue] = credentialEntries[0]
    const secondaryEntry = credentialEntries[1]

    const encryptedPrimary = this.tokenManager.encryptToken(primaryValue, workspaceId)
    const encryptedSecondary = secondaryEntry
      ? this.tokenManager.encryptToken(secondaryEntry[1], workspaceId)
      : null

    const connection = await prisma.marketplaceConnection.upsert({
      where: {
        workspaceId_marketplaceId: {
          workspaceId,
          marketplaceId: marketplace,
        },
      },
      update: {
        status: 'connected',
        encryptedOauthToken: encryptedPrimary.encrypted,
        encryptedRefreshToken: encryptedSecondary?.encrypted ?? null,
        tokenExpiresAt: null, // manual credentials have no OAuth-style expiry
        lastApiCallAt: new Date(),
        consecutiveErrors: 0,
      },
      create: {
        workspaceId,
        marketplaceId: marketplace,
        status: 'connected',
        encryptedOauthToken: encryptedPrimary.encrypted,
        encryptedRefreshToken: encryptedSecondary?.encrypted ?? null,
        tokenExpiresAt: null, // manual credentials have no OAuth-style expiry
        lastApiCallAt: new Date(),
        consecutiveErrors: 0,
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
          { encrypted: connection.encryptedRefreshToken },
          workspaceId
        )

        const adapter = AdapterFactory.createAdapter(marketplace, {
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          redirectUri: this.config.redirectUri,
          sandboxMode: this.config.sandboxMode,
        })

        // Same guard as initiateConnection/handleOAuthCallback. In
        // practice this branch is only ever reached when
        // connection.tokenExpiresAt is set, which connectWithManualCredentials
        // never sets (manual credentials have no OAuth-style expiry) —
        // but the compiler can't know that, and a clear error here is
        // strictly better than "is not a function" if it's ever reached.
        if (!isOAuthConnectable(adapter)) {
          throw new Error(`${marketplace} does not support OAuth token refresh`)
        }

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
      { encrypted: connection.encryptedOauthToken },
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
