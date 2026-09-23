/**
 * VintedAdapter
 * STATUS: BLOCKED — a real official API exists, but access is
 * allowlist-only (no self-service registration).
 *
 * Audit findings (updated — the previous "no official public API, legal
 * risk HIGH" comment on this file was outdated):
 *
 * CONFIRMED REAL: "Vinted Pro Integrations" is a real, officially
 * documented API (Items API for inventory sync, an Ontologies mapping
 * endpoint, a Webhooks API for change notifications, and an Orders API
 * that includes shipment labels).
 *
 * BLOCKED — not a technical or legal limitation, an access one:
 * - Vinted Pro Integrations is available only to a limited, specifically
 *   allowlisted set of Vinted Pro business accounts — there is no public
 *   developer portal, no self-service API key/OAuth registration.
 * - Without being allowlisted, there is no client_id, no way to obtain
 *   the exact OAuth endpoints, and no confirmed request/response payload
 *   schemas to implement against safely.
 *
 * DECISION: exactly like DepopAdapter.ts — rather than guess at endpoints
 * or payload shapes we cannot confirm, or fall back to scraping/reverse
 * engineering (which this project will not do, regardless of API
 * availability), this adapter stays a documented placeholder until
 * Vinted grants Pro Integrations access.
 *
 * NEXT STEP: apply for Vinted Pro Integrations access; once granted,
 * implement this adapter for real following the same pattern as
 * EbayAdapter.ts / EtsyAdapter.ts. At that point, this marketplace also
 * needs to be added to SUPPORTED_MARKETPLACES in
 * src/app/api/marketplace/{connect,callback,disconnect}/[marketplace]/route.ts
 * and to AdapterFactory.getMarketplaceAdapterConfig() — both
 * deliberately exclude Vinted today (see that file's own comment) so the
 * app never exposes a "Connect Vinted" action that would just throw.
 *
 * RE-VERIFIED (no partner access obtained, no change from the above):
 * same finding confirmed again via a fresh search of Vinted Pro
 * Integrations' public docs — still allowlist-only, no self-service
 * application process documented.
 */

import MarketplaceAdapter from "@/services/marketplace/MarketplaceAdapter"
import { Marketplace, MarketplaceAdapterConfig } from "@/types/marketplace"

export class VintedAdapter extends MarketplaceAdapter {
  marketplace = Marketplace.VINTED

  constructor(config: MarketplaceAdapterConfig) {
    super(config)
  }

  private throwNotSupported(): never {
    throw new Error(
      `VintedAdapter: BLOCKED - requires allowlisted Vinted Pro Integrations access

      Vinted does have a real official API ("Vinted Pro Integrations" —
      items/inventory, orders with shipment labels, webhooks), but it is
      only available to a limited, specifically allowlisted set of Vinted
      Pro business accounts. There is no public self-service developer
      portal or OAuth registration.

      This adapter will not scrape or reverse-engineer Vinted regardless
      of API availability. Next step: apply for Vinted Pro Integrations
      access, then implement this adapter for real.
      `
    )
  }

  getOAuthUrl(state: string, scopes: string[]): string {
    return this.throwNotSupported()
  }

  async exchangeAuthCode(code: string): Promise<any> {
    return this.throwNotSupported()
  }

  async refreshToken(refreshToken: string): Promise<any> {
    return this.throwNotSupported()
  }

  async getListings(limit?: number, offset?: number): Promise<any[]> {
    return this.throwNotSupported()
  }

  async getListing(listingId: string): Promise<any> {
    return this.throwNotSupported()
  }

  async createListing(listing: any): Promise<any> {
    return this.throwNotSupported()
  }

  async updateListing(listingId: string, listing: any): Promise<any> {
    return this.throwNotSupported()
  }

  async deleteListing(listingId: string): Promise<void> {
    return this.throwNotSupported()
  }

  async getOrders(limit?: number, offset?: number): Promise<any[]> {
    return this.throwNotSupported()
  }

  async getOrder(orderId: string): Promise<any> {
    return this.throwNotSupported()
  }

  async updateOrderStatus(orderId: string, status: string): Promise<void> {
    return this.throwNotSupported()
  }

  async updateInventory(listingId: string, quantity: number): Promise<void> {
    return this.throwNotSupported()
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    return this.throwNotSupported()
  }

  async validateConnection(): Promise<boolean> {
    return this.throwNotSupported()
  }
}

export default VintedAdapter
