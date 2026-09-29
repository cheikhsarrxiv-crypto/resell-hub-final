/**
 * ExactMarketplaceFeeProvider — extension point for a REAL, per-workspace,
 * per-transaction marketplace fee lookup (Étape/Phase 7). Deliberately an
 * interface only in this phase — no implementation is registered anywhere
 * in production code (see MarketplaceFeeProvider.resolveFee, which is
 * always called with an empty provider list by PricingService today).
 *
 * WHY THIS IS NOT IMPLEMENTED YET (Phase 7 audit, official sources only):
 *
 * eBay: the only official API that returns an actual computed fee amount
 * before a sale is Sell Inventory's `getListingFees`
 * (POST /sell/inventory/v1/offer/get_listing_fees, scope `sell.inventory`).
 * It requires one or more REAL `offerId`s of unpublished offers already
 * created in the seller's own eBay inventory — "this call is only
 * applicable for offers in the unpublished state" (eBay's own docs). There
 * is no simulate/dry-run mode with arbitrary parameters. Implementing this
 * for real would mean: creating a real (even if unpublished) Inventory
 * Item + Offer on the seller's connected eBay account via their SELLER
 * OAuth token (sell.inventory scope) — the same MarketplaceConnection/
 * TokenManager subsystem this engagement has repeatedly kept off-limits
 * for the Agent IA work. Post-sale, `getTransactions`/`getTransactionSummary`
 * (Sell Finances API, scope `sell.finances`) return the fee actually
 * charged — confirmed via eBay's own documented restriction: "The
 * Finances API does not support Team Access. Financial information...
 * is only returned for the user that makes the call" — i.e. inherently
 * scoped to whichever seller's OAuth token makes the call, never another
 * seller's data. Also confirmed: Finances API calls additionally require
 * Digital Signatures for EU/UK sellers (a real implementation complexity
 * to plan for later, not modeled here).
 *
 * Etsy: no official Etsy Open API v3 endpoint returns a computed fee
 * before a sale. `Shop Payment Account Ledger Entries` (scope
 * `transactions_r`) reports fees actually applied AFTER a sale, for
 * reconciliation — never a pre-sale estimate. An "exact" Etsy fee before
 * a sale is not obtainable from any official source; Etsy fees can only
 * ever be 'estimated' (a manually-configured percentage sourced from
 * Etsy's own public fee page) or 'unknown' in this system.
 *
 * A real implementation of this interface (e.g. EbayExactMarketplaceFeeProvider)
 * is future work, gated on: (1) explicit authorization to touch seller
 * OAuth / MarketplaceConnection for this purpose, and (2) a design for
 * safely creating/reusing an unpublished eBay offer purely for fee
 * estimation without side effects visible to the seller.
 */

export interface ExactFeeQuery {
  /** Session-derived, trusted workspace — never accepted from model/user input (see AgentToolDefinition.handler's own contract). */
  workspaceId: string;
  /** Free string, e.g. 'ebay', 'EBAY_GB', 'etsy' — normalized the same way MarketplaceFeeProvider.getFeeStructure does. */
  marketplace: string;
  /** The resale amount this fee would apply to, already in resaleCurrency. */
  resaleAmount: number;
  resaleCurrency: string;
}

export interface ExactFeeResult {
  amount: number;
  currency: string;
  /** Real provenance — e.g. 'ebay_get_listing_fees', never a guess. */
  source: string;
  /** Date/time this exact figure was computed, if the provider reports one. */
  asOf?: string;
}

export interface ExactMarketplaceFeeProvider {
  readonly name: string;
  /** Normalized marketplace key this provider answers for, e.g. 'ebay'. */
  readonly marketplace: string;
  /**
   * True only if THIS workspace has a usable, connected seller integration
   * for this provider's marketplace (e.g. a live MarketplaceConnection
   * with a valid OAuth token) — never a global on/off switch. A provider
   * that returns false here is skipped entirely for that workspace,
   * exactly as if it did not exist.
   */
  isConfigured(workspaceId: string): boolean;
  /** Returns null (never throws) when no exact figure could be obtained — MarketplaceFeeProvider then falls through to the next tier. */
  getExactFee(query: ExactFeeQuery): Promise<ExactFeeResult | null>;
}
