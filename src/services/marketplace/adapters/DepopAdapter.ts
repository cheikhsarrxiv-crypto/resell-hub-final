/**
 * DepopAdapter
 * STATUS: BLOCKED — real API exists, but access requires manual Depop
 * partner approval (no self-service registration).
 *
 * Audit findings (verified against https://partnerapi.depop.com/api-docs/,
 * checked again during this session — the previous "no official API"
 * comment on this file was outdated):
 *
 * CONFIRMED REAL (via official Depop Selling API docs):
 * - A real Selling API exists at https://api.depop.com/api/v3/
 * - Inventory management: create/update/delete products
 * - Order management: retrieve and manage orders
 * - Webhooks available for real-time updates
 * - Two auth models: API Keys (single-shop partners) or OAuth 2.0
 *   (third-party multi-seller apps — ADKSY's case), with real scopes
 *   `products_read` / `products_write`
 * - Requests use a Bearer token in the Authorization header
 *
 * BLOCKED — not a technical limitation, an access one:
 * - Depop's own docs state explicitly: "API Keys and OAuth 2.0 can't be
 *   configured by you directly, instead you will need to contact us
 *   first" (contact required, no public self-service dev portal like
 *   Etsy's — this is a materially harder gate than Etsy).
 * - Without an approved partnership, there is no client_id, no API key,
 *   and the exact OAuth authorize/token endpoint URLs and listing
 *   creation payload schema are not published in the public docs
 *   reachable without partner access.
 *
 * DECISION: rather than guess at endpoint URLs or payload shapes we
 * cannot confirm with certainty (which would risk shipping fabricated
 * "real-looking" code), this adapter stays a documented placeholder
 * until Depop partner access is obtained. See EtsyAdapter.ts for
 * comparison: that one could be fully implemented for real because its
 * exact request/response formats are publicly documented with concrete,
 * cross-verified examples — Depop's are not, without partner access.
 *
 * NEXT STEP: contact Depop partnerships to request Selling API access
 * (email contact required per their docs). Once granted, the real
 * OAuth endpoints and payload schemas will be available and this
 * adapter can be implemented following the same pattern as
 * EbayAdapter.ts / EtsyAdapter.ts.
 */

import MarketplaceAdapter from "@/services/marketplace/MarketplaceAdapter"
import { Marketplace, MarketplaceAdapterConfig } from "@/types/marketplace"

export class DepopAdapter extends MarketplaceAdapter {
  marketplace = Marketplace.DEPOP

  constructor(config: MarketplaceAdapterConfig) {
    super(config)
  }

  getOAuthUrl(state: string, scopes: string[]): string {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access (contact Depop directly; no self-service OAuth registration exists)")
  }

  async exchangeAuthCode(code: string): Promise<any> {
    throw new Error("DepopAdapter: BLOCKED - OAuth token endpoint not publicly documented without partner access")
  }

  async refreshToken(refreshToken: string): Promise<any> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }

  async getListings(limit?: number, offset?: number): Promise<any[]> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }

  async getListing(listingId: string): Promise<any> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }

  async createListing(listing: any): Promise<any> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }

  async updateListing(listingId: string, listing: any): Promise<any> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }

  async deleteListing(listingId: string): Promise<void> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }

  async getOrders(limit?: number, offset?: number): Promise<any[]> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }

  async getOrder(orderId: string): Promise<any> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }

  async updateOrderStatus(orderId: string, status: string): Promise<void> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }

  async updateInventory(listingId: string, quantity: number): Promise<void> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    throw new Error("DepopAdapter: BLOCKED - webhook signing scheme not publicly documented without partner access")
  }

  async validateConnection(): Promise<boolean> {
    throw new Error("DepopAdapter: BLOCKED - requires approved Depop partner access")
  }
}

export default DepopAdapter
