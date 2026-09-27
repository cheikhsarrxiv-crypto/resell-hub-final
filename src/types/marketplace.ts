/**
 * Marketplace Types & Interfaces
 * Core types for marketplace integration architecture
 */

// ============================================================================
// MARKETPLACE ENUMS
// ============================================================================

export enum Marketplace {
  EBAY = "ebay",
  ETSY = "etsy",
  DEPOP = "depop",
  VINTED = "vinted",
}

/**
 * Multi-marketplace auth architecture (Option B — typed auth strategies).
 * The real authentication model for each marketplace, verified against
 * official sources during the Depop/Vinted/Vestiaire audit — never
 * guessed:
 * - 'oauth': a real OAuth 2.0 authorization flow (eBay: standard;
 *   Etsy/Depop: OAuth 2.0 + PKCE). These marketplaces' adapters implement
 *   OAuthConnectable.
 * - 'manual_credentials': no OAuth flow exists at all — Vinted Pro
 *   Integrations requires the workspace to generate an access key +
 *   signing key manually in Vinted's own Pro portal (outside ADKSY) and
 *   enter them directly; every request is then HMAC-SHA256 signed with
 *   the signing key. These marketplaces' adapters implement
 *   ManualCredentialConnectable instead of OAuthConnectable.
 * Vestiaire Collective is deliberately absent from both this enum and
 * this map — its real authentication model was NOT confirmed in the
 * prior audit (docs unreachable), so no entry is guessed here.
 */
export type MarketplaceAuthType = 'oauth' | 'manual_credentials';

export const MARKETPLACE_AUTH_TYPE: Readonly<Record<Marketplace, MarketplaceAuthType>> = {
  [Marketplace.EBAY]: 'oauth',
  [Marketplace.ETSY]: 'oauth',
  [Marketplace.DEPOP]: 'oauth',
  [Marketplace.VINTED]: 'manual_credentials',
};

/** Pure lookup, no adapter instantiation — the authoritative source of truth for which connection path a marketplace uses. */
export function getMarketplaceAuthType(marketplace: Marketplace): MarketplaceAuthType {
  return MARKETPLACE_AUTH_TYPE[marketplace];
}

export enum MarketplaceConnectionStatus {
  CONNECTED = "connected",
  EXPIRED = "expired",
  EXPIRING_SOON = "expiring_soon",
  ERROR = "error",
  DISCONNECTED = "disconnected",
}

export enum SyncType {
  LISTING = "listing",
  ORDER = "order",
  INVENTORY = "inventory",
  STATUS = "status",
}

export enum ErrorType {
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  AUTH_EXPIRED = "AUTH_EXPIRED",
  AUTH_INVALID = "AUTH_INVALID",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_FOUND = "NOT_FOUND",
  NETWORK_ERROR = "NETWORK_ERROR",
  SERVER_ERROR = "SERVER_ERROR",
  UNKNOWN = "UNKNOWN",
}

// ============================================================================
// MARKETPLACE CONNECTION INTERFACE
// ============================================================================

export interface IMarketplaceConnection {
  id: string;
  workspaceId: string;
  marketplace: Marketplace;
  status: MarketplaceConnectionStatus;
  
  // OAuth tokens (encrypted in database)
  encryptedOauthToken: string;
  encryptedRefreshToken?: string;
  tokenExpiresAt?: Date;
  
  // Connection metadata
  sellerName?: string;
  sellerId?: string;
  accountEmail?: string;
  
  // Sync tracking
  lastSyncAt?: Date;
  lastSyncError?: string;
  
  // Status
  lastApiCallAt?: Date;
  consecutiveErrors: number;
  
  // Timestamps
  connectedAt: Date;
  updatedAt: Date;
}

// ============================================================================
// MARKETPLACE ADAPTER INTERFACE
// ============================================================================

export interface MarketplaceAdapterConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sandboxMode?: boolean;
}

/**
 * Base contract every marketplace adapter implements, regardless of how
 * it authenticates. Authentication-specific capabilities (getOAuthUrl/
 * exchangeAuthCode/refreshToken for OAuth marketplaces, setManualCredentials
 * for HMAC/API-key ones) were removed from this interface — see
 * OAuthConnectable / ManualCredentialConnectable below. This is Option B
 * of the multi-marketplace auth architecture audit: a marketplace whose
 * real authentication model isn't OAuth (Vinted Pro Integrations: an
 * access key + signing key generated manually in Vinted's own portal,
 * with every request HMAC-signed — confirmed via official docs research,
 * never guessed) must never be forced to implement OAuth methods that
 * have no real meaning for it.
 */
export interface IMarketplaceAdapter {
  marketplace: Marketplace;

  // Listing operations
  getListings(limit?: number, offset?: number): Promise<MarketplaceListing[]>;
  getListing(listingId: string): Promise<MarketplaceListing>;
  createListing(listing: MarketplaceListingInput): Promise<MarketplaceListing>;
  updateListing(listingId: string, listing: Partial<MarketplaceListingInput>): Promise<MarketplaceListing>;
  deleteListing(listingId: string): Promise<void>;
  
  // Order operations
  getOrders(limit?: number, offset?: number): Promise<MarketplaceOrder[]>;
  getOrder(orderId: string): Promise<MarketplaceOrder>;
  // trackingInfo is optional and marketplace-specific: eBay's current
  // updateOrderStatus doesn't use it, but Etsy's real createReceiptShipment
  // endpoint requires both fields to mark an order shipped (see
  // EtsyAdapter.updateOrderStatus) — never send it with empty/missing values.
  updateOrderStatus(orderId: string, status: string, trackingInfo?: MarketplaceOrderTrackingInfo): Promise<void>;
  
  // Inventory operations
  updateInventory(listingId: string, quantity: number): Promise<void>;
  
  // Webhook operations
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
  
  // Health check
  validateConnection(): Promise<boolean>;
}

/**
 * Implemented by adapters whose marketplace uses a real OAuth 2.0
 * authorization flow — eBay (standard), Etsy and Depop (OAuth 2.0 +
 * PKCE). Identical in shape to the 3 methods previously declared
 * directly on IMarketplaceAdapter — EbayAdapter/EtsyAdapter's existing
 * method bodies are unchanged by this split, only their class's
 * `implements` clause changes.
 */
export interface OAuthConnectable {
  getOAuthUrl(state: string, scopes: string[]): string;
  exchangeAuthCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
  refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn?: number;
  }>;
}

/**
 * A marketplace-specific set of manually-entered credential values —
 * plain string keys, deliberately not a fixed {accessKey, signingKey}
 * shape at this interface level, so a future manual-credential
 * marketplace with different field names is never forced into Vinted's
 * own vocabulary. The concrete adapter (VintedAdapter) is the only place
 * that knows which keys it actually needs and validates their presence.
 */
export type ManualCredentials = Record<string, string>;

/**
 * Implemented by adapters whose marketplace has NO OAuth authorization
 * flow at all — today: Vinted Pro Integrations. The workspace generates
 * its credentials manually, outside ADKSY (Vinted's own Pro portal), and
 * enters them directly; there is no authUrl to redirect to and no `code`
 * to exchange. setManualCredentials() only stores the values on the
 * adapter instance for its own subsequent use (e.g. computing an
 * HMAC-SHA256 signature per request) — it never makes a network call
 * itself; validateConnection() (already part of IMarketplaceAdapter,
 * required for every adapter) is what actually confirms the credentials
 * work, once a real API implementation exists.
 */
export interface ManualCredentialConnectable {
  setManualCredentials(credentials: ManualCredentials): void;
}

/**
 * Real TypeScript type predicates (never `any`) for narrowing a plain
 * IMarketplaceAdapter to its actual auth capability at runtime — used by
 * MarketplaceConnectionService before calling an auth-specific method,
 * so calling the wrong one on an adapter that doesn't implement it fails
 * with a clear, specific error instead of "is not a function".
 */
export function isOAuthConnectable(adapter: IMarketplaceAdapter): adapter is IMarketplaceAdapter & OAuthConnectable {
  const candidate = adapter as unknown as OAuthConnectable;
  return (
    typeof candidate.getOAuthUrl === 'function' &&
    typeof candidate.exchangeAuthCode === 'function' &&
    typeof candidate.refreshToken === 'function'
  );
}

export function isManualCredentialConnectable(
  adapter: IMarketplaceAdapter
): adapter is IMarketplaceAdapter & ManualCredentialConnectable {
  return typeof (adapter as unknown as ManualCredentialConnectable).setManualCredentials === 'function';
}

// ============================================================================
// MARKETPLACE DATA MODELS
// ============================================================================

export interface MarketplaceListing {
  id: string;
  marketplaceId: string;
  title: string;
  description?: string;
  price: number;
  quantity: number;
  status: "active" | "inactive" | "sold" | "ended";
  url?: string;
  imageUrl?: string;
  category?: string;
  sku?: string;
  externalId?: string; // External marketplace ID (e.g., eBay SKU)
  marketplace?: Marketplace;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MarketplaceListingInput {
  title: string;
  description?: string;
  price: number;
  quantity: number;
  category?: string;
  sku?: string;
  images?: string[];
  /**
   * Phase 12C-Prep — ISO 4217. Previously EbayAdapter hardcoded 'EUR'
   * regardless of what was actually passed in; it now requires this field
   * and throws a clear validation error rather than silently assuming
   * EUR. Every adapter that cares about currency should read this, never
   * invent one.
   */
  currency?: string;
  /**
   * Phase 12C-Prep — marketplace-specific condition value (e.g. eBay's
   * 'USED_GOOD'/'NEW'/...). Previously EbayAdapter hardcoded 'USED_GOOD'
   * for every listing; it now requires this field explicitly.
   */
  condition?: string;
  // Etsy-only fields (see EtsyListingMapper.ts). Ignored by every other
  // adapter — eBay/Depop/Vinted never read these.
  etsy?: {
    whoMade: string;
    whenMade: string;
    taxonomyId: number;
  };
  /**
   * Phase 12C-Prep — eBay-only fields, mirroring the `etsy` field above.
   * Ignored by every other adapter. EbayAdapter.createListing requires
   * both: categoryId is eBay's own numeric category id (never invented —
   * must come from real category data), and marketplaceId is the target
   * eBay country marketplace (e.g. 'EBAY_FR', 'EBAY_GB') the offer and
   * the X-EBAY-C-MARKETPLACE-ID header both use — previously hardcoded to
   * 'EBAY_FR' everywhere, which meant a listing could silently publish to
   * the wrong country's marketplace regardless of what was intended.
   */
  ebay?: {
    categoryId: number;
    marketplaceId: string;
  };
}

export interface MarketplaceOrder {
  id: string;
  externalOrderId: string; // External marketplace order ID (e.g., eBay orderId)
  marketplaceId?: string;
  buyerId: string;
  buyerName: string;
  buyerEmail?: string;
  items: MarketplaceOrderItem[];
  totalPrice: number;
  status: string; // Marketplace-specific
  shippingAddress?: Address;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MarketplaceOrderItem {
  listingId: string;
  title: string;
  price: number;
  quantity: number;
  // The SKU the marketplace echoes back on the order line. For eBay this is
  // exactly the SKU ResellHub sent when publishing the listing (see
  // ListingService.createListing -> adapter.createListing({ sku: product.sku })),
  // so it maps 1:1 back to Product.sku (@@unique([workspaceId, sku])) — not
  // to Listing.externalId, which eBay sets to its own listingId instead.
  // Etsy's Transaction object has the same 1:1 mapping via its own
  // top-level `sku` field (see EtsyAdapter.createListing/mapOrder) — but it
  // is nullable there (a listing with no SKU set has transaction.sku ===
  // null), so this stays undefined rather than a placeholder in that case.
  sku?: string;
}

// Real tracking data, in ResellHub's own vocabulary (mirrors
// Shipment.trackingNumber/Shipment.carrier in prisma/schema.prisma) — the
// adapter that needs it (Etsy) translates these into the marketplace's own
// field names (tracking_code/carrier_name) at the API boundary, the same
// way Product.sku is translated into each marketplace's own identifier
// elsewhere. Both fields are required together: a marketplace that needs
// tracking to mark an order shipped needs both, not one or the other.
export interface MarketplaceOrderTrackingInfo {
  trackingNumber: string;
  carrier: string;
}

export interface Address {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  phone?: string;
  email?: string;
}

// ============================================================================
// WEBHOOK MODELS
// ============================================================================

export interface WebhookPayload {
  id: string; // Unique event ID from marketplace
  marketplace: Marketplace;
  timestamp: number;
  type: string; // e.g., "order.created", "listing.sold"
  data: Record<string, unknown>;
  signature?: string; // For verification
}

export interface WebhookLog {
  id: string;
  workspaceId: string;
  marketplace: Marketplace;
  eventId: string; // Marketplace's event ID
  eventType: string;
  payload: WebhookPayload;
  status: "processing" | "processed" | "failed";
  error?: string;
  processedAt?: Date;
  createdAt: Date;
}

// ============================================================================
// SYNC MODELS
// ============================================================================

export interface SyncLog {
  id: string;
  workspaceId: string;
  marketplace: Marketplace;
  syncType: SyncType;
  status: "pending" | "in_progress" | "completed" | "failed";
  itemsProcessed: number;
  itemsFailed: number;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  nextScheduledAt?: Date;
}

// ============================================================================
// ERROR MODELS
// ============================================================================

export interface NormalizedError {
  type: ErrorType;
  message: string;
  statusCode: number;
  retryable: boolean;
  retryAfter?: number; // seconds
  originalError?: unknown;
}

export interface MarketplaceError extends Error {
  statusCode: number;
  marketplaceCode?: string;
  isRetryable: boolean;
  retryAfter?: number;
}

// ============================================================================
// TOKEN MANAGER
// ============================================================================

export interface TokenInfo {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

// ============================================================================
// RATE LIMIT MANAGER
// ============================================================================

export interface RateLimitConfig {
  marketplace: Marketplace;
  requestsPerHour?: number;
  requestsPerMinute?: number;
}

export interface RateLimitState {
  remaining: number;
  resetAt: Date;
  isLimited: boolean;
}

