/**
 * Sourcing abstraction — deliberately independent of eBay or any other
 * specific provider (see AUDIT_SOURCING_REPORT discussed with the user:
 * eBay Browse API is the first real provider, but Etsy/StockX/affiliate
 * feeds must be addable later without touching SourcingService or the
 * search_products tool).
 */

/**
 * What AiAgentService/the search_products tool passes in — a structured
 * shape the model (or, later, a real NLU step) must have already
 * extracted from natural language. No provider ever sees free-form user
 * text; it only ever sees this.
 */
export interface NormalizedSearchQuery {
  /** Free-text keywords (required) — e.g. "Prada sneakers". */
  query: string;
  brand?: string;
  /**
   * Phase 3 — free text, e.g. "Cut" (as in "Prada Cut"). Like `category`,
   * every provider folds this into its own free-text keyword search —
   * neither eBay's Browse API nor Etsy's Open API v3 has a confirmed,
   * separate "model" filter parameter, so this is never sent as a
   * structured filter, only as part of the search string.
   */
  model?: string;
  category?: string;
  /**
   * Phase 3 — free text (e.g. "42", "M"), folded into keywords the same
   * way as `model`. Neither current provider has a confirmed, safe
   * structured size filter (eBay Browse API's item aspect filters were
   * not verified with confidence in this session — see
   * EbayBrowseSourcingProvider's own comment on why `condition:refurbished`
   * is similarly left unmapped rather than guessed).
   */
  size?: string;
  /** Phase 3 — same treatment as `size`: free text, folded into keywords, never a structured filter no provider has confirmed. */
  color?: string;
  minPrice?: number;
  maxPrice?: number;
  /** ISO 4217, applies to minPrice/maxPrice — required by eBay's own price filter whenever a price bound is set. */
  currency?: string;
  condition?: 'new' | 'used' | 'refurbished';
  /**
   * Which provider-specific markets/countries to search. Each provider
   * interprets this in its own terms (for EbayBrowseSourcingProvider,
   * these are eBay marketplace IDs like 'EBAY_FR') — SourcingService
   * passes it through unchanged rather than trying to impose one global
   * country vocabulary providers don't share.
   */
  marketplaces?: string[];
  /**
   * Global Sourcing Engine — "search everywhere ADKSY currently has real,
   * legitimate access to", never "search the entire internet" (see
   * EbayBrowseSourcingProvider's own handling: for eBay this means every
   * marketplace in SUPPORTED_MARKETPLACES, not some universal endpoint
   * that doesn't exist). Each provider decides for itself what
   * "worldwide" honestly means for its own real API surface — this field
   * only carries the caller's intent, never a promise about coverage.
   * When true, a provider MAY ignore `marketplaces` in favor of its own
   * full supported set — see each provider's own searchProducts for
   * exactly how. SourcingService itself never interprets this field; it
   * only passes it through to providers unchanged, same as `marketplaces`.
   */
  worldwide?: boolean;
  /**
   * Phase 2 (real international providers) — an explicit allowlist of
   * provider names (SourcingProvider.name, e.g. ['ebay', 'etsy']) to
   * query. Omitted (the default, unchanged from before this field
   * existed) means every configured provider is queried, exactly as
   * before. When set, a configured provider NOT in this list is recorded
   * in SourcingSearchResponse.providersSkipped rather than queried or
   * silently dropped — the caller always sees why a known, available
   * provider didn't run. Independent of `worldwide`: this chooses WHICH
   * providers run; `worldwide` only tells an already-selected provider
   * how broad ITS OWN internal scope should be (e.g. which eBay
   * marketplaces).
   */
  providers?: string[];
  /**
   * Phase 3 — final ordering of the AGGREGATED, combined result set,
   * applied by SourcingService after dedup/enrichment (never by a
   * provider — providers MUST ignore this, it is not a real search
   * parameter on any provider's API). Deterministic and fully
   * documented, never an opaque "relevance score":
   * - 'price_asc' / 'price_desc': the result's own original `price`
   *   (NOT currency-normalized — mixing currencies this way is honest
   *   about what it is, a raw-number sort, not a real cross-currency
   *   comparison).
   * - 'normalized_price_asc' (the default when omitted, unchanged from
   *   Phase 2's behavior): ascending by `normalizedPriceEur`, results
   *   with no available rate placed last.
   * - 'known_cost_asc': ascending by `estimatedKnownCostEur`, results
   *   with no computable landed cost placed last.
   * - 'match': see OpportunityRankingService.compareByMatch — a fixed,
   *   documented multi-key comparator (constraint matches, then known
   *   landed cost, then authenticity evidence, then price), never a
   *   summed/weighted score.
   */
  sort?: 'price_asc' | 'price_desc' | 'normalized_price_asc' | 'known_cost_asc' | 'match';
  limit?: number;
  offset?: number;
  /**
   * Phase 3 — when set, SourcingService attaches a real, honestly-scoped
   * margin preview (estimatedMargin/estimatedMarginPercent) to every
   * result whose estimatedKnownCostEur is computable, via the SAME
   * PricingService engine calculate_margin already uses (never a second,
   * duplicated margin formula) — see PricingService.fromSourcingResult.
   * Never invented: absent entirely means no margin preview is attempted
   * for any result. Interpreted in `currency` if set, else EUR.
   */
  targetResalePrice?: number;
  targetMargin?: number;
}

/**
 * - 'verified': a real, institutional verification mechanism the source
 *   itself reports (e.g. eBay's Authenticity Guarantee enrollment).
 * - 'claimed': the seller's own listing content is the only signal — real
 *   information, never independently checked.
 * - 'unverified': the source returned an item with no usable content to
 *   even form a claim from (e.g. no title at all) — a real, if unusual,
 *   source-reported state, distinct from 'unknown' below.
 * - 'unknown': reserved for a provider that has no authenticity signal
 *   mechanism at all to report — no provider in this codebase currently
 *   emits it (EbayBrowseSourcingProvider's own determineAuthenticity is
 *   unchanged by this addition); added so a future provider is never
 *   forced to mislabel "I cannot tell" as 'claimed' or 'unverified'.
 * Never derived from price, seller, country, or title — only from a
 * signal the source itself actually reports.
 */
export type AuthenticityStatus = 'verified' | 'claimed' | 'unverified' | 'unknown';

export interface NormalizedSourcingResult {
  source: string; // provider name, e.g. 'ebay'
  sourceId?: string;
  sourceUrl: string;
  title: string;
  brand?: string;
  price: number;
  /**
   * ISO 4217 — the "source currency" for this listing: whatever currency
   * the provider reports `price` as being denominated in (for
   * EbayBrowseSourcingProvider, eBay's own item.price.currency). Never
   * converted here — see NormalizedSearchQuery's note on margin/
   * conversion being a separate future service. This is distinct from
   * PricingService's "target currency" (the caller-chosen currency
   * calculate_margin reports everything in) and from a marketplace's own
   * default/local currency, which may or may not be the same value —
   * this field is never assumed to be either of those, only exactly what
   * the source reported for this specific amount.
   */
  currency: string;
  /** The market/country the listing is actually from — e.g. 'EBAY_GB' for EbayBrowseSourcingProvider. Never normalized into an ISO country code here, to avoid inventing a mapping no provider actually confirms. */
  marketplace: string;
  condition?: string;
  availability?: string;
  images: string[];
  seller?: {
    name?: string;
    feedbackScore?: number;
    feedbackPercentage?: number;
  };
  authenticityStatus: AuthenticityStatus;
  /**
   * REQUIRED whenever authenticityStatus !== 'unverified' — describes
   * exactly what evidence justifies the status (e.g. the specific
   * program/field a provider returned), never left implicit. See
   * EbayBrowseSourcingProvider's own comment on qualifiedPrograms for the
   * one concrete case this step actually implements.
   */
  authenticitySource?: string;
  /**
   * Étape 4: the listing's real shipping cost, ONLY when the source
   * actually reported one — never defaulted to 0 or guessed when a
   * listing offers free shipping vs. simply not reporting a cost at all
   * (see EbayBrowseSourcingProvider for exactly how it distinguishes
   * these). Absent (undefined) means "not reported", not "free" — a
   * caller (e.g. PricingService.fromSourcingResult) must treat it as
   * missing, not zero.
   */
  shippingCost?: number;
  /**
   * Required whenever shippingCost is set — the shipping cost's own
   * source currency, which is not guaranteed to match `currency` above
   * (a listing's price and its shipping cost can in principle be
   * reported in different currencies). Converted independently from
   * `currency` by PricingService — never assumed to share one rate.
   */
  shippingCostCurrency?: string;
  /**
   * Deliberately NOT a margin. PricingService (Étape 3) computes this
   * from a NormalizedSourcingResult via PricingService.fromSourcingResult
   * — this type itself never fabricates one.
   */

  /**
   * Global Sourcing Engine — `price` converted to EUR via
   * CurrencyConversionService.convert(), set by SourcingService AFTER a
   * provider returns its results (never computed by a provider itself,
   * and never a made-up rate — see that service's own fixed priority
   * order, "unavailable" is a real, final answer). Undefined whenever no
   * reliable rate was available — `price`/`currency` remain the
   * authoritative, always-present original amount; this field is
   * supplementary, never a replacement.
   */
  normalizedPriceEur?: number;
  /**
   * The item's real location, ONLY when the source reports one (for
   * EbayBrowseSourcingProvider: item_summary.itemLocation.country, an
   * ISO 3166-1 alpha-2 code) — never inferred from the marketplace/site
   * being searched (a EBAY_FR search can list an item located anywhere).
   */
  itemLocationCountry?: string;
  /**
   * Landed-cost structure (Global Sourcing Engine) — deliberately NOT a
   * computed all-in price (see this project's own rule against presenting
   * an "all-in" total that isn't really calculable). `knownAdditionalCosts`
   * holds real, source-reported cost lines beyond `price`/`shippingCost`
   * (e.g. a provider that reports a real handling fee); `unknownCostFactors`
   * names real cost categories that may apply but whose amount ADKSY has
   * no data for (e.g. import duties on a cross-border purchase) — a label,
   * never a fabricated number. No current provider (including
   * EbayBrowseSourcingProvider) populates either field yet — both stay
   * undefined until a real signal exists to populate them from; this is
   * the structural capability the Global Sourcing Engine task asked for,
   * not a claim that landed cost is calculated today.
   */
  knownAdditionalCosts?: Array<{ type: string; amount: number; currency: string; description?: string }>;
  /**
   * Real, structured reasons `estimatedKnownCostEur` is undefined or
   * incomplete — a controlled vocabulary (extend it for a real new
   * reason, never a free-text guess): 'shipping_unknown' (no provider
   * ever reports a shippingCost for this result),
   * 'currency_conversion_unavailable' (a real cost line exists but no
   * reliable FX rate converted it), 'import_tax_unknown' /
   * 'customs_unknown' / 'provider_fee_unknown' /
   * 'authentication_cost_unknown' (real cost categories that MAY apply
   * but whose amount ADKSY has no data source for — labels, never
   * fabricated numbers; no current provider populates these last four,
   * they exist for a future provider/cost source that does). Phase 3:
   * SourcingService itself now populates 'shipping_unknown' and
   * 'currency_conversion_unavailable' automatically — see
   * attachLandedCost.
   */
  unknownCostFactors?: string[];
  /**
   * Phase 2 (real international providers) — the sum, in EUR, of every
   * cost line ADKSY actually knows a real amount for (price + shippingCost
   * + each knownAdditionalCosts entry), each independently converted via
   * CurrencyConversionService, set by SourcingService. Deliberately NOT a
   * "total cost". Phase 3 tightened the rule: undefined whenever ANY
   * relevant cost dimension is not resolvable — not just a failed
   * conversion, but also a real cost that was simply never reported at
   * all (e.g. no provider returned a shippingCost for this result). A
   * real shippingCost of 0 (free shipping) still counts as known and
   * never blocks this. See `unknownCostFactors` for exactly why, whenever
   * this is undefined. Never a partial/misleading sum.
   */
  estimatedKnownCostEur?: number;
  /**
   * Phase 3 — real, computed reasons this specific result satisfies the
   * caller's own search constraints (never a generic marketing phrase),
   * e.g. "Within requested price (€350 ≤ €400)", "Requested brand 'Prada'
   * found in the title". Set by SourcingService/OpportunityRankingService
   * from the actual query + this result's own real fields — never
   * fabricated, and empty (not undefined) when no query constraint could
   * be confirmed against this result.
   */
  matchReasons?: string[];
  /**
   * Phase 3 — real, computed caveats about this specific result (e.g.
   * "Authenticity is only the seller's own claim, not independently
   * verified", "Price comparison against the requested max price is
   * uncertain — no reliable EUR conversion rate was available",
   * "Landed cost is incomplete — shipping cost unavailable"). Meant to be
   * shown to the reseller alongside the result, not hidden internal
   * detail. Empty (not undefined) when nothing warrants a warning.
   */
  warnings?: string[];
  /**
   * Phase 3 — a real margin PREVIEW, only computed when the caller
   * supplied NormalizedSearchQuery.targetResalePrice AND this result's
   * estimatedKnownCostEur is itself computable (see PricingService,
   * called via PricingService.fromSourcingResult — the SAME engine
   * calculate_margin uses, never a second formula). Deliberately NOT the
   * same number calculate_margin would give on an actual marketplace
   * listing: no marketplace selling fee is included here (no marketplace
   * has been chosen yet at sourcing time) — this is landed-cost-only,
   * "would this even be worth listing" preview. Undefined whenever no
   * targetResalePrice was given, or the underlying calculation couldn't
   * fully resolve (see PricingService.calculateMargin's own missingData).
   */
  estimatedMargin?: number;
  /** Paired with estimatedMargin — undefined under the exact same conditions. */
  estimatedMarginPercent?: number;
}

export interface SourcingProviderErrorInfo {
  provider: string;
  message: string;
  /** 'timeout' | 'auth' | 'rate_limit' | 'upstream_error' | 'unknown' — lets SourcingService/the agent react differently without parsing prose. */
  kind: 'timeout' | 'auth' | 'rate_limit' | 'upstream_error' | 'unknown';
}

export interface SourcingProviderSearchOutcome {
  results: NormalizedSourcingResult[];
  error?: SourcingProviderErrorInfo;
}

/**
 * Real, implemented capabilities only — never declared unless the
 * provider's searchProducts genuinely does something with it. Extend this
 * union when a future provider adds a real new capability, never to
 * describe something aspirational.
 */
export type SourcingProviderCapability = 'keyword_search' | 'price_filter' | 'condition_filter' | 'worldwide_search';

/**
 * Every sourcing provider implements this — SourcingService and the
 * search_products tool depend on nothing else. A provider that isn't
 * configured (missing credentials) must report isConfigured() === false
 * rather than throwing, so SourcingService can skip it cleanly.
 *
 * `name` remains the one canonical identifier used everywhere already
 * (SourcingProviderErrorInfo.provider, NormalizedSourcingResult.source,
 * Product.sourceMarketplace) — never duplicated under a second
 * "providerId" field. `displayName`/`supportedMarkets`/
 * `supportedCurrencies`/`capabilities` are the new, purely declarative
 * additions this task asks for, so SourcingService/the agent can describe
 * a provider's real, honest scope without guessing.
 */
export interface SourcingProvider {
  readonly name: string;
  readonly displayName: string;
  /** Provider-specific market/site identifiers this provider can actually search (e.g. eBay marketplace IDs) — the same vocabulary `NormalizedSearchQuery.marketplaces` uses for this provider. */
  readonly supportedMarkets: readonly string[];
  /**
   * Only set when a provider has a real, fixed, declarable currency set
   * (most marketplaces don't — a listing's currency varies by seller/site,
   * not by a fixed provider-wide list) — omitted rather than guessed.
   */
  readonly supportedCurrencies?: readonly string[];
  readonly capabilities: readonly SourcingProviderCapability[];
  isConfigured(): boolean;
  searchProducts(query: NormalizedSearchQuery): Promise<SourcingProviderSearchOutcome>;
  getProductDetails(sourceUrl: string): Promise<NormalizedSourcingResult | null>;
}

export type SourcingSearchStatus = 'ok' | 'SOURCE_NOT_CONFIGURED';

export interface SourcingSearchResponse {
  status: SourcingSearchStatus;
  results: NormalizedSourcingResult[];
  /** One entry per provider that was queried but failed — never silently dropped. */
  providerErrors: SourcingProviderErrorInfo[];
  /** Global Sourcing Engine — real, structured provenance of the search itself, so the agent never claims to have searched a source it didn't. Provider names only (SourcingProvider.name), always real: never a provider listed here unless SourcingService actually made the corresponding decision about it. */
  /** Providers that were configured and genuinely queried (regardless of outcome). */
  providersSearched: string[];
  /** Subset of providersSearched whose call produced a providerErrors entry (a structured error or an unexpected throw) — never a provider that simply returned zero results, that's a normal empty outcome, not a failure. */
  providersFailed: string[];
  /** Providers ADKSY knows about (see SourcingProviderRegistry) but that are not configured right now — never queried, distinct from a failure. */
  providersUnavailable: string[];
  /**
   * Phase 2 — providers that WERE configured and available, but were
   * excluded from this specific search because NormalizedSearchQuery.providers
   * named a different, narrower allowlist. Distinct from providersUnavailable
   * (which means "not usable at all right now") — a skipped provider could
   * have been queried, it just wasn't asked to be for this search.
   */
  providersSkipped: string[];
  /** results.length, after deduplication — provided directly so the agent never has to (and never needs to) recompute it. */
  totalResults: number;
  /**
   * Phase 3 — real wall-clock time (ms) each QUERIED provider's own
   * searchProducts call took, keyed by SourcingProvider.name. Only
   * providers in providersSearched appear here (never a provider that was
   * skipped/unavailable — there is no real duration to report for a call
   * that never happened). Purely observability — never used to make a
   * search/ranking decision.
   */
  providerLatencyMs: Record<string, number>;
}
