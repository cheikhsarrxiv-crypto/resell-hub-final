/**
 * MarketplaceAdapter
 * Abstract interface that all marketplace implementations must fulfill
 * 
 * STATUS: REAL (Abstract interface - no implementation)
 */

import {
  Marketplace,
  IMarketplaceAdapter,
  MarketplaceAdapterConfig,
  MarketplaceListing,
  MarketplaceListingInput,
  MarketplaceOrder,
  WebhookPayload,
} from "@/types/marketplace"

/**
 * Abstract base class for all marketplace adapters
 * 
 * ✅ REAL: Interface definition
 * ❌ NO IMPLEMENTATION: Subclasses must implement
 * ❌ NO API CALLS: This is abstract only
 * ✅ SECURITY: All token operations delegated to TokenManager
 */
export abstract class MarketplaceAdapter implements IMarketplaceAdapter {
  abstract marketplace: Marketplace
  protected config: MarketplaceAdapterConfig

  constructor(config: MarketplaceAdapterConfig) {
    this.config = config
  }

  /**
   * Get OAuth authorization URL
   * 
   * STATUS: ABSTRACT - Subclass must implement
   */
  abstract getOAuthUrl(state: string, scopes: string[]): string

  /**
   * Exchange authorization code for tokens
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * SECURITY:
   * - Never called directly; routed through TokenManager
   * - Tokens returned immediately encrypted
   * - Never stored in adapter instance
   */
  abstract exchangeAuthCode(code: string): Promise<{
    accessToken: string
    refreshToken?: string
    expiresIn?: number
  }>

  /**
   * Refresh expired access token
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * SECURITY:
   * - Only TokenManager calls this
   * - Refresh token is passed in encrypted
   * - New token is returned for re-encryption
   */
  abstract refreshToken(refreshToken: string): Promise<{
    accessToken: string
    expiresIn?: number
  }>

  /**
   * Get all active listings for connected seller
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * REAL USAGE:
   * - Called by: ListingService.importListingsFromMarketplace()
   * - Returns paginated results (limit, offset)
   * - Each listing includes marketplace ID, status, price, quantity
   * 
   * ERROR HANDLING:
   * - Errors normalized by ErrorNormalizer before returning to caller
   * - 401 (token expired) triggers automatic re-auth
   * - 429 (rate limited) backed off by RateLimitManager
   */
  abstract getListings(
    limit?: number,
    offset?: number
  ): Promise<MarketplaceListing[]>

  /**
   * Get single listing by ID
   * 
   * STATUS: ABSTRACT - Subclass must implement
   */
  abstract getListing(listingId: string): Promise<MarketplaceListing>

  /**
   * Create new listing on marketplace
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * REAL USAGE:
   * - Called by: ListingService.publishToMarketplace()
   * - Input validation done before calling adapter
   * - Adapter validates against marketplace-specific rules
   * 
   * ERROR HANDLING:
   * - Invalid category → VALIDATION_ERROR
   * - Restricted item → VALIDATION_ERROR
   * - Rate limit → RATE_LIMIT_EXCEEDED (queued for retry)
   */
  abstract createListing(
    listing: MarketplaceListingInput
  ): Promise<MarketplaceListing>

  /**
   * Update existing listing
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * REAL USAGE:
   * - Called by: ListingService.updateMarketplaceListing()
   * - Used for price, quantity, description changes
   * 
   * NOTE: Not all marketplaces support all updates
   * Example: eBay price can't be changed if item sold
   * Error handling lets caller know what failed
   */
  abstract updateListing(
    listingId: string,
    listing: Partial<MarketplaceListingInput>
  ): Promise<MarketplaceListing>

  /**
   * Delete/delist a listing
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * NOTE: Some marketplaces call this "ending" not "deleting"
   */
  abstract deleteListing(listingId: string): Promise<void>

  /**
   * Get all orders for connected seller
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * REAL USAGE:
   * - Called by: OrderService.syncMarketplaceOrders()
   * - Polled periodically (not webhook-dependent)
   * - Returns new and updated orders
   * 
   * NOTE: Some platforms use webhooks (eBay), some polling (Etsy)
   * Architecture supports both
   */
  abstract getOrders(
    limit?: number,
    offset?: number
  ): Promise<MarketplaceOrder[]>

  /**
   * Get single order by ID
   * 
   * STATUS: ABSTRACT - Subclass must implement
   */
  abstract getOrder(orderId: string): Promise<MarketplaceOrder>

  /**
   * Update order status (e.g., shipped)
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * NOTE: Not all status changes are allowed on all platforms
   * Error handling lets caller know what's possible
   */
  abstract updateOrderStatus(orderId: string, status: string): Promise<void>

  /**
   * Update inventory/quantity for listing
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * REAL USAGE:
   * - Called by: InventoryService.syncToMarketplace()
   * - Triggered when ResellHub inventory changes
   * - Respects rate limits (queued if necessary)
   * 
   * IDEMPOTENCY:
   * - Setting quantity to 0 twice = same result
   * - Setting quantity to 5 twice = same result
   */
  abstract updateInventory(
    listingId: string,
    quantity: number
  ): Promise<void>

  /**
   * Verify webhook signature
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * REAL USAGE:
   * - Called by: WebhookManager.handleWebhook()
   * - Verifies HMAC-SHA256 signature
   * - Prevents fake webhooks
   * 
   * SECURITY:
   * - HMAC comparison must be timing-safe
   * - Secret must match marketplace's configured secret
   */
  abstract verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean

  /**
   * Validate that connection is still valid
   * 
   * STATUS: ABSTRACT - Subclass must implement
   * 
   * REAL USAGE:
   * - Called by: ConnectionHealthCheck service
   * - Quick API call to verify authentication
   * - Used to detect token expiry or account issues
   * 
   * EXAMPLE:
   * - eBay: GET /sell/inventory (lightweight)
   * - Etsy: GET /users/me (lightweight)
   */
  abstract validateConnection(): Promise<boolean>
}

export default MarketplaceAdapter

