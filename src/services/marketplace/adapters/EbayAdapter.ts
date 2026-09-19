/**
 * EbayAdapter
 * REAL implementation of eBay Sell API integration
 * 
 * STATUS: REAL IMPLEMENTATION
 * All methods use actual HTTP calls to eBay REST API
 * Follows official eBay documentation exactly
 */

import MarketplaceAdapter from '@/services/marketplace/MarketplaceAdapter'
import {
  Address,
  Marketplace,
  MarketplaceAdapterConfig,
  MarketplaceListing,
  MarketplaceListingInput,
  MarketplaceOrder,
} from '@/types/marketplace'
import { ErrorNormalizer } from '@/services/marketplace/ErrorNormalizer'
import { logger } from '@/lib/logger'

export class EbayAdapter extends MarketplaceAdapter {
  marketplace = Marketplace.EBAY
  private baseUrl: string
  private authUrl: string
  private accessToken?: string

  constructor(config: MarketplaceAdapterConfig) {
    super(config)

    const useSandbox = config.sandboxMode !== false
    this.baseUrl = useSandbox
      ? 'https://api.sandbox.ebay.com'
      : 'https://api.ebay.com'
    this.authUrl = useSandbox
      ? 'https://auth.sandbox.ebay.com'
      : 'https://auth.ebay.com'

    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      throw new Error(
        'EbayAdapter requires clientId, clientSecret, and redirectUri'
      )
    }
  }

  /**
   * REAL: Generate eBay OAuth authorization URL
   */
  getOAuthUrl(state: string, scopes: string[]): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      state: state,
      scope: scopes.join(' ') || this.getDefaultScopes().join(' '),
    })

    return `${this.authUrl}/oauth2/authorize?${params.toString()}`
  }

  /**
   * REAL: Exchange authorization code for tokens
   *
   * Phase 10.5 fix: the token exchange must hit the API host's
   * /identity/v1/oauth2/token endpoint (https://api[.sandbox].ebay.com),
   * NOT authUrl (https://auth[.sandbox].ebay.com) — that host is reserved
   * for the browser-facing /oauth2/authorize redirect used by
   * getOAuthUrl() below. Confirmed by the Phase 10 audit: this previously
   * called `${this.authUrl}/oauth2/token`, which would fail against real
   * eBay servers.
   */
  async exchangeAuthCode(code: string): Promise<{
    accessToken: string
    refreshToken?: string
    expiresIn?: number
  }> {
    const auth = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64')

    try {
      const response = await fetch(`${this.baseUrl}/identity/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: this.config.redirectUri,
        }).toString(),
      })

      if (!response.ok) {
        const error = await response.json()
        // TEMPORARY DEBUG (remove once the Sandbox token-exchange failure
        // is diagnosed) — logs only eBay's own response fields (never the
        // request we sent: no client_secret, no authorization code, no
        // Authorization header, no token). logger.filterSensitiveData
        // provides a second layer of redaction on top of this explicit
        // allow-list.
        logger.error('eBay OAuth token exchange failed', undefined, {
          status: response.status,
          ebayError: error.error,
          ebayErrorDescription: error.error_description,
          ebayErrorId: error.error_id,
        })
        throw {
          status: response.status,
          message: error.error_description || 'OAuth code exchange failed',
          error: error,
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
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * REAL: Refresh expired access token
   *
   * Phase 10.5 fix: same endpoint correction as exchangeAuthCode above —
   * the API host's /identity/v1/oauth2/token, never authUrl.
   */
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string
    expiresIn?: number
  }> {
    const auth = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64')

    try {
      const response = await fetch(`${this.baseUrl}/identity/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      })

      if (!response.ok) {
        const error = await response.json()
        throw {
          status: response.status,
          message: error.error_description || 'Token refresh failed',
          error: error,
        }
      }

      const data = await response.json()
      this.accessToken = data.access_token

      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
      }
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * REAL: Get active listings from eBay
   * https://developer.ebay.com/docs/sell/inventory/get-items
   */
  async getListings(
    limit: number = 25,
    offset: number = 0
  ): Promise<MarketplaceListing[]> {
    if (!this.accessToken) {
      throw new Error('Access token required. Call exchangeAuthCode or setAccessToken first.')
    }

    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })

      const response = await this.callEbayApi(
        'GET',
        `/sell/inventory/v1/inventory?${params.toString()}`,
        this.accessToken
      )

      return (response.inventories || []).map((item: any) => ({
        id: item.sku,
        marketplaceId: Marketplace.EBAY,
        title: item.title,
        description: item.description || '',
        price: item.price?.value ? parseFloat(item.price.value) : 0,
        quantity: item.availability?.totalQuantity || 0,
        externalId: item.sku,
        status: 'active',
        marketplace: Marketplace.EBAY,
      }))
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * REAL: Get single listing
   */
  async getListing(listingId: string): Promise<MarketplaceListing> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    try {
      const response = await this.callEbayApi(
        'GET',
        `/sell/inventory/v1/inventory/${listingId}`,
        this.accessToken
      )

      return {
        id: response.sku,
        marketplaceId: Marketplace.EBAY,
        title: response.title,
        description: response.description || '',
        price: response.price?.value ? parseFloat(response.price.value) : 0,
        quantity: response.availability?.totalQuantity || 0,
        externalId: response.sku,
        status: 'active',
        marketplace: Marketplace.EBAY,
      }
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * Phase 12C-Prep — rejects a publish attempt BEFORE any HTTP call when a
   * field this adapter used to silently hardcode/omit is actually missing.
   * Thrown as a plain {status: 400, message} object — the exact shape
   * callEbayApi's own error branch already produces — so
   * ErrorNormalizer.normalizeEbayError's existing statusCode===400 branch
   * categorizes it as VALIDATION_ERROR without any new error taxonomy.
   * Never invents a currency/condition/category/marketplace — the caller
   * (ListingService / the future publish_listing action) must supply real
   * values, sourced from ListingDraft's own required fields (see
   * validateEbayDraft in src/lib/listing/listingDraft.ts, which already
   * enforces this before a confirmation would even be offered).
   */
  private validateListingInputForPublish(listing: MarketplaceListingInput): void {
    const missing: string[] = [];
    if (!listing.currency) missing.push('currency');
    if (!listing.condition) missing.push('condition');
    if (!listing.ebay?.categoryId) missing.push('ebay.categoryId');
    if (!listing.ebay?.marketplaceId) missing.push('ebay.marketplaceId');

    if (missing.length > 0) {
      throw {
        status: 400,
        message: `EbayAdapter.createListing: missing required field(s): ${missing.join(', ')}. Nothing was sent to eBay.`,
      }
    }
  }

  /**
   * REAL: Create new listing on eBay
   * https://developer.ebay.com/docs/sell/inventory/create-item
   */
  async createListing(
    listing: MarketplaceListingInput
  ): Promise<MarketplaceListing> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    try {
      // A pre-flight validation failure must be normalized exactly like
      // any other eBay error (see this method's own try/catch), so it's
      // deliberately inside this try block, not before it.
      this.validateListingInputForPublish(listing)
      const currency = listing.currency!
      const condition = listing.condition!
      const categoryId = listing.ebay!.categoryId
      const marketplaceId = listing.ebay!.marketplaceId

      // Step 1: Create inventory item
      //
      // VERIFICATION NOTE (Phase 12C-Prep): developer.ebay.com is
      // egress-blocked in this sandbox (confirmed: CONNECT returns 403),
      // so this shape — product.{title,description,imageUrls} +
      // availability.shipToLocationAvailability.quantity + a top-level
      // condition — is based on well-established, stable, general eBay
      // Sell Inventory API knowledge (createOrReplaceInventoryItem), NOT
      // verified here against a live or vendored spec the way
      // EtsyListingMapper.ts's fields were (see that file's own header
      // comment for the technique used there). The PRIOR code's flat
      // {title, description, price, quantity} body was itself never
      // verified either — eBay's real inventory_item resource does not
      // accept price/quantity at the top level at all (price belongs on
      // the Offer, quantity under availability), so this is a correction,
      // not a regression, but still: spot-check against eBay's sandbox
      // docs before any real publish attempt in Phase 12C.
      const inventoryBody: Record<string, any> = {
        sku: listing.sku || `SKU-${Date.now()}`,
        product: {
          title: listing.title,
          description: listing.description,
          // Only sent when the draft actually has images — eBay's own
          // requirements for image URLs (reachability, format, count)
          // are not re-validated here; this only ever forwards what the
          // caller already has, never fabricates a placeholder image.
          ...(listing.images && listing.images.length > 0 ? { imageUrls: listing.images } : {}),
        },
        availability: {
          shipToLocationAvailability: {
            quantity: listing.quantity,
          },
        },
        condition,
      }

      const createResponse = await this.callEbayApi(
        'POST',
        '/sell/inventory/v1/inventory_item',
        this.accessToken,
        inventoryBody,
        marketplaceId
      )

      const sku = createResponse.sku || inventoryBody.sku

      // Step 2: Create the offer (still unpublished/draft on eBay's side
      // until the offer is explicitly published in step 3 below)
      const offerBody = {
        sku: sku,
        marketplaceId,
        format: 'FIXED_PRICE',
        categoryId: String(categoryId),
        pricingSummary: {
          price: {
            currency,
            value: listing.price.toString(),
          },
        },
      }

      const offerResponse = await this.callEbayApi(
        'POST',
        '/sell/inventory/v1/offer',
        this.accessToken,
        offerBody,
        marketplaceId
      )

      const offerId = offerResponse.offerId
      if (!offerId) {
        throw {
          status: 502,
          message: 'eBay did not return an offerId for the created offer; the listing was not published',
        }
      }

      // Step 3: Publish the offer. Without this call the offer remains in
      // eBay's unpublished/draft state and is never visible to buyers,
      // even though steps 1-2 above succeeded.
      const publishResponse = await this.callEbayApi(
        'POST',
        `/sell/inventory/v1/offer/${offerId}/publish`,
        this.accessToken,
        undefined,
        marketplaceId
      )

      return {
        id: sku,
        marketplaceId: Marketplace.EBAY,
        title: listing.title,
        description: listing.description,
        price: listing.price,
        quantity: listing.quantity,
        externalId: publishResponse.listingId || sku,
        status: 'active',
        marketplace: Marketplace.EBAY,
      }
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * REAL: Update listing
   * https://developer.ebay.com/docs/sell/inventory/change-item
   */
  async updateListing(
    listingId: string,
    listing: Partial<MarketplaceListingInput>
  ): Promise<MarketplaceListing> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    try {
      // Phase 12C-Prep: a price update with no currency is never sent with
      // a silently invented one — the caller must say what currency the
      // new price is in.
      if (listing.price !== undefined && !listing.currency) {
        throw { status: 400, message: 'EbayAdapter.updateListing: price given without currency. Nothing was sent to eBay.' }
      }

      const updateBody: any = {}

      if (listing.title) updateBody.title = listing.title
      if (listing.description) updateBody.description = listing.description
      if (listing.price !== undefined) {
        updateBody.price = {
          currency: listing.currency,
          value: listing.price.toString(),
        }
      }
      if (listing.quantity) {
        updateBody.quantity = {
          value: listing.quantity,
        }
      }

      const response = await this.callEbayApi(
        'PATCH',
        `/sell/inventory/v1/inventory/${listingId}`,
        this.accessToken,
        updateBody
      )

      return {
        id: response.sku || listingId,
        marketplaceId: Marketplace.EBAY,
        title: response.title || listing.title || '',
        description: response.description || listing.description || '',
        price: response.price?.value ? parseFloat(response.price.value) : (listing.price || 0),
        quantity: response.availability?.totalQuantity || (listing.quantity || 0),
        externalId: response.sku || listingId,
        status: 'active',
        marketplace: Marketplace.EBAY,
      }
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * REAL: Delete/end listing
   * https://developer.ebay.com/docs/sell/inventory/delete-item
   */
  async deleteListing(listingId: string): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    try {
      await this.callEbayApi(
        'DELETE',
        `/sell/inventory/v1/inventory_item/${listingId}`,
        this.accessToken
      )
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * REAL: Get orders from eBay
   * https://developer.ebay.com/docs/sell/fulfillment/get-orders
   */
  async getOrders(
    limit: number = 25,
    offset: number = 0
  ): Promise<MarketplaceOrder[]> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      })

      const response = await this.callEbayApi(
        'GET',
        `/sell/fulfillment/v1/order?${params.toString()}`,
        this.accessToken
      )

      return (response.orders || []).map((order: any) => ({

        id: order.orderId,
        externalOrderId: order.orderId,
        buyerId: order.buyer?.username || '',
        buyerName: order.buyer?.username || '',
        buyerEmail: order.buyer?.email || '',
        totalPrice: order.pricingSummary?.total?.value
          ? parseFloat(order.pricingSummary.total.value)
          : 0,
        status: order.orderStatus || 'pending',
        createdAt: new Date(order.creationDate),
        items: (order.lineItems || []).map((item: any) => ({
          title: item.title,
          quantity: item.quantity,
          price: item.lineItemPrice?.value ? parseFloat(item.lineItemPrice.value) : 0,
          sku: item.sku,
        })),
        shippingAddress: this.mapShipToAddress(this.findShipToInstruction(order.fulfillmentStartInstructions)?.shippingStep?.shipTo),
      }))
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * REAL: Get single order
   */
  async getOrder(orderId: string): Promise<MarketplaceOrder> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    try {
      const response = await this.callEbayApi(
        'GET',
        `/sell/fulfillment/v1/order/${orderId}`,
        this.accessToken
      )

      return {
        id: response.orderId,
        externalOrderId: response.orderId,
        buyerId: response.buyer?.username || '',
        buyerName: response.buyer?.username || '',
        buyerEmail: response.buyer?.email || '',
        totalPrice: response.pricingSummary?.total?.value
          ? parseFloat(response.pricingSummary.total.value)
          : 0,
        status: response.orderStatus || 'pending',
        createdAt: new Date(response.creationDate),
        items: (response.lineItems || []).map((item: any) => ({
          title: item.title,
          quantity: item.quantity,
          price: item.lineItemPrice?.value ? parseFloat(item.lineItemPrice.value) : 0,
        })),
        shippingAddress: this.mapShipToAddress(this.findShipToInstruction(response.fulfillmentStartInstructions)?.shippingStep?.shipTo),
      }
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * REAL: Update order status
   */
  async updateOrderStatus(orderId: string, status: string): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    try {
      const body = {
        orderStatus: status,
      }

      await this.callEbayApi(
        'PATCH',
        `/sell/fulfillment/v1/order/${orderId}`,
        this.accessToken,
        body
      )
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * REAL: Update inventory quantity via eBay's bulkUpdatePriceQuantity.
   * https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/bulkUpdatePriceQuantity
   *
   * Takes the Product SKU (the exact value ResellHub sent to eBay when
   * publishing — see createListing above), never Listing.externalId,
   * which eBay sets to its own listingId, a different identifier the
   * Inventory API does not accept here.
   *
   * Chosen over the alternative, createOrReplaceInventoryItem (PUT
   * .../inventory_item/{sku}), because that call REPLACES the entire
   * inventory item — every field (title, description, condition,
   * images...) must be resent or it's overwritten/cleared. This endpoint
   * updates only quantity (and optionally price) without touching
   * anything else, which is all a stock sync needs.
   *
   * IDEMPOTENT BY DESIGN: the caller always passes the current absolute
   * quantity (Inventory.available), never a relative delta — sending the
   * same quantity twice is a no-op on eBay's side.
   */
  async updateInventory(sku: string, quantity: number): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    try {
      const body = {
        requests: [
          {
            sku,
            shipToLocationAvailability: {
              quantity,
            },
          },
        ],
      }

      const response = await this.callEbayApi(
        'POST',
        '/sell/inventory/v1/bulk_update_price_quantity',
        this.accessToken,
        body
      )

      // bulkUpdatePriceQuantity can return HTTP 200 with a per-SKU failure
      // embedded in the response body — callEbayApi only throws on a
      // non-2xx HTTP status, so a rejected SKU (e.g. "does not exist")
      // would otherwise be silently treated as success.
      const result = response?.responses?.[0]
      if (result?.statusCode && result.statusCode >= 300) {
        throw {
          status: result.statusCode,
          statusCode: result.statusCode,
          message: result.errors?.[0]?.message || `eBay rejected the inventory update for SKU ${sku}`,
          error: result,
        }
      }
    } catch (error) {
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }

  /**
   * REAL: Verify webhook signature
   */
  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    if (!signature || !secret) return false

    try {
      const crypto = require('crypto')
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('base64')

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )
    } catch (error) {
      return false
    }
  }

  /**
   * REAL: Validate connection
   */
  async validateConnection(): Promise<boolean> {
    if (!this.accessToken) {
      throw new Error('Access token required')
    }

    try {
      await this.callEbayApi(
        'GET',
        '/sell/fulfillment/v1/order?limit=1',
        this.accessToken
      )
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

  private getDefaultScopes(): string[] {
    return [
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
      'https://api.ebay.com/oauth/api_scope/sell.account',
    ]
  }

  /**
   * An order can carry more than one fulfillmentStartInstruction (e.g. a
   * Click & Collect / PREPARE_FOR_PICKUP instruction alongside a normal
   * SHIP_TO one) — https://developer.ebay.com/api-docs/sell/fulfillment/types/sel:FulfillmentInstructionsType.
   * Always picking index [0] would silently grab the wrong one whenever
   * SHIP_TO isn't first. Prefer the instruction explicitly typed SHIP_TO;
   * fall back to the first one that actually has a shipTo container (older
   * responses may omit fulfillmentInstructionsType); fall back to [0] as a
   * last resort so a shippable order never loses its address entirely just
   * because eBay didn't tag the type.
   */
  private findShipToInstruction(instructions: any[] | undefined): any {
    if (!instructions || instructions.length === 0) {
      return undefined
    }
    return (
      instructions.find((instruction) => instruction.fulfillmentInstructionsType === 'SHIP_TO') ||
      instructions.find((instruction) => instruction.shippingStep?.shipTo) ||
      instructions[0]
    )
  }

  /**
   * REAL: Map eBay's shipTo (an ExtendedContact) to ResellHub's own Address
   * shape. shipTo — not shippingAddress, which doesn't exist on eBay's real
   * response — lives at fulfillmentStartInstructions[].shippingStep.shipTo.
   * https://developer.ebay.com/api-docs/sell/fulfillment/types/sel:ExtendedContact
   * primaryPhone is itself an object ({ phoneNumber }), and eBay does not
   * return it at all for orders older than 90 days — both are real eBay
   * behavior, not something to work around here.
   */
  private mapShipToAddress(shipTo: any): Address | undefined {
    if (!shipTo) {
      return undefined
    }
    const contactAddress = shipTo.contactAddress || {}
    return {
      name: shipTo.fullName || '',
      street1: contactAddress.addressLine1 || '',
      street2: contactAddress.addressLine2 || undefined,
      city: contactAddress.city || '',
      state: contactAddress.stateOrProvince || undefined,
      postalCode: contactAddress.postalCode || '',
      country: contactAddress.countryCode || '',
      phone: shipTo.primaryPhone?.phoneNumber || undefined,
      email: shipTo.email || undefined,
    }
  }

  /**
   * REAL: Make authenticated API call to eBay
   *
   * Phase 12C-Prep: `marketplaceId` is now an explicit parameter, defaulted
   * to 'EBAY_FR' only for call sites that don't pass one (getOrders,
   * getListings, updateOrderStatus, etc. — unchanged, out of this phase's
   * scope). createListing/updateListing now always pass the real target
   * marketplace explicitly, so the header eBay actually uses to route the
   * request can never silently diverge from the marketplaceId sent in the
   * request body itself (previously always 'EBAY_FR' regardless of intent
   * — see createListing's own comment).
   */
  private async callEbayApi(
    method: string,
    endpoint: string,
    token: string,
    body?: Record<string, any>,
    marketplaceId: string = 'EBAY_FR'
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
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
          message: error.message || `eBay API error: ${response.statusText}`,
          error: error,
        }
      }

      // Some DELETE operations return no content
      const text = await response.text()
      return text ? JSON.parse(text) : {}
    } catch (error) {
      // Phase 12C-Prep fix: re-throws the raw error as-is, NOT normalized
      // here. Every caller of this private method already wraps it in its
      // own try/catch that calls ErrorNormalizer.normalize(error, 'ebay')
      // — normalizing here too meant that object got normalized TWICE
      // (once here, once again by the caller), and the second pass loses
      // markers the first pass didn't preserve (e.g. `error.code` for a
      // network failure is not carried onto a NormalizedError), so a real
      // ETIMEDOUT/ECONNREFUSED could get miscategorized as a generic 5xx
      // SERVER_ERROR instead of NETWORK_ERROR by the time it reached the
      // caller. Normalizing exactly once, at the outer catch, fixes this.
      throw error
    }
  }
}

export default EbayAdapter
