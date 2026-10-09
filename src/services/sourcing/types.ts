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
   * - 'opportunity_score' (Deep Web Sourcing Engine): descending by the
   *   real, documented OpportunityRankingService.computeOpportunityScore
   *   total (undefined last) — see NormalizedSourcingResult.opportunityScore.
   */
  sort?: 'price_asc' | 'price_desc' | 'normalized_price_asc' | 'known_cost_asc' | 'match' | 'opportunity_score';
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
  /**
   * Deep Web Sourcing Engine (mission section 2/4/18) — opt-in, additive.
   * Omitted/false (the default, UNCHANGED behavior): WebSourcingProvider
   * runs exactly one Tavily search pass, identical to before this field
   * existed. true: allows WebSourcingProvider's own WebSearchQueryPlanner
   * to run additional passes (variant/secondhand/outlet keywords, then a
   * recovery pass) up to its fixed, documented budget — see
   * WebSearchQueryPlanner's own constants. Never affects eBay/Etsy, which
   * have no concept of "passes". Never changes the AI Units cost of
   * search_products (fixed at 3 regardless).
   */
  deepSearch?: boolean;
  /**
   * Deep Web Sourcing Engine (mission section 15) — opt-in only. Omitted
   * (the default, UNCHANGED behavior): every result is kept regardless of
   * qualityTier, exactly as before this field existed. When set, a result
   * whose qualityTier ranks below the requested minimum is excluded —
   * same "never silently drop" discipline as excludedByPrice: this is an
   * explicit, caller-requested filter, never an automatic one.
   */
  minQuality?: 'HIGH' | 'MEDIUM' | 'LOW';
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

/**
 * Source freshness — see NormalizedSourcingResult.sourceDateStatus's own
 * comment for the exact meaning of each value and why a provider with no
 * publish-date concept at all (eBay/Etsy) leaves the field undefined
 * rather than using 'unknown' for a structurally different situation.
 */
export type SourceDateStatus = 'known' | 'unknown' | 'invalid';

export interface NormalizedSourcingResult {
  source: string; // provider name, e.g. 'ebay'
  sourceId?: string;
  /**
   * Multi-offer web extraction (Global Web Sourcing, Option A) — true only
   * when this result is one of SEVERAL distinct offers WebSourcingProvider
   * extracted from the exact same raw web page (e.g. a category/brand
   * listing page naming several items at several prices). `sourceUrl`
   * below is then the page's own URL, not a direct link to this specific
   * offer — OpportunityRankingService.annotateResult turns this into an
   * explicit warning for exactly that reason (never silently implied as a
   * precise per-offer link). Undefined/false for every other provider and
   * for a web result that was the only offer found on its page — never set
   * except by WebSourcingProvider itself, and never used to invent a URL.
   */
  sharedSourcePage?: boolean;
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
  /**
   * Kept as a free string (unchanged type) since EbayBrowseSourcingProvider
   * already populates it with eBay's own raw `estimatedAvailabilityStatus`
   * values (e.g. 'IN_STOCK', 'LIMITED_STOCK') — tightening this to a fixed
   * union would misrepresent that real provider data. Deep Web Sourcing
   * Engine (WebSourcingProvider) only ever writes the literal strings
   * 'IN_STOCK' or 'OUT_OF_STOCK' here, and ONLY when the page text
   * confidently states one — "not stated" is represented by leaving this
   * field entirely absent (undefined), never by writing a literal
   * 'UNKNOWN' string, consistent with every other "not reported" field on
   * this type. A caller must never treat an absent value as IN_STOCK.
   */
  availability?: string;
  images: string[];
  /**
   * Deep Web Sourcing Engine — a direct link to THIS specific offer, only
   * when the source distinctly reported one (e.g. a per-offer anchor on a
   * category page) — distinct from `sourceUrl`, which is always the page
   * actually fetched/searched. Undefined means no such distinct link was
   * found; `sourceUrl` remains the only real link in that case (unchanged
   * from before this field existed). Never derived/guessed from `sourceUrl`.
   */
  productUrl?: string;
  /** Deep Web Sourcing Engine — ONLY when explicitly stated in the source text for this specific offer. Never inferred from product category/brand. */
  material?: string;
  /**
   * Deep Web Sourcing Engine — ONLY when explicitly stated in the source
   * text for this specific offer (WebSourcingProvider, from
   * ExtractedWebOffer.size). No other current provider reports a size on
   * a RESULT either (eBay/Etsy have no such field in their own listing
   * responses) — this is purely additive, never backfilled for an
   * existing provider. Distinct from NormalizedSearchQuery.size (the
   * search INPUT, folded into keywords) — this is the result's own
   * reported value, used by SourcingService's web-only signal dedup to
   * avoid ever merging two genuinely different sizes.
   */
  size?: string;
  /**
   * Opportunity Classification fix — ONLY when explicitly stated in the
   * source text for this specific offer (WebSourcingProvider, from
   * ExtractedWebOffer.color — extracted by WebResultExtractionService
   * since before this field existed, but previously discarded before
   * ever reaching this type; see OpportunityRankingService.compareColor
   * for how it's compared against NormalizedSearchQuery.color). No other
   * current provider reports a color on a RESULT (eBay/Etsy have no such
   * field). Never normalized/translated here — exactly the source's own
   * words (e.g. "Black/White"), comparison logic lives entirely in
   * OpportunityRankingService, never in this type.
   */
  color?: string;
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
  /**
   * Phase 6 — `shippingCost` independently converted to EUR via
   * CurrencyConversionService, set by SourcingService. Exposed as its own
   * field (distinct from the combined `estimatedKnownCostEur`) so the UI/
   * Agent can show a real, converted shipping figure even when the
   * OVERALL landed cost is undefined for an unrelated reason (e.g. a
   * knownAdditionalCosts line that failed to convert). Undefined whenever
   * shippingCost itself is unreported, or its own conversion is
   * unavailable — never a guess, and never the same thing as "shipping is
   * free" (that is a real, reported shippingCost of 0, still converted
   * normally here).
   */
  shippingCostEur?: number;
  /**
   * Phase 6 — the sum of every `knownAdditionalCosts` entry, independently
   * converted to EUR, set by SourcingService. Distinct from
   * `estimatedKnownCostEur` (which also folds in price/shipping) so a
   * caller can see the known-fees component on its own. Undefined
   * whenever `knownAdditionalCosts` is empty/absent, or any entry's own
   * conversion is unavailable — never a partial sum.
   */
  knownAdditionalCostsEur?: number;
  /**
   * Phase 6 — echoes NormalizedSearchQuery.targetResalePrice back onto
   * THIS result, but ONLY when it was actually used to compute
   * estimatedMargin/estimatedMarginPercent for this result (same gate,
   * set by the same step) — so a reader never has to cross-reference the
   * original query to understand what "estimatedMargin" was measured
   * against. Never present without estimatedMargin also being present,
   * and never a value the caller didn't actually supply.
   */
  targetResalePrice?: number;
  /**
   * Deep Web Sourcing Engine — source provenance (mission section 12):
   * the EXACT query string that actually produced this result, and which
   * search pass found it ('exact' | 'variant' | 'secondhand' | 'outlet' |
   * 'recovery') — see WebSearchQueryPlanner. Undefined for every provider
   * that doesn't run multi-pass search (eBay/Etsy query the full
   * NormalizedSearchQuery directly, there is no separate "pass"). Lets
   * the Agent/UI answer "why am I being shown this" precisely.
   */
  foundByQuery?: string;
  searchPass?: 'exact' | 'secondhand' | 'outlet' | 'recovery';
  /**
   * Deep Web Sourcing Engine — the page type the extraction step itself
   * classified this result's source page as (mission section 7). Only
   * ever set by a provider whose extraction step actually determines this
   * (WebSourcingProvider); undefined for eBay/Etsy (a structured API
   * response has no "page type" concept at all). 'UNKNOWN' is a real,
   * honest classification outcome, not a placeholder for "not set".
   */
  pageType?: 'PRODUCT_PAGE' | 'CATEGORY_PAGE' | 'SEARCH_PAGE' | 'COLLECTION_PAGE' | 'UNKNOWN';
  /**
   * Deep Web Sourcing Engine (mission section 15) — a documented, testable
   * tier computed ONLY from fields already real on this result (never a
   * new signal of its own): HIGH requires price+currency+a usable
   * sourceUrl+availability all known; MEDIUM requires price+currency+
   * sourceUrl but some other field missing; LOW means even price/currency
   * confidence is thin (e.g. a web result with no availability AND no
   * condition AND no seller at all). See OpportunityRankingService.
   * classifyResultQuality for the exact, fixed criteria. Never used to
   * silently drop a result — only ever an informational tier, filterable
   * only when the caller explicitly opts in via NormalizedSearchQuery.minQuality.
   */
  qualityTier?: 'HIGH' | 'MEDIUM' | 'LOW';
  /**
   * Deep Web Sourcing Engine (mission section 14) — a transparent, additive
   * point total (0-100) computed ONLY from real signals already present on
   * this result (margin known, landed cost known, shipping known,
   * authenticity, availability, quality tier) — see
   * OpportunityRankingService.computeOpportunityScore. NEVER a claim of
   * certain profitability — `scoreFactors` always lists exactly which
   * components contributed, so this is never an opaque number. Additive to
   * (never a replacement for) matchReasons/compareByMatch.
   */
  opportunityScore?: number;
  /** Paired with opportunityScore — the real, specific factors that contributed to it, e.g. "Margin preview available (+20)". Always present (possibly empty) whenever opportunityScore is. */
  scoreFactors?: string[];
  /**
   * Deep Web Sourcing Engine (mission section 13) — ONLY ever
   * 'unverified' for every provider today (the honest default: no live
   * second-confirmation request is actually made to any source). The
   * other three values exist as real, structured outcomes of the checks
   * this engine does perform — comparing two results that deduplicate to
   * the same (provider, sourceId)/(sourceUrl) but report a different
   * price, condition, availability, or authenticity (Phase 2 — see
   * OpportunityRankingService.detectPriceConflict/detectAttributeConflicts,
   * called from SourcingService's deduplicate step): that specific,
   * narrow case — two results already identified as the exact same offer,
   * never a broader "looks similar" match — sets 'conflicting' with a
   * warning naming both real, disagreeing values, never silently picking
   * one as correct. An attribute where either side reports no real signal
   * at all is never treated as conflicting with the other side's real
   * value. 'verified'/'partially_verified' are reserved for a future real
   * re-fetch confirmation step — no code path sets either today. This NEVER means
   * "authenticity guaranteed" (see authenticityStatus for that, a fully
   * separate concept) — only that the DATA (price/etc.) was, or wasn't,
   * corroborated.
   */
  verificationStatus?: 'verified' | 'partially_verified' | 'unverified' | 'conflicting';
  /**
   * Source freshness (Phase: source freshness and reliability tests) —
   * explicit tri-state for whether THIS result's own claimed publish date
   * is usable at all, computed once, deterministically, from the raw
   * source's own reported value (never guessed, never defaulted to "now"):
   * - 'known': the source reported a real, parseable date, and it isn't
   *   nonsensically in the future (see WebSourcingProvider.parseSourceDate)
   *   — `sourcePublishedAt`/`sourcePublishedAgeDays` are set.
   * - 'unknown': the source reported no date at all (the common case for
   *   most web search hits) — `sourcePublishedAt` stays undefined. This is
   *   a normal, honest outcome, never treated as "recent" nor as an error.
   * - 'invalid': the source reported something date-shaped that failed to
   *   parse as a real date, or parsed to a point further in the future
   *   than `retrievedAt` could ever allow — treated as untrustworthy, never
   *   silently coerced into 'known' nor into 'unknown'.
   * Undefined entirely for a provider with no publish-date concept at all
   * (eBay/Etsy's structured listing APIs report no such field — a live
   * marketplace listing simply has no separate "publication date" the way
   * an indexed web page does) — this is intentionally DIFFERENT from
   * 'unknown' (which means "this kind of date exists for this source type,
   * but wasn't reported for this specific item"). Only WebSourcingProvider
   * sets this field today.
   */
  sourceDateStatus?: SourceDateStatus;
  /**
   * Source freshness — the SOURCE's own claimed publish date (e.g. when a
   * web page was published/last updated), ISO 8601, set ONLY when
   * `sourceDateStatus === 'known'`. This is the source's OWN claim, never
   * independently confirmed by ADKSY, and is a fully different concept
   * from `retrievedAt` below (when ADKSY itself fetched this result) and
   * from `priceVerifiedAt` (when, if ever, ADKSY actually re-checked this
   * price/stock live) — the three must never be conflated. A page being
   * reachable right now (i.e. `retrievedAt` existing) is never, by itself,
   * evidence that a price/stock fact dated this old is still accurate —
   * see the search_products tool's own description for how the Agent must
   * reason about this responsibly, without a single universal "too old"
   * cutoff applied to every kind of question.
   */
  sourcePublishedAt?: string;
  /**
   * Source freshness — `retrievedAt` minus `sourcePublishedAt`, in whole
   * days (>= 0; see parseSourceDate's own future-date guard), computed
   * deterministically by SourcingService once both are known — never
   * computed by the model itself, same "code computes the real number,
   * the model only interprets it responsibly" rule already applied to
   * `estimatedMargin`/`estimatedKnownCostEur`. Undefined whenever
   * `sourceDateStatus !== 'known'`.
   */
  sourcePublishedAgeDays?: number;
  /**
   * Source freshness — the real, exact instant ADKSY's own search actually
   * retrieved this result, ISO 8601, stamped once per search by
   * SourcingService (the same instant for every result returned by one
   * search_products call). This is ONLY ever "we fetched this data at this
   * time" — it is NEVER evidence that the underlying price/stock is still
   * accurate at that instant (a page can report outdated information while
   * still being perfectly reachable), and it must never be described as a
   * "verification". Always set on every result in a real search response,
   * regardless of provider (eBay/Etsy included) — unlike `sourcePublishedAt`,
   * every provider's result genuinely was retrieved at some real instant.
   */
  retrievedAt?: string;
  /**
   * Source freshness — reserved for a REAL, explicit re-verification step
   * (e.g. a future live re-fetch of this exact listing to confirm its
   * price/stock are still current) — ISO 8601, set ONLY by a code path
   * that actually performed such a check. No code path in ADKSY performs
   * this today (WebSourcingProvider.getProductDetails/EbayBrowseSourcingProvider.
   * getProductDetails/EtsySourcingProvider.getProductDetails are all
   * unimplemented — see each one's own comment), so this field is always
   * undefined in practice right now. Its absence must never be read as
   * "not verified recently" or any other specific claim — only as "ADKSY
   * performed no explicit re-verification for this result". Exists now,
   * deliberately unused, so a future real verification step has a place to
   * record its result without a later type change, and so no earlier,
   * unverified field is ever repurposed to mean "verified" by mistake.
   */
  priceVerifiedAt?: string;
  /**
   * Opportunity Classification — computed by
   * OpportunityRankingService.classifyOpportunity (see that file's own
   * `OpportunityClassification` type), ONLY ever set on a result that
   * survived every exclusion gate in SourcingService.search. A result
   * SourcingService rejects outright (irrelevant product, incompatible
   * color, unresolved listing page, confidently out of price range, ...)
   * NEVER becomes a NormalizedSourcingResult with classification:
   * 'REJECTED' — it is simply not in `results[]` at all (see
   * SourcingSearchDiagnostics.rejectedSamples for how a rejection is
   * still made visible, in aggregate, without ever appearing as a
   * result). This field is therefore always 'VERIFIED_OPPORTUNITY' or
   * 'WEB_LEAD' whenever present, never 'REJECTED' — `source !== 'web'` is
   * NOT by itself sufficient for 'VERIFIED_OPPORTUNITY' (an eBay/Etsy
   * result with qualityTier !== 'HIGH', a price conflict, or an
   * unconfirmed requested color/size is just as much a 'WEB_LEAD' as a
   * web result would be in the same situation).
   */
  classification?: 'VERIFIED_OPPORTUNITY' | 'WEB_LEAD';
  /**
   * Web Sourcing smoke-test fix (section 3) — a concise, real explanation
   * of why `classification` is 'WEB_LEAD', derived ONLY from signals
   * already computed for this exact result (see
   * OpportunityRankingService.explainClassification) — never a new
   * signal, never invented. Always undefined for 'VERIFIED_OPPORTUNITY'
   * (nothing to explain) and for a result with no classification at all.
   * Deliberately a short label, not a restatement of `warnings` (which
   * already carry the full sentences) — this exists so the Agent/UI can
   * show "why WEB_LEAD" in one place without re-deriving it from several
   * warning strings.
   */
  classificationReason?: string;
}

export interface SourcingProviderErrorInfo {
  provider: string;
  message: string;
  /** 'timeout' | 'auth' | 'rate_limit' | 'upstream_error' | 'unknown' — lets SourcingService/the agent react differently without parsing prose. */
  kind: 'timeout' | 'auth' | 'rate_limit' | 'upstream_error' | 'unknown';
}

/** One real, rejected candidate — never shown to the end user as a result, only ever surfaced via SourcingSearchDiagnostics.rejectedSamples for the Agent to explain a low/zero-result search. Bounded (see SourcingService's own MAX_REJECTED_SAMPLES). */
export interface RejectedSample {
  title: string;
  url: string;
  reason: string;
}

export interface SourcingProviderSearchOutcome {
  results: NormalizedSourcingResult[];
  error?: SourcingProviderErrorInfo;
  /**
   * Opportunity Classification fix — provider-level rejection diagnostics,
   * for a candidate that was dropped BEFORE it could even become a
   * NormalizedSourcingResult (so SourcingService's own per-result
   * exclusion loop never sees it at all). Only WebSourcingProvider
   * populates these today: eBay/Etsy never reject a candidate after the
   * fact — an item either matches the API's own request or is never
   * returned in the first place, so there is no real "rejected candidate"
   * to report for them. Optional/omitted means "this provider has
   * nothing of this kind to report", never "zero rejections happened".
   */
  rejectedCounts?: { irrelevantProduct?: number; noConfidentPrice?: number };
  rejectedSamples?: RejectedSample[];
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
  /**
   * Deep Web Sourcing Engine (mission section 16) — real, counted reasons
   * results were lost along the pipeline, so a zero/low-result outcome is
   * never just silence. Every count here is a real number SourcingService
   * actually computed from this exact search's own intermediate state —
   * never a guess, never populated when the corresponding stage didn't
   * run (e.g. excludedByPriceBound stays 0 when no price bound was
   * requested at all, same as "no exclusion happened", which is also the
   * honest answer in that case).
   */
  diagnostics: SourcingSearchDiagnostics;
}

export interface SourcingSearchDiagnostics {
  /** Raw results every queried provider returned, before dedup/filtering — includes web search raw hits (pre-extraction) folded in by WebSourcingProvider as part of its own outcome.results, so this is "candidates before this search's own quality gates", not literally every HTTP hit. */
  rawResultsBeforeFiltering: number;
  /** Results dropped by deduplicate() (exact id/url, or the Deep Web Sourcing Engine's additional web-only signal match — see SourcingService). */
  excludedByDeduplication: number;
  /** Results dropped because their price was confidently outside the requested [minPrice, maxPrice] range (never one merely uncertain — those are kept with a warning instead). */
  excludedByPriceBound: number;
  /** Results dropped by an explicit NormalizedSearchQuery.minQuality filter — 0 whenever minQuality was not set at all. */
  excludedByMinQuality: number;
  /**
   * Deep Web Sourcing Engine fix — results dropped because they came from
   * a category/search/collection/browse listing page with no distinct
   * productUrl of their own (see OpportunityRankingService.
   * isUnresolvedListingPage). Never a PRODUCT_PAGE result — those are
   * never excluded on this basis, their own sourceUrl already is the
   * direct link.
   */
  excludedByUnresolvedListingPage: number;
  /** Results dropped only by balanceByProvider's fairness cap once the combined set exceeded the requested `limit` — these were otherwise valid. */
  excludedByOverallLimit: number;
  /**
   * Opportunity Classification fix — candidates dropped because they are
   * not really the requested product: WebSourcingProvider's own
   * isProductRelevant (brand/model/keyword token mismatch, an
   * accessory-only listing, or — new — a kids/toddler/infant variant
   * excluded from an adult-intent search, see
   * WebSourcingProvider.isDemographicMismatch) AND SourcingService's own
   * color-incompatibility exclusion (see annotateResult's
   * excludedByColor) — both are real "this is a different product than
   * what was asked for" rejections, counted together. 0 for eBay/Etsy,
   * which never reject a candidate after the fact.
   */
  excludedByIrrelevantProduct: number;
  /**
   * Opportunity Classification fix — web candidates whose page text
   * never yielded a confident numeric price AND currency for any offer
   * (see WebSourcingProvider.toNormalizedResults' own `validOffers`
   * filter) — these were real pages the search engine found, simply
   * never turned into an exploitable NormalizedSourcingResult. Always 0
   * for eBay/Etsy (every item their structured API returns already has a
   * real price).
   */
  excludedByNoConfidentPrice: number;
  /**
   * Opportunity Classification fix — a small, bounded sample of REAL
   * rejected candidates (never fabricated, never the full list), so the
   * Agent can explain a low/zero-result search precisely instead of just
   * citing the counts above. Each entry's `reason` is a real, specific
   * sentence (never generic). Capped at MAX_REJECTED_SAMPLES (20) total
   * across every rejection reason combined — see SourcingService. NEVER
   * meant for bulk display in the end-user UI (see search_products tool's
   * own description) — it exists for diagnostics and for the Agent's own
   * explanation, not as a second results list.
   */
  rejectedSamples: RejectedSample[];
}

/**
 * Phase 5 — real, honest reasons a real-world source is NOT a
 * SourcingProvider today. Distinguishes exactly what kind of access gap
 * blocks it, per this phase's own research (see
 * SourcingProviderRegistry.getKnownUnavailableSources for the sourced,
 * per-provider findings):
 * - 'SELL_SIDE_ONLY': a real, official API exists, but it only lets a
 *   seller manage THEIR OWN inventory (create/update/delete listings) —
 *   never a marketplace-wide search/browse of OTHER sellers' listings.
 *   Structurally unusable for sourcing regardless of credentials.
 * - 'PARTNER_REQUIRED': a real API exists but is gated behind a
 *   partner/business approval process with no public self-service
 *   registration — technically real, but not something ADKSY can
 *   configure today without that approval.
 * - 'NO_CONFIRMED_ACCESS': no official, documented API/feed for
 *   marketplace-wide search was found at all (only unofficial
 *   scrapers/third-party tools this project will never use).
 */
export type KnownSourceAccessStatus = 'SELL_SIDE_ONLY' | 'PARTNER_REQUIRED' | 'NO_CONFIRMED_ACCESS';

export interface KnownUnavailableSource {
  /** A real, human-readable name — never a SourcingProvider.name (no SourcingProvider object exists for these at all). */
  name: string;
  status: KnownSourceAccessStatus;
  /** One real, specific sentence citing what was actually found (or not found) — never vague ("not available"), see the registry's own sourced comment for each entry. */
  reason: string;
}
