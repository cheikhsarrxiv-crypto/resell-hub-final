/**
 * Mints and caches an eBay OAuth "application access token" via the
 * client_credentials grant — used ONLY for the Browse API (read-only,
 * public product search). This is deliberately a completely separate
 * credential and code path from the seller OAuth flow
 * (EbayAdapter.ts/MarketplaceConnectionService.ts):
 *  - Different grant type (client_credentials vs authorization_code).
 *  - Different scope (`https://api.ebay.com/oauth/api_scope`, the public
 *    read scope — never a seller's sell.inventory/sell.fulfillment scopes).
 *  - Different, dedicated env vars (EBAY_BUY_API_CLIENT_ID/SECRET) —
 *    never EBAY_CLIENT_ID/EBAY_CLIENT_SECRET, so nothing about the
 *    seller OAuth fix in progress can affect this, and nothing here can
 *    affect it either.
 *  - No per-workspace/per-seller token: this is one application-wide
 *    token, never tied to a reseller's account, never stored per
 *    workspace, never encrypted with TokenManager (that class exists to
 *    protect a specific user's marketplace credentials — this token
 *    identifies ADKSY's own app to eBay's public catalog, not any user).
 *
 * Token endpoint verified against eBay's own OAuth documentation:
 * POST https://api.ebay.com/identity/v1/oauth2/token — NOT
 * auth.ebay.com/oauth2/token (that host is for the browser-facing
 * /oauth2/authorize redirect and the authorization_code token exchange
 * only; see the correction prepared for EbayAdapter.ts in the OAuth
 * audit — unrelated to this file, since this manager never uses that
 * grant type at all).
 */

const TOKEN_ENDPOINT = 'https://api.ebay.com/identity/v1/oauth2/token';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const REQUEST_TIMEOUT_MS = 10_000;

// Refresh this many seconds before actual expiry, so a request in flight
// never gets caught using a token that expires mid-call.
const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

export class EbayApplicationTokenAuthError extends Error {}
export class EbayApplicationTokenTimeoutError extends Error {}

export class EbayApplicationTokenManager {
  // Module-level in-memory cache, shared across instances within one
  // running process. On a serverless platform (Vercel), a cold start
  // starts with an empty cache and mints a fresh token on first use —
  // this is a known, accepted limitation (the same one already
  // documented for the in-memory rate limiter in src/lib/ratelimit.ts),
  // not something this class works around.
  private static cached: CachedToken | null = null;

  static clearCache(): void {
    this.cached = null;
  }

  static isConfigured(): boolean {
    return Boolean(process.env.EBAY_BUY_API_CLIENT_ID && process.env.EBAY_BUY_API_CLIENT_SECRET);
  }

  static async getAccessToken(): Promise<string> {
    const clientId = process.env.EBAY_BUY_API_CLIENT_ID;
    const clientSecret = process.env.EBAY_BUY_API_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new EbayApplicationTokenAuthError(
        'EBAY_BUY_API_CLIENT_ID/EBAY_BUY_API_CLIENT_SECRET are not set'
      );
    }

    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.accessToken;
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: SCOPE,
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new EbayApplicationTokenTimeoutError('eBay token request timed out');
      }
      throw error;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new EbayApplicationTokenAuthError(
        body.error_description || `eBay token request failed with status ${response.status}`
      );
    }

    const data = await response.json();
    const expiresInSeconds: number = data.expires_in ?? 0;

    this.cached = {
      accessToken: data.access_token,
      expiresAt: Date.now() + Math.max(0, expiresInSeconds - EXPIRY_SAFETY_MARGIN_SECONDS) * 1000,
    };

    return this.cached.accessToken;
  }
}

export default EbayApplicationTokenManager;
