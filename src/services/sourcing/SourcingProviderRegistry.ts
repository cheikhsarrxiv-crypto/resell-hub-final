import { KnownUnavailableSource, SourcingProvider } from './types';
import { EbayBrowseSourcingProvider } from './providers/EbayBrowseSourcingProvider';
import { EtsySourcingProvider } from './providers/EtsySourcingProvider';

/**
 * Phase 5 — sources this project's own research (this session) confirmed
 * ADKSY has NO legitimate marketplace-search access to, sourced from each
 * platform's own official developer documentation/announcements where
 * one exists (never a blog post or an unofficial scraper as proof of
 * access — see this phase's own report for the exact search queries and
 * sources). NOT SourcingProvider objects — no code here calls any real or
 * fake endpoint; this is pure, honest documentation data so the UI/Agent
 * can explain a real limitation instead of staying silent about it. Never
 * add an entry here without a real, specific, sourced reason — "probably
 * not available" is not good enough.
 */
const KNOWN_UNAVAILABLE_SOURCES: KnownUnavailableSource[] = [
  {
    name: 'Mercari Japan',
    status: 'SELL_SIDE_ONLY',
    reason:
      'Mercari has no public marketplace-search API. The only official, documented API (Mercari Shops API, api.mercari-shops.com) lets a shop OWNER manage their own inventory — it cannot search other sellers\' listings. A separate Partner API exists but is restricted to approved logistics/payment partners under direct agreement, not marketplace search.',
  },
  {
    name: 'Rakuma',
    status: 'NO_CONFIRMED_ACCESS',
    reason:
      'No official Rakuma (フリマアプリ ラクマ, Rakuten\'s C2C flea-market app) developer API was found — not even a sell-side one. "Rakuten Web Service"/developers.rakuten.com covers Rakuten Ichiba (the B2C shopping mall), a structurally different product from Rakuma\'s own peer-to-peer flea market; no equivalent public API for Rakuma itself is documented.',
  },
  {
    name: 'Yahoo Auctions Japan',
    status: 'NO_CONFIRMED_ACCESS',
    reason:
      'Yahoo! JAPAN officially discontinued its public Auction Web API (confirmed via developer.yahoo.co.jp\'s own changelog: "オークションWeb API提供終了" notice dated 2019-10-10, effective January 2020, following an earlier 2018 shutdown of the ratings/evaluation endpoint). No public search API has existed since.',
  },
  {
    name: '2nd STREET',
    status: 'NO_CONFIRMED_ACCESS',
    reason: 'No official developer API or documented product feed was found. Only generic CPA affiliate ad-network placements (ValueCommerce, LinkShare) exist — click-tracked referral links, not a structured, searchable product feed.',
  },
  {
    name: 'KOMEHYO',
    status: 'NO_CONFIRMED_ACCESS',
    reason: 'No official developer API or documented product feed was found. Only a generic CPA affiliate ad-network placement (AccessTrade) exists — a click-tracked referral link, not a structured, searchable product feed.',
  },
  {
    name: 'RAGTAG',
    status: 'NO_CONFIRMED_ACCESS',
    reason: 'No official developer API, affiliate feed, or partner program was found in this platform\'s own public materials.',
  },
  {
    name: 'Grailed',
    status: 'NO_CONFIRMED_ACCESS',
    reason: 'Grailed does not publish a public developer API at all (confirmed: no documented endpoints, no self-service registration) — only unofficial third-party scrapers exist, which this project will never use.',
  },
  {
    name: 'Vestiaire Collective',
    status: 'SELL_SIDE_ONLY',
    reason:
      'The official, documented API (seller-api-docs.vestiairecollective.com) is explicitly a Seller API — it lets a connected seller list and manage their OWN inventory. No marketplace-wide search/browse endpoint is documented.',
  },
  {
    name: 'Depop',
    status: 'PARTNER_REQUIRED',
    reason:
      'A real Selling API exists (api.depop.com/api/v3, seller inventory/order management) but Depop\'s own docs require contacting them directly for API keys/OAuth — no self-service developer portal. Even with access, this API only manages a connected seller\'s own inventory, not marketplace-wide search — see DepopAdapter.ts\'s own audit for the full finding.',
  },
  {
    name: 'Vinted',
    status: 'PARTNER_REQUIRED',
    reason:
      '"Vinted Pro Integrations" is a real, documented API (items/orders/webhooks) but is allowlist-only for specific Vinted Pro business accounts — no public developer portal. Even with access, it manages a connected seller\'s own inventory, not marketplace-wide search — see VintedAdapter.ts\'s own audit for the full finding.',
  },
];

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

  /**
   * Phase 5 — real, sourced sources ADKSY has NO SourcingProvider for at
   * all (never confused with providersUnavailable, which is reserved for
   * a REAL provider object that merely isn't configured). Pure metadata:
   * calling this never makes a network request, never returns a
   * fabricated result. See KNOWN_UNAVAILABLE_SOURCES's own comment for
   * exactly how each entry was verified.
   */
  static getKnownUnavailableSources(): KnownUnavailableSource[] {
    return KNOWN_UNAVAILABLE_SOURCES;
  }
}

export default SourcingProviderRegistry;
