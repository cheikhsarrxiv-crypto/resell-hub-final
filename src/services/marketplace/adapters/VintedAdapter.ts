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
import { Marketplace, MarketplaceAdapterConfig, ManualCredentialConnectable, ManualCredentials } from "@/types/marketplace"

/**
 * Multi-marketplace auth architecture (Option B): Vinted Pro Integrations
 * has NO OAuth flow at all (confirmed via official docs during the
 * Depop/Vinted/Vestiaire audit) — a workspace generates an access key +
 * signing key manually in Vinted's own Pro portal, outside ADKSY, and
 * every request must be HMAC-SHA256 signed with the signing key. This
 * class therefore implements ManualCredentialConnectable instead of
 * OAuthConnectable, and getOAuthUrl()/exchangeAuthCode()/refreshToken()
 * are deliberately NOT implemented here — they no longer exist on the
 * base MarketplaceAdapter's required contract, so this adapter is never
 * forced to fake them.
 */
export class VintedAdapter extends MarketplaceAdapter implements ManualCredentialConnectable {
  marketplace = Marketplace.VINTED

  // Stored only in memory, on this instance — never logged, never
  // persisted here (persistence/encryption is MarketplaceConnectionService's
  // job, via TokenManager, exactly like an OAuth adapter's access token
  // is never persisted by the adapter itself either).
  private credentials: { accessKey: string; signingKey: string } | null = null

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

  /**
   * Stores the workspace-provided access key + signing key on this
   * instance, for this adapter's own later use when signing a real
   * request (once implemented). Makes no network call — never confuses
   * "credentials look structurally present" with "credentials are
   * genuinely valid against Vinted", which only a real API call
   * (validateConnection, once implemented) could ever confirm.
   */
  setManualCredentials(credentials: ManualCredentials): void {
    const { accessKey, signingKey } = credentials
    if (!accessKey || !signingKey) {
      throw new Error('VintedAdapter: setManualCredentials requires both a non-empty accessKey and signingKey')
    }
    this.credentials = { accessKey, signingKey }
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
    // A distinct, more useful error for a real programming mistake
    // (calling validateConnection before setManualCredentials) — never
    // masked behind the generic "BLOCKED" message below, which is
    // reserved for the real, current limitation (no Vinted partner
    // access), not for a caller bug.
    if (!this.credentials) {
      throw new Error('VintedAdapter: setManualCredentials must be called before validateConnection()')
    }
    return this.throwNotSupported()
  }
}

export default VintedAdapter
