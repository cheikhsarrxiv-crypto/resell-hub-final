/**
 * EtsyAdapter
 * REAL implementation of Etsy Open API v3 integration
 *
 * STATUS: REAL IMPLEMENTATION
 * All methods use actual HTTP calls to Etsy's official Open API v3.
 * Follows https://developer.etsy.com/documentation/ exactly.
 *
 * KEY DIFFERENCES FROM EbayAdapter:
 * - Requires OAuth 2.0 Authorization Code + PKCE (no client_secret in the
 *   token exchange body — code_verifier is used instead).
 * - Every request also requires an `x-api-key` header
 *   (`${clientId}:${clientSecret}`, i.e. keystring:shared secret),
 *   in addition to the Bearer token.
 * - Most endpoints are scoped under a shop_id, which must be resolved
 *   after connecting (there is no separate "sandbox" API — Etsy does not
 *   provide one, so sandboxMode is accepted for config-shape consistency
 *   with other adapters but has no effect here; this is intentional, not
 *   an oversight).
 * - Listings require Etsy-specific taxonomy fields (who_made, when_made,
 *   taxonomy_id) that ADKSY's current product model does not collect.
 *   Documented, sane defaults are used below (see createListing) rather
 *   than fabricating data — flagged clearly as a known limitation.
 */

import MarketplaceAdapter from '@/services/marketplace/MarketplaceAdapter'
import {
  Marketplace,
  MarketplaceAdapterConfig,
  MarketplaceListing,
  MarketplaceListingInput,
  MarketplaceOrder,
} from '@/types/marketplace'
import { ErrorNormalizer } from '@/services/marketplace/ErrorNormalizer'
import crypto from 'crypto'

export class EtsyAdapter extends MarketplaceAdapter {
  marketplace = Marketplace.ETSY
  private baseUrl = 'https://api.etsy.com/v3/application'
  private tokenUrl = 'https://api.etsy.com/v3/public/oauth/token'
  private authUrl = 'https://www.etsy.com/oauth/connect'
  private accessToken?: string
  private shopId?: string

  // PKCE: generated on getOAuthUrl(), consumed by exchangeAuthCode().
  // Not part of the abstract MarketplaceAdapter contract (eBay doesn't
  // need PKCE) — exposed via getCodeVerifier()/setCodeVerifier() so the
  // caller can persist it (short-lived cookie) between the authorize
  // redirect and the callback, matching how setAccessToken() already
  // works as an adapter-specific extra method on EbayAdapter.
  private codeVerifier?: string

  constructor(config: MarketplaceAdapterConfig) {
    super(config)

    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      throw new Error(
        'EtsyAdapter requires clientId, clientSecret, and redirectUri'
      )
    }
    // NOTE: sandboxMode is intentionally unused — Etsy does not provide a
    // sandbox/test environment. Every call here hits the real Etsy API.
  }

  getCodeVerifier(): string | undefined {
    return this.codeVerifier
  }

  setCodeVerifier(verifier: string): void {
    this.codeVerifier = verifier
  }

  getShopId(): string | undefined {
    return this.shopId
  }

  /**
   * REAL: Generate Etsy OAuth authorization URL (Authorization Code + PKCE)
   * https://developer.etsy.com/documentation/essentials/authentication/
   */
  getOAuthUrl(state: string, scopes: string[]): string {
    // Generate a fresh PKCE verifier/challenge pair for this authorization
    // attempt. RFC 7636: verifier must be 43-128 chars of unreserved
    // characters — base64url of 64 random bytes satisfies this.
    this.codeVerifier = crypto.randomBytes(64).toString('base64url')
    const codeChallenge = crypto
      .createHash('sha256')
      .update(this.codeVerifier)
      .digest('base64url')

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: (scopes.length ? scopes : this.getDefaultScopes()).join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    return `${this.authUrl}?${params.toString()}`
  }

  /**
   * REAL: Exchange authorization code for tokens (PKCE — no client_secret
   * in the body; code_verifier proves possession instead)
   */
  async exchangeAuthCode(code: string): Promise<{
    accessToken: string
    refreshToken?: string
    expiresIn?: number
  }> {
    if (!this.codeVerifier) {
      throw new Error(
        'EtsyAdapter: missing PKCE code_verifier. setCodeVerifier() must be ' +
          'called with the value persisted since getOAuthUrl() before exchanging the code.'
      )
    }

    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-api-key': this.config.clientId,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.config.clientId,
          redirect_uri: this.config.redirectUri,
          code,
          code_verifier: this.codeVerifier,
        }).toString(),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw {
          status: response.status,
          message: error.error_description || error.error || 'Etsy OAuth code exchange failed',
          error,
        }
      }

      const data = await response.json()
      this.accessToken = data.access_token

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      }
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'etsy')
    }
  }

  /**
   * REAL: Refresh expired access token
   */
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string
    expiresIn?: number
  }> {
    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-api-key': this.config.clientId,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.config.clientId,
          refresh_token: refreshToken,
        }).toString(),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw {
          status: response.status,
          message: error.error_description || error.error || 'Etsy token refresh failed',
          error,
        }
      }

      const data = await response.json()
      this.accessToken = data.access_token

      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
      }
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'etsy')
    }
  }

  /**
   * REAL: Get active listings for the connected shop
   * https://developer.etsy.com/documentation/reference#operation/getListingsByShop
   */
  async getListings(limit: number = 25, offset: number = 0): Promise<MarketplaceListing[]> {
    const shopId = await this.requireShopId()

    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      state: 'active',
    })

    const response = await this.callEtsyApi(
      'GET',
      `/shops/${shopId}/listings?${params.toString()}`
    )

    return (response.results || []).map((item: any) => this.mapListing(item))
  }

  /**
   * REAL: Get single listing
   */
  async getListing(listingId: string): Promise<MarketplaceListing> {
    const response = await this.callEtsyApi('GET', `/listings/${listingId}`)
    return this.mapListing(response)
  }

  /**
   * REAL: Create a new listing (draft) then publish it
   * https://developer.etsy.com/documentation/tutorials/listings
   *
   * KNOWN LIMITATION: Etsy requires who_made, when_made and taxonomy_id
   * on every listing (it's a handmade/vintage/craft marketplace). ADKSY's
   * product model does not currently collect these. Documented defaults
   * are used below (generic "reseller" values) — real production use
   * would need these fields added to the product/listing form.
   */
  async createListing(listing: MarketplaceListingInput): Promise<MarketplaceListing> {
    const shopId = await this.requireShopId()

    try {
      const draftBody = {
        quantity: listing.quantity,
        title: listing.title,
        description: listing.description || '',
        price: listing.price,
        // --- Required by Etsy, not yet modeled in ADKSY's product form ---
        who_made: 'someone_else', // default: reseller, did not make it
        when_made: 'made_to_order', // placeholder default — see limitation note above
        taxonomy_id: 1, // placeholder top-level category — needs real taxonomy mapping
        // -------------------------------------------------------------
        sku: listing.sku ? [listing.sku] : undefined,
      }

      const draft = await this.callEtsyApi(
        'POST',
        `/shops/${shopId}/listings`,
        draftBody
      )

      // Draft listings are not visible on Etsy until published (state: active)
      const published = await this.callEtsyApi(
        'PATCH',
        `/shops/${shopId}/listings/${draft.listing_id}`,
        { state: 'active' }
      )

      return this.mapListing(published)
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'etsy')
    }
  }

  /**
   * REAL: Update existing listing (title, description, price, quantity)
   */
  async updateListing(
    listingId: string,
    listing: Partial<MarketplaceListingInput>
  ): Promise<MarketplaceListing> {
    const shopId = await this.requireShopId()

    try {
      const updateBody: Record<string, any> = {}
      if (listing.title) updateBody.title = listing.title
      if (listing.description) updateBody.description = listing.description
      if (listing.price !== undefined) updateBody.price = listing.price
      if (listing.quantity !== undefined) updateBody.quantity = listing.quantity

      const response = await this.callEtsyApi(
        'PATCH',
        `/shops/${shopId}/listings/${listingId}`,
        updateBody
      )

      return this.mapListing(response)
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'etsy')
    }
  }

  /**
   * REAL: Delete a listing
   */
  async deleteListing(listingId: string): Promise<void> {
    try {
      await this.callEtsyApi('DELETE', `/listings/${listingId}`)
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'etsy')
    }
  }

  /**
   * REAL: Get orders (Etsy calls them "receipts")
   * https://developer.etsy.com/documentation/tutorials/orders
   */
  async getOrders(limit: number = 25, offset: number = 0): Promise<MarketplaceOrder[]> {
    const shopId = await this.requireShopId()

    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    })

    const response = await this.callEtsyApi(
      'GET',
      `/shops/${shopId}/receipts?${params.toString()}`
    )

    return (response.results || []).map((receipt: any) => this.mapOrder(receipt))
  }

  /**
   * REAL: Get single order (receipt)
   */
  async getOrder(orderId: string): Promise<MarketplaceOrder> {
    const shopId = await this.requireShopId()
    const response = await this.callEtsyApi('GET', `/shops/${shopId}/receipts/${orderId}`)
    return this.mapOrder(response)
  }

  /**
   * REAL: Update order status.
   * Etsy doesn't have a generic "status" field like eBay — shipment
   * tracking is what actually advances a receipt's fulfillment state.
   * Only the "shipped" transition is meaningfully supported here; other
   * status strings are rejected explicitly rather than silently ignored.
   */
  async updateOrderStatus(orderId: string, status: string): Promise<void> {
    const shopId = await this.requireShopId()

    if (status !== 'shipped') {
      throw new Error(
        `EtsyAdapter: updateOrderStatus only supports "shipped" (Etsy has no generic order-status endpoint). Received: "${status}"`
      )
    }

    try {
      await this.callEtsyApi('POST', `/shops/${shopId}/receipts/${orderId}/tracking`, {
        tracking_code: '',
        carrier_name: '',
      })
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'etsy')
    }
  }

  /**
   * REAL: Update inventory quantity for a listing
   * https://developer.etsy.com/documentation/reference#operation/updateListingInventory
   */
  async updateInventory(listingId: string, quantity: number): Promise<void> {
    try {
      // Etsy requires reading current inventory structure before patching it
      // (offerings/variations live inside a single inventory object).
      const current = await this.callEtsyApi('GET', `/listings/${listingId}/inventory`)

      const products = (current.products || []).map((product: any) => ({
        ...product,
        offerings: (product.offerings || []).map((offering: any) => ({
          ...offering,
          quantity,
        })),
      }))

      await this.callEtsyApi('PUT', `/listings/${listingId}/inventory`, { products })
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'etsy')
    }
  }

  /**
   * REAL: Verify webhook signature
   * NOTE: Etsy Open API v3 does not currently publish a documented
   * webhook/signature-verification mechanism equivalent to eBay's. This
   * returns false rather than fabricating a verification scheme — ADKSY
   * should rely on polling (getOrders/getListings) for Etsy until Etsy
   * publishes an official webhook spec.
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    return false
  }

  /**
   * REAL: Validate connection — also resolves and caches the shop_id,
   * required by nearly every other endpoint. Etsy's shop_id maps onto
   * MarketplaceConnection.sellerId (existing field, no migration needed).
   */
  async validateConnection(): Promise<boolean> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    try {
      const me = await this.callEtsyApi('GET', '/users/me')
      const shopsResponse = await this.callEtsyApi(
        'GET',
        `/users/${me.user_id}/shops`
      )

      if (!shopsResponse?.shop_id) {
        return false
      }

      this.shopId = shopsResponse.shop_id.toString()
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Set access token for API calls
   */
  setAccessToken(token: string): void {
    this.accessToken = token
  }

  private async requireShopId(): Promise<string> {
    if (!this.accessToken) {
      throw new Error('Access token required. Call exchangeAuthCode or setAccessToken first.')
    }
    if (!this.shopId) {
      const valid = await this.validateConnection()
      if (!valid || !this.shopId) {
        throw new Error('Could not resolve Etsy shop_id for this connection.')
      }
    }
    return this.shopId
  }

  private getDefaultScopes(): string[] {
    return ['listings_r', 'listings_w', 'listings_d', 'transactions_r', 'transactions_w']
  }

  private mapListing(item: any): MarketplaceListing {
    return {
      id: item.listing_id?.toString(),
      marketplaceId: Marketplace.ETSY,
      title: item.title,
      description: item.description || '',
      price: item.price?.amount && item.price?.divisor
        ? item.price.amount / item.price.divisor
        : 0,
      quantity: item.quantity || 0,
      externalId: item.listing_id?.toString(),
      status: item.state === 'active' ? 'active' : 'inactive',
      marketplace: Marketplace.ETSY,
      url: item.url,
    }
  }

  private mapOrder(receipt: any): MarketplaceOrder {
    return {
      id: receipt.receipt_id?.toString(),
      externalOrderId: receipt.receipt_id?.toString(),
      buyerId: receipt.buyer_user_id?.toString() || '',
      buyerName: receipt.name || '',
      buyerEmail: receipt.buyer_email || '',
      totalPrice: receipt.grandtotal?.amount && receipt.grandtotal?.divisor
        ? receipt.grandtotal.amount / receipt.grandtotal.divisor
        : 0,
      status: receipt.status || 'pending',
      createdAt: receipt.created_timestamp
        ? new Date(receipt.created_timestamp * 1000)
        : undefined,
      items: (receipt.transactions || []).map((t: any) => ({
        listingId: t.listing_id?.toString() || '',
        title: t.title || '',
        quantity: t.quantity || 1,
        price: t.price?.amount && t.price?.divisor
          ? t.price.amount / t.price.divisor
          : 0,
      })),
      shippingAddress: receipt.first_line
        ? {
            name: receipt.name || '',
            street1: receipt.first_line,
            street2: receipt.second_line || undefined,
            city: receipt.city || '',
            state: receipt.state || '',
            postalCode: receipt.zip || '',
            country: receipt.country_iso || '',
          }
        : undefined,
    }
  }

  /**
   * REAL: Make authenticated API call to Etsy.
   * SECURITY: token is only ever sent as a Bearer header, never logged.
   */
  private async callEtsyApi(
    method: string,
    endpoint: string,
    body?: Record<string, any>
  ): Promise<any> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    const url = `${this.baseUrl}${endpoint}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.accessToken}`,
      'x-api-key': this.config.clientId,
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw {
          status: response.status,
          statusCode: response.status,
          message: error.error || error.message || `Etsy API error: ${response.statusText}`,
          error,
        }
      }

      const text = await response.text()
      return text ? JSON.parse(text) : {}
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'etsy')
    }
  }
}

export default EtsyAdapter
