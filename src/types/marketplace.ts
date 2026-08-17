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

export interface IMarketplaceAdapter {
  marketplace: Marketplace;
  
  // Authentication
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
  
  // Listing operations
  getListings(limit?: number, offset?: number): Promise<MarketplaceListing[]>;
  getListing(listingId: string): Promise<MarketplaceListing>;
  createListing(listing: MarketplaceListingInput): Promise<MarketplaceListing>;
  updateListing(listingId: string, listing: Partial<MarketplaceListingInput>): Promise<MarketplaceListing>;
  deleteListing(listingId: string): Promise<void>;
  
  // Order operations
  getOrders(limit?: number, offset?: number): Promise<MarketplaceOrder[]>;
  getOrder(orderId: string): Promise<MarketplaceOrder>;
  updateOrderStatus(orderId: string, status: string): Promise<void>;
  
  // Inventory operations
  updateInventory(listingId: string, quantity: number): Promise<void>;
  
  // Webhook operations
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
  
  // Health check
  validateConnection(): Promise<boolean>;
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

