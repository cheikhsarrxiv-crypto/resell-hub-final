import { SourcingProvider } from './types';
import { EbayBrowseSourcingProvider } from './providers/EbayBrowseSourcingProvider';
import { EtsySourcingProvider } from './providers/EtsySourcingProvider';

/**
 * Phase 2 — an explicit registry, extracted out of what was a private
 * function inside SourcingService.ts (Phase 1's `getAllProviders`).
 * Behavior is unchanged: this is the same list, just named and testable
 * on its own. Adding a provider means adding one entry here — nothing
 * else in SourcingService changes.
 *
 * Deliberately NOT workspace-scoped (no `getAvailableProviders(workspaceId)`
 * as sketched in the Phase 2 brief): every provider here authenticates
 * with a global, operator-configured, application-level credential
 * (EBAY_BUY_API_CLIENT_ID/SECRET, ETSY_CLIENT_ID) — never a workspace's
 * own connected-seller credentials (those live entirely separately, in
 * MarketplaceConnection/TokenManager, and this registry never touches
 * them). Since which providers exist and whether they're configured is
 * identical for every workspace, a workspaceId parameter here would
 * accept a value it could never actually use — an invented distinction,
 * not a real one. Workspace isolation for sourcing is enforced instead
 * where it actually matters: search_products never receives or uses a
 * workspaceId (see its own tests), and create_product's revalidation
 * checks source identity against a specific workspace's OWN
 * conversation/Product records (see actionTools.ts).
 */
export class SourcingProviderRegistry {
  /** Every provider ADKSY knows about, real or not-yet-configured. */
  static getAllProviders(): SourcingProvider[] {
    return [new EbayBrowseSourcingProvider(), new EtsySourcingProvider()];
  }

  /** Subset of getAllProviders() whose isConfigured() is currently true. */
  static getConfiguredProviders(): SourcingProvider[] {
    return this.getAllProviders().filter((provider) => provider.isConfigured());
  }
}

export default SourcingProviderRegistry;
