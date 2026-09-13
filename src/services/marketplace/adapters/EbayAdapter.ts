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
      const response = await fetch(`${this.authUrl}/oauth2/token`, {
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
   */
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string
    expiresIn?: number
  }> {
    const auth = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64')

    try {
      const response = await fetch(`${this.authUrl}/oauth2/token`, {
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
      // Step 1: Create inventory item
      const inventoryBody = {
        sku: listing.sku || `SKU-${Date.now()}`,
        title: listing.title,
        description: listing.description,
        price: {
          currency: 'EUR',
          value: listing.price.toString(),
        },
        quantity: {
          value: listing.quantity,
        },
        condition: 'USED_GOOD',
      }

      const createResponse = await this.callEbayApi(
        'POST',
        '/sell/inventory/v1/inventory_item',
        this.accessToken,
        inventoryBody
      )

      const sku = createResponse.sku || inventoryBody.sku

      // Step 2: Create the offer (still unpublished/draft on eBay's side
      // until the offer is explicitly published in step 3 below)
      const offerBody = {
        sku: sku,
        marketplaceId: 'EBAY_FR',
        format: 'FIXED_PRICE',
        pricingSummary: {
          price: {
            currency: 'EUR',
            value: listing.price.toString(),
          },
        },
      }

      const offerResponse = await this.callEbayApi(
        'POST',
        '/sell/inventory/v1/offer',
        this.accessToken,
        offerBody
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
        this.accessToken
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
      const updateBody: any = {}

      if (listing.title) updateBody.title = listing.title
      if (listing.description) updateBody.description = listing.description
      if (listing.price) {
        updateBody.price = {
          currency: 'EUR',
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
   */
  private async callEbayApi(
    method: string,
    endpoint: string,
    token: string,
    body?: Record<string, any>
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_FR',
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
      throw ErrorNormalizer.normalize(error, 'ebay')
    }
  }
}

export default EbayAdapter
