/**
 * Phase 3/6 — ADKSY's Opportunity Analysis layer for the Global Sourcing
 * Engine: transparent annotation (matchReasons/warnings/risks) and
 * deterministic ranking for a NormalizedSourcingResult. Deliberately NOT
 * a black-box "AI score": every matchReason/warning is a plain sentence
 * describing a real fact already present on the query or the result, and
 * the 'match' sort (see compareByMatch) is a fixed, documented, multi-key
 * comparator — never a single summed/weighted number.
 *
 * Phase 6 note on naming: the brief that introduced this phase asked for
 * an "OpportunityAnalysisService ou équivalent" covering match/cost/
 * margin/authenticity analysis. Cost (attachLandedCost) and margin
 * (attachMargin) already lived — correctly — in SourcingService.ts, next
 * to the currency conversion they both depend on; moving them here would
 * split a currency-dependent computation away from its own dependency for
 * no functional gain. This file already covered match/authenticity/risk
 * analysis and ranking (Phase 3) and is functionally ADKSY's "Opportunity
 * Analysis" layer — Phase 6 extends it in place (real, structured risk
 * warnings; a fuller, still fully documented ranking) rather than
 * renaming/duplicating it.
 */
import { AuthenticityStatus, NormalizedSearchQuery, NormalizedSourcingResult } from './types';

/**
 * A single EUR conversion of the query's own price bounds, resolved ONCE
 * per search (never per result) by SourcingService — this module does no
 * currency conversion itself, only compares against already-resolved
 * numbers.
 */
export interface ResolvedPriceBounds {
  /** True only when the caller actually requested minPrice or maxPrice. */
  requested: boolean;
  /** True when a bound was requested but SourcingService could not convert it to EUR — every result's price comparison is then 'unknown', never guessed. */
  unresolvable: boolean;
  minEur?: number;
  maxEur?: number;
}

export interface ResultAnnotation {
  matchReasons: string[];
  warnings: string[];
  /**
   * True when a price bound was requested and this result is EITHER
   * confidently outside [minEur, maxEur], OR the comparison itself could
   * not be reliably made (no exchange rate available for this result's
   * own currency, or for the bound itself) — Deep Web Sourcing Engine fix
   * (mission: "un résultat dont le prix ne peut pas être comparé de
   * manière fiable à Xa EUR doit être exclu ... jamais présenté comme une
   * opportunité <X EUR"). An unreliable comparison is never presented as
   * if it had passed the filter — it is excluded exactly like a
   * confidently-out-of-range result, never kept "just in case" with only
   * a warning (the previous behavior, which let USD/MXN-priced results
   * leak through a EUR price cap whenever no FX provider was configured).
   */
  excludedByPrice: boolean;
  /**
   * Opportunity Classification fix — true only when a color was
   * explicitly requested (NormalizedSearchQuery.color) AND this result's
   * own reported color is confidently INCOMPATIBLE with it (see
   * compareColor) — e.g. requesting "white" against a result reported as
   * "black" (no overlap at all). An AMBIGUOUS case (e.g. "white" against
   * "Black/White" — the requested color IS present, but so is another)
   * is never excluded here, only downgraded to WEB_LEAD by
   * classifyOpportunity — see this field's own name: only a confident
   * incompatibility excludes, never an uncertain partial match.
   */
  excludedByColor: boolean;
  /**
   * 'not_requested' when NormalizedSearchQuery.color was never set — no
   * color judgment is ever made in that case. 'unknown' means a color WAS
   * requested but this result's own source never reported one. See
   * compareColor for 'match'/'incompatible'/'ambiguous'.
   */
  colorOutcome: ColorMatchOutcome | 'unknown' | 'not_requested';
  /** 'not_requested' when NormalizedSearchQuery.size was never set. 'match'/'different'/'absent' never excludes a result — see classifyOpportunity for how this instead gates VERIFIED_OPPORTUNITY vs WEB_LEAD. */
  sizeOutcome: 'match' | 'different' | 'absent' | 'not_requested';
}

/**
 * Opportunity Classification fix — the real, structured outcome of
 * comparing a REQUESTED color against a result's own REPORTED color
 * (never a guess, never applied unless both are actually present):
 * - 'match': every color word the source reports is also requested (a
 *   clean, unambiguous match — e.g. "white" vs "white").
 * - 'incompatible': NONE of the requested color words appear in the
 *   source's reported color at all (e.g. "white" vs "black") — a
 *   confident mismatch.
 * - 'ambiguous': SOME but not all overlap — the source reports the
 *   requested color AND at least one other (e.g. "white" vs
 *   "Black/White" or "Multi/White") — genuinely a partial match, never
 *   silently treated as a full confirmation.
 */
export type ColorMatchOutcome = 'match' | 'incompatible' | 'ambiguous';

/**
 * Splits a free-text color string into lowercase word tokens — the ONLY
 * normalization performed (no synonym table, no translation, never a
 * guess at a color this text doesn't literally contain). "Black/White"
 * -> {black, white}; "Triple White" -> {triple, white}; "Off-White" ->
 * {off, white} (a real, documented limitation: "off-white" is treated as
 * containing the token "white", since this is a literal word split, not
 * a shade-aware comparison — see this engine's own audit report).
 */
export function normalizeColorTokens(raw: string): Set<string> {
  return new Set(
    raw
      .toLowerCase()
      .split(/[\s/,&+-]+|\band\b/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
  );
}

/**
 * Real, deterministic comparison — see ColorMatchOutcome's own comment
 * for exactly what each outcome means. Only ever called when BOTH a
 * requested and a reported color are non-empty strings; the caller
 * (annotateResult) handles the "color not requested" / "color unknown"
 * cases itself, since those are not really a comparison outcome at all.
 */
export function compareColor(requestedColor: string, reportedColor: string): ColorMatchOutcome {
  const requested = normalizeColorTokens(requestedColor);
  const reported = normalizeColorTokens(reportedColor);

  const overlap = [...reported].some((token) => requested.has(token));
  if (!overlap) return 'incompatible';

  const reportedExtras = [...reported].filter((token) => !requested.has(token));
  return reportedExtras.length === 0 ? 'match' : 'ambiguous';
}

/**
 * Strips only a KNOWN region/unit label word (eu/uk/us/usa/fr) and
 * non-alphanumeric punctuation, normalizing a comma decimal to a dot —
 * never a real EU/US/UK size-system conversion (this engine has no
 * verified conversion table and must never invent one). "43 EU" and "EU
 * 43" both normalize to "43", so they compare equal; "43" (EU, implied)
 * and "9 US" do NOT normalize to the same string (different numbers), so
 * they are correctly reported as 'different' — never silently assumed to
 * be the same real size, and never silently assumed to differ either
 * when only a label, not a number, differs.
 */
export function normalizeSizeForComparison(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(eu|eur|uk|us|usa|fr)\b/g, '')
    .replace(/,/g, '.')
    .replace(/[^a-z0-9.]/g, '')
    .trim();
}

const UNKNOWN_COST_FACTOR_EXPLANATIONS: Record<string, string> = {
  shipping_unknown: 'Landed cost is incomplete — this listing\'s shipping cost is not reported.',
  currency_conversion_unavailable: 'Landed cost is incomplete — a real cost line could not be converted to EUR (no reliable exchange rate available).',
  import_tax_unknown: 'Import taxes/duties may apply and are not included in the known cost.',
  customs_unknown: 'Customs fees may apply and are not included in the known cost.',
  provider_fee_unknown: 'A provider/marketplace fee may apply and is not included in the known cost.',
  authentication_cost_unknown: 'A third-party authentication service fee may apply and is not included in the known cost.',
};

function describeUnknownCostFactor(factor: string): string {
  return UNKNOWN_COST_FACTOR_EXPLANATIONS[factor] ?? `Landed cost is incomplete — an unresolved cost factor ("${factor}") is not included.`;
}

/**
 * Real, computed matchReasons/warnings for one result against the
 * caller's own query — never a generic marketing phrase, never derived
 * from anything the query/result didn't actually say.
 */
export function annotateResult(
  result: NormalizedSourcingResult,
  query: NormalizedSearchQuery,
  priceBounds: ResolvedPriceBounds
): ResultAnnotation {
  const matchReasons: string[] = [];
  const warnings: string[] = [];
  let excludedByPrice = false;
  let excludedByColor = false;
  let colorOutcome: ColorMatchOutcome | 'unknown' | 'not_requested' = 'not_requested';
  let sizeOutcome: 'match' | 'different' | 'absent' | 'not_requested' = 'not_requested';

  // --- Price bounds (Phase 3 "robust price filtering", tightened by the
  // Deep Web Sourcing Engine fix — see ResultAnnotation.excludedByPrice's
  // own comment for why an unreliable comparison is now excluded rather
  // than kept with only a warning) ---
  if (priceBounds.requested) {
    if (priceBounds.unresolvable) {
      warnings.push('Price comparison against the requested price range is uncertain — no reliable exchange rate was available to convert it to EUR.');
      excludedByPrice = true;
    } else if (result.normalizedPriceEur === undefined) {
      warnings.push(`Price comparison is uncertain — no reliable exchange rate was available to convert this listing's price (${result.currency}) to EUR.`);
      excludedByPrice = true;
    } else {
      const aboveMin = priceBounds.minEur === undefined || result.normalizedPriceEur >= priceBounds.minEur;
      const belowMax = priceBounds.maxEur === undefined || result.normalizedPriceEur <= priceBounds.maxEur;
      if (aboveMin && belowMax) {
        matchReasons.push(`Within the requested price range (~€${result.normalizedPriceEur.toFixed(2)})`);
      } else {
        excludedByPrice = true;
      }
    }
  }

  // --- Brand / model keyword match (plain substring check on real title text, never fabricated) ---
  const title = result.title.toLowerCase();
  if (query.brand && title.includes(query.brand.toLowerCase())) {
    matchReasons.push(`Requested brand "${query.brand}" found in the listing title`);
  }
  if (query.model && title.includes(query.model.toLowerCase())) {
    matchReasons.push(`Requested model "${query.model}" found in the listing title`);
  }

  // --- Color (Opportunity Classification fix) — ONLY ever judged when the
  // caller actually requested a color; 'unknown' (distinct from
  // ColorMatchOutcome's 'match'/'incompatible'/'ambiguous', which only
  // describe a REAL comparison of two present values) covers the source
  // simply not reporting a color at all — never a guess in either
  // direction.
  if (query.color) {
    if (result.color) {
      const outcome = compareColor(query.color, result.color);
      colorOutcome = outcome;
      if (outcome === 'match') {
        matchReasons.push(`Requested color "${query.color}" confirmed by the source (reported as "${result.color}")`);
      } else if (outcome === 'incompatible') {
        excludedByColor = true;
        warnings.push(`Requested color "${query.color}" does not match this listing's reported color ("${result.color}")`);
      } else {
        warnings.push(`Requested color "${query.color}" is only partially confirmed by this listing's reported color ("${result.color}") — treat as unconfirmed, not a clean match.`);
      }
    } else {
      colorOutcome = 'unknown';
      warnings.push('Requested color was not confirmed — color is not reported for this listing.');
    }
  }

  // --- Size (Opportunity Classification fix) — never deduced; a mismatch
  // is reported as a warning, NEVER auto-excluded (no verified EU/US/UK
  // size-system conversion exists — see normalizeSizeForComparison).
  if (query.size) {
    if (result.size) {
      const sizesMatch = normalizeSizeForComparison(query.size) === normalizeSizeForComparison(result.size) && normalizeSizeForComparison(query.size).length > 0;
      sizeOutcome = sizesMatch ? 'match' : 'different';
      if (sizesMatch) {
        matchReasons.push(`Requested size "${query.size}" confirmed by the source (reported as "${result.size}")`);
      } else {
        warnings.push(`Reported size ("${result.size}") differs from the requested size ("${query.size}") — EU/US/UK size-system conversion was not verified, this may or may not be the same real size.`);
      }
    } else {
      sizeOutcome = 'absent';
      warnings.push('Size not confirmed by the source — size is not reported for this listing.');
    }
  }

  // --- Condition (soft match — provider condition strings are not a confirmed shared vocabulary, e.g. eBay's 'USED_EXCELLENT') ---
  if (query.condition && result.condition && result.condition.toLowerCase().includes(query.condition)) {
    matchReasons.push(`Condition matches the requested "${query.condition}"`);
  }

  // --- Worldwide ---
  if (query.worldwide) {
    matchReasons.push('Included via a worldwide search across this provider\'s available marketplaces');
  }

  // --- Authenticity ---
  if (result.authenticityStatus === 'verified') {
    matchReasons.push(`Authenticity institutionally verified${result.authenticitySource ? ` (${result.authenticitySource})` : ''}`);
  } else if (result.authenticityStatus === 'claimed') {
    warnings.push('Authenticity is only the seller\'s own claim — not independently verified.');
  } else if (result.authenticityStatus === 'unverified') {
    warnings.push('No usable authenticity information is available for this listing.');
  } else if (result.authenticityStatus === 'unknown') {
    warnings.push('This provider does not report any authenticity signal at all.');
  }

  // --- Global Web Sourcing — a general web result is never a structured
  // marketplace API response: the fields shown were extracted
  // automatically from an indexed web page, not read from a marketplace's
  // own listing data model. Attached here (not by WebSourcingProvider
  // itself) because SourcingService.search's final annotation step
  // REPLACES a provider's own `warnings` with this function's return
  // value — see WebSourcingProvider.ts's own header comment.
  if (result.source === 'web') {
    warnings.push('This result comes from a general web search (not a structured marketplace API) — details were extracted automatically and may be incomplete or inexact.');
    // Multi-offer web extraction (Global Web Sourcing, Option A) — see
    // NormalizedSourcingResult.sharedSourcePage's own comment for exactly
    // when this is set. Must be attached here, not by WebSourcingProvider
    // itself, for the same "warnings gets replaced wholesale" reason as
    // the warning right above.
    if (result.sharedSourcePage) {
      warnings.push(
        "This result's source link points to a page listing several offers (a category/search/brand page), not a direct link to this specific offer — opening it may show the general page rather than this exact item."
      );
    }

    // Source freshness — attached here (not by WebSourcingProvider itself)
    // for the exact same "warnings gets replaced wholesale by this
    // function's own list" reason as the two warnings above. A page being
    // reachable right now is never, by itself, evidence that a price/stock
    // fact this old is still accurate — see
    // NormalizedSourcingResult.sourceDateStatus's own comment.
    if (result.sourceDateStatus === 'unknown') {
      warnings.push(
        'This page reports no publication date — how old this information is cannot be determined, and its accessibility right now is not evidence that its price/stock details are still current.'
      );
    } else if (result.sourceDateStatus === 'invalid') {
      warnings.push(
        "This page reported a publication date that could not be reliably interpreted — treat its age as unknown, and its accessibility right now is not evidence that its price/stock details are still current."
      );
    }
  }

  // --- Known-cost uncertainty ---
  for (const factor of result.unknownCostFactors ?? []) {
    warnings.push(describeUnknownCostFactor(factor));
  }

  // --- Phase 6: additional factual risk signals — real gaps in what this
  // specific source reported, never a judgment call. Each fires only when
  // the corresponding field is genuinely absent from this result; never
  // conditioned on what the query asked for (these describe the LISTING's
  // own completeness, independent of the search).
  if (result.condition === undefined) {
    warnings.push('Item condition is not reported by this source.');
  }
  if (result.seller === undefined || (result.seller.feedbackScore === undefined && result.seller.feedbackPercentage === undefined)) {
    warnings.push('Seller reputation is not reported by this source.');
  }
  if (result.availability === undefined) {
    warnings.push('Stock availability is not reported by this source.');
  }

  return { matchReasons, warnings, excludedByPrice, excludedByColor, colorOutcome, sizeOutcome };
}

const AUTHENTICITY_RANK: Record<NormalizedSourcingResult['authenticityStatus'], number> = {
  verified: 0,
  claimed: 1,
  unverified: 2,
  unknown: 3,
};

/** Defined-first tie-break helper: 0 when `value` is defined, 1 when undefined — so `.sort` naturally puts the "known" side first without a magic-number scattered through compareByMatch. */
function definedFirst(value: unknown): 0 | 1 {
  return value !== undefined ? 0 : 1;
}

/**
 * Fixed, documented, multi-key comparator for NormalizedSearchQuery.sort
 * === 'match'. Never a single summed/weighted "score" — each tie-break
 * key is applied in this fixed order, matching the priority this Global
 * Sourcing Engine's own briefs (Phase 3, extended Phase 6) specify:
 *   1. more real constraint matches first (matchReasons.length, descending)
 *   2. a known landed cost before an unknown one, then ascending by it
 *   3. a known shipping cost before an unknown one (Phase 6)
 *   4. stronger authenticity evidence first (verified > claimed > unverified > unknown)
 *   5. a reported condition before none
 *   6. real seller evidence (a seller with a feedback score/percentage) before none (Phase 6)
 *   7. a computed margin preview before none (Phase 6 — only meaningfully
 *      differs when the caller supplied targetResalePrice, since that's
 *      the only way estimatedMargin is ever set)
 *   8. ascending normalizedPriceEur (undefined last)
 * Section 5 of the Phase 6 brief also lists "size/color match" — no
 * current provider ever returns size/color on a RESULT (only as SEARCH
 * INPUT filters folded into keywords, see NormalizedSearchQuery's own
 * comments), so there is no real per-result data to rank by; adding a
 * key for it would mean comparing two results that are always equal on
 * it, which is a no-op, not a real ranking signal — documented here
 * rather than silently omitted.
 */
export function compareByMatch(a: NormalizedSourcingResult, b: NormalizedSourcingResult): number {
  const matchDiff = (b.matchReasons?.length ?? 0) - (a.matchReasons?.length ?? 0);
  if (matchDiff !== 0) return matchDiff;

  const aKnownCost = a.estimatedKnownCostEur;
  const bKnownCost = b.estimatedKnownCostEur;
  if (aKnownCost === undefined && bKnownCost !== undefined) return 1;
  if (aKnownCost !== undefined && bKnownCost === undefined) return -1;
  if (aKnownCost !== undefined && bKnownCost !== undefined && aKnownCost !== bKnownCost) {
    return aKnownCost - bKnownCost;
  }

  const shippingDiff = definedFirst(a.shippingCost) - definedFirst(b.shippingCost);
  if (shippingDiff !== 0) return shippingDiff;

  const authenticityDiff = AUTHENTICITY_RANK[a.authenticityStatus] - AUTHENTICITY_RANK[b.authenticityStatus];
  if (authenticityDiff !== 0) return authenticityDiff;

  const conditionDiff = definedFirst(a.condition) - definedFirst(b.condition);
  if (conditionDiff !== 0) return conditionDiff;

  const aHasSellerEvidence = a.seller !== undefined && (a.seller.feedbackScore !== undefined || a.seller.feedbackPercentage !== undefined);
  const bHasSellerEvidence = b.seller !== undefined && (b.seller.feedbackScore !== undefined || b.seller.feedbackPercentage !== undefined);
  const sellerDiff = (aHasSellerEvidence ? 0 : 1) - (bHasSellerEvidence ? 0 : 1);
  if (sellerDiff !== 0) return sellerDiff;

  const marginDiff = definedFirst(a.estimatedMargin) - definedFirst(b.estimatedMargin);
  if (marginDiff !== 0) return marginDiff;

  if (a.normalizedPriceEur === undefined && b.normalizedPriceEur === undefined) return 0;
  if (a.normalizedPriceEur === undefined) return 1;
  if (b.normalizedPriceEur === undefined) return -1;
  return a.normalizedPriceEur - b.normalizedPriceEur;
}

/**
 * Deep Web Sourcing Engine (mission section 15) — a documented, testable
 * tier. `price`/`currency`/`title`/`sourceUrl` are all already guaranteed
 * present by construction for every NormalizedSourcingResult that exists
 * at all (no provider ever builds one without a confident price —
 * WebSourcingProvider drops a priceless offer before it ever reaches this
 * type), so this tier's real differentiator is how much of the REST of
 * the listing is actually known, never a guess layered on top of an
 * uncertain price.
 *
 * HIGH: availability known AND condition known AND (seller reputation
 *   known OR authenticity institutionally verified/claimed) — a
 *   well-documented listing.
 * MEDIUM: at least one of availability/condition is known, but not
 *   enough for HIGH.
 * LOW: neither availability nor condition is known, and there is no
 *   seller/authenticity signal either — a bare price and little else.
 *
 * Deep Web Sourcing Engine fix (mission section 5): a result extracted
 * from a CATEGORY_PAGE/SEARCH_PAGE/COLLECTION_PAGE with no distinct
 * `productUrl` of its own (the source link only opens the general
 * listing page, not this specific offer) can never reach HIGH, however
 * complete its other fields look — a well-documented row inside an
 * unresolved category page is still less trustworthy than a real,
 * direct product page. It is only ever capped down to MEDIUM, never
 * dropped by this function alone (see SourcingResultCard's existing
 * sharedSourcePage warning for the other half of this signal).
 */
export function classifyResultQuality(result: NormalizedSourcingResult): 'HIGH' | 'MEDIUM' | 'LOW' {
  const availabilityKnown = result.availability !== undefined;
  const conditionKnown = result.condition !== undefined;
  const sellerKnown = result.seller !== undefined && (result.seller.feedbackScore !== undefined || result.seller.feedbackPercentage !== undefined);
  const authenticityEvidence = result.authenticityStatus === 'verified' || result.authenticityStatus === 'claimed';

  let tier: 'HIGH' | 'MEDIUM' | 'LOW';
  if (availabilityKnown && conditionKnown && (sellerKnown || authenticityEvidence)) {
    tier = 'HIGH';
  } else if (availabilityKnown || conditionKnown) {
    tier = 'MEDIUM';
  } else {
    tier = 'LOW';
  }

  const fromUnresolvedListingPage =
    (result.pageType === 'CATEGORY_PAGE' || result.pageType === 'SEARCH_PAGE' || result.pageType === 'COLLECTION_PAGE') &&
    !result.productUrl;
  if (fromUnresolvedListingPage && tier === 'HIGH') {
    tier = 'MEDIUM';
  }

  return tier;
}

// Deliberately narrow, documented URL path patterns that reliably mean
// "this is a listing of several items, not one specific product" across
// the platforms this provider has actually seen — e.g. Etsy's own
// /market/<slug> browse pages (the real false positive this fix
// addresses), generic /collections//category(ies)//search//browse paths,
// or a query-string search (?q=...). This is a FALLBACK, consulted only
// when the LLM extraction itself reported pageType as 'UNKNOWN' (never
// overrides an explicit PRODUCT_PAGE classification) — see
// isUnresolvedListingPage below for exactly when it applies. Extend only
// with another real, verified listing-page URL convention, never a guess.
const LISTING_PAGE_URL_PATTERN = /\/(market|collections?|categor(?:y|ies)|search|browse|shop\/all)(?:[/?]|$)|[?&]q=/i;

/** Mechanical URL-path check only — never a claim about the page's actual content, which no one here has fetched. Returns false for an unparseable URL rather than guessing. */
export function isLikelyListingPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LISTING_PAGE_URL_PATTERN.test(parsed.pathname) || LISTING_PAGE_URL_PATTERN.test(parsed.search);
  } catch {
    return false;
  }
}

/**
 * Deep Web Sourcing Engine fix (mission: "une page catégorie/search/
 * brand/marketplace page qui ne fournit pas un productUrl direct doit
 * être exclue du résultat final"). Stronger than classifyResultQuality's
 * own MEDIUM-cap above: this is an outright exclusion, applied in
 * SourcingService BEFORE a result is kept at all.
 *
 * A result is an unresolved listing page when it has NO distinct
 * `productUrl` of its own AND EITHER:
 *   - the extraction itself classified pageType as CATEGORY_PAGE/
 *     SEARCH_PAGE/COLLECTION_PAGE (trust the model's own classification), OR
 *   - pageType came back UNKNOWN (or was never set) AND the result's own
 *     sourceUrl deterministically looks like a listing page by URL path
 *     (isLikelyListingPageUrl) — this is the real gap this fix closes:
 *     the extraction model mis-classified a real Etsy /market/... browse
 *     page as UNKNOWN instead of CATEGORY_PAGE, so relying on pageType
 *     alone let it through. The URL itself is real, provider-reported
 *     data, never guessed, so checking it is not an invented signal.
 *
 * A result the extraction explicitly classified as PRODUCT_PAGE is NEVER
 * excluded by this function even with no productUrl — its own sourceUrl
 * already IS the direct product link in that case (see
 * classifyResultQuality's own PRODUCT_PAGE test for the same rule applied
 * to quality tier).
 */
export function isUnresolvedListingPage(result: NormalizedSourcingResult): boolean {
  if (result.productUrl) return false;
  if (result.pageType === 'CATEGORY_PAGE' || result.pageType === 'SEARCH_PAGE' || result.pageType === 'COLLECTION_PAGE') return true;
  if ((result.pageType === undefined || result.pageType === 'UNKNOWN') && isLikelyListingPageUrl(result.sourceUrl)) return true;
  return false;
}

/**
 * Deep Web Sourcing Engine (mission section 14) — a transparent, additive
 * point total (clamped to [0, 100]) built ONLY from signals already real
 * on this result; never a claim of certain profitability.
 *
 * Deliberately NOT scored here (documented, not silently omitted):
 * "concurrence" (competition) — no provider/field in this codebase
 * reports how many other sellers list the same item.
 * "fraîcheur du résultat" (result freshness) — source freshness phase:
 * sourceDateStatus/sourcePublishedAt/sourcePublishedAgeDays now ARE
 * threaded through to NormalizedSourcingResult (see that type's own
 * comments, set by WebSourcingProvider/SourcingService), but are still
 * deliberately NOT folded into this additive score. Turning "how old is
 * this" into a point value would require a universal staleness threshold
 * (e.g. "more than N days is bad") applied the same way to every kind of
 * question — but how old is "too old" genuinely depends on what's being
 * asked (a typical-price question tolerates an old source; a
 * right-now-in-stock question does not), which this engine has no way to
 * know from the result alone. Imposing one fixed cutoff here would be
 * exactly the kind of invented business rule this mission's own rules
 * forbid — the real, raw signal is surfaced on the result instead, for
 * the Agent to reason about per the nature of the reseller's actual
 * question (see AiAgentService's own system prompt).
 */
export function computeOpportunityScore(result: NormalizedSourcingResult): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  const add = (points: number, label: string) => {
    score += points;
    factors.push(`${label} (${points >= 0 ? '+' : ''}${points})`);
  };

  if (result.estimatedMargin !== undefined && result.estimatedMarginPercent !== undefined) {
    add(25, 'Margin preview available');
  }
  if (result.estimatedKnownCostEur !== undefined) {
    add(15, 'Landed cost fully known');
  }
  if (result.shippingCost !== undefined) {
    add(10, 'Shipping cost known');
  }

  if (result.availability === 'OUT_OF_STOCK') {
    add(-20, 'Reported out of stock');
  } else if (result.availability === 'IN_STOCK') {
    add(10, 'Confirmed in stock');
  }

  if (result.authenticityStatus === 'verified') {
    add(15, 'Authenticity institutionally verified');
  } else if (result.authenticityStatus === 'claimed') {
    add(5, "Authenticity claimed by the seller (not verified)");
  }

  const qualityTier = classifyResultQuality(result);
  if (qualityTier === 'HIGH') {
    add(15, 'High listing completeness');
  } else if (qualityTier === 'MEDIUM') {
    add(5, 'Partial listing completeness');
  }

  const missingCostFactors = result.unknownCostFactors?.length ?? 0;
  if (missingCostFactors > 0) {
    add(-5 * missingCostFactors, `${missingCostFactors} unresolved cost factor(s)`);
  }

  return { score: Math.max(0, Math.min(100, score)), factors };
}

/**
 * Deep Web Sourcing Engine (mission section 13) — the ONE real
 * cross-validation check this engine performs: two results that
 * SourcingService.deduplicate() would otherwise treat as the exact same
 * offer (same provider+sourceId, or same sourceUrl when sourceId is
 * absent) but which report different prices. Returns the price
 * discrepancy only when one genuinely exists; this is never a live
 * re-fetch/second confirmation request — see NormalizedSourcingResult.
 * verificationStatus's own comment for exactly what this does and does
 * not mean.
 */
export function detectPriceConflict(
  a: NormalizedSourcingResult,
  b: NormalizedSourcingResult
): { conflicting: true; priceA: string; priceB: string } | { conflicting: false } {
  if (a.price === b.price && a.currency.toUpperCase() === b.currency.toUpperCase()) {
    return { conflicting: false };
  }
  return {
    conflicting: true,
    priceA: `${a.price} ${a.currency.toUpperCase()}`,
    priceB: `${b.price} ${b.currency.toUpperCase()}`,
  };
}

/**
 * Phase 2 (reliability of claims) — generalizes detectPriceConflict's own
 * "exact duplicate disagreeing on a real fact" check to the other fields
 * duplicate sources could genuinely disagree on: condition, availability,
 * and authenticity (both the institutional authenticityStatus and the
 * free-text authenticitySource claim). ONLY ever meant to be called by
 * SourcingService.deduplicate() on two results it has ALREADY identified
 * as the exact same offer (same provider+sourceId, or same sourceUrl when
 * sourceId is absent) — never a broader "looks similar" match (see
 * deduplicateWebResultsBySignal for that conservative-merge pass,
 * deliberately untouched by this function). Two different sellers, two
 * different variants, or two genuinely distinct listings are never
 * compared here at all — that identity decision belongs entirely to the
 * caller's own dedup key, not to this function.
 *
 * Absence is never a contradiction: an attribute where EITHER side has no
 * real signal (`condition`/`availability`/`authenticitySource` undefined,
 * or — for `authenticityStatus` specifically — 'unverified'/'unknown',
 * its own documented "no signal" values, see AuthenticityStatus's own
 * comment) is never flagged as conflicting with the other side; one
 * source simply not reporting a fact the other one does is normal,
 * asymmetric information, not a disagreement.
 *
 * Never decides which value is "correct" and never claims either source
 * is wrong — both real values are returned so the caller can name them
 * explicitly in a warning, exactly like detectPriceConflict already does
 * for price.
 */
export interface AttributeConflict {
  attribute: 'condition' | 'availability' | 'authenticityStatus' | 'authenticitySource';
  valueA: string;
  valueB: string;
}

/** 'unverified'/'unknown' are AuthenticityStatus's own documented "no real signal" values (see types.ts) — never treated as a real claim that could disagree with another source's real claim. */
const AUTHENTICITY_NO_SIGNAL: ReadonlySet<AuthenticityStatus> = new Set(['unverified', 'unknown']);

/** Case/whitespace-insensitive only — never a semantic interpretation of whether two different strings "really" mean the same thing (e.g. "used" vs "pre-owned" are left as a real, reportable difference, never silently equated). */
function normalizedStringsDiffer(a: string, b: string): boolean {
  return a.trim().toLowerCase() !== b.trim().toLowerCase();
}

export function detectAttributeConflicts(a: NormalizedSourcingResult, b: NormalizedSourcingResult): AttributeConflict[] {
  const conflicts: AttributeConflict[] = [];

  if (a.condition !== undefined && b.condition !== undefined && normalizedStringsDiffer(a.condition, b.condition)) {
    conflicts.push({ attribute: 'condition', valueA: a.condition, valueB: b.condition });
  }

  if (a.availability !== undefined && b.availability !== undefined && normalizedStringsDiffer(a.availability, b.availability)) {
    conflicts.push({ attribute: 'availability', valueA: a.availability, valueB: b.availability });
  }

  if (
    !AUTHENTICITY_NO_SIGNAL.has(a.authenticityStatus) &&
    !AUTHENTICITY_NO_SIGNAL.has(b.authenticityStatus) &&
    a.authenticityStatus !== b.authenticityStatus
  ) {
    conflicts.push({ attribute: 'authenticityStatus', valueA: a.authenticityStatus, valueB: b.authenticityStatus });
  }

  if (
    a.authenticitySource !== undefined &&
    b.authenticitySource !== undefined &&
    normalizedStringsDiffer(a.authenticitySource, b.authenticitySource)
  ) {
    conflicts.push({ attribute: 'authenticitySource', valueA: a.authenticitySource, valueB: b.authenticitySource });
  }

  return conflicts;
}

const ATTRIBUTE_CONFLICT_LABEL: Record<AttributeConflict['attribute'], string> = {
  condition: 'Condition conflict',
  availability: 'Availability conflict',
  authenticityStatus: 'Authenticity status conflict',
  authenticitySource: 'Authenticity claim conflict',
};

/** Mirrors detectPriceConflict's own warning phrasing exactly ("shown with the first value found; verify before relying on it") — never asserts which value is correct. */
export function formatAttributeConflictWarning(conflict: AttributeConflict): string {
  return `${ATTRIBUTE_CONFLICT_LABEL[conflict.attribute]}: this exact listing was reported as both "${conflict.valueA}" and "${conflict.valueB}" by duplicate sources — shown with the first value found; verify before relying on it.`;
}

/**
 * Opportunity Classification fix — the explicit tri-state the audit
 * asked for. 'REJECTED' is part of this type for conceptual completeness
 * (diagnostics/rejectedSamples reasoning, tests) but classifyOpportunity
 * itself NEVER returns it — a candidate SourcingService rejects outright
 * never reaches this function at all (see
 * NormalizedSourcingResult.classification's own comment for exactly why).
 */
export type OpportunityClassification = 'VERIFIED_OPPORTUNITY' | 'WEB_LEAD' | 'REJECTED';

/**
 * Opportunity Classification fix (mission section 1) — computed ONLY from
 * real signals already attached to this result/annotation; never an
 * automatic pass for `source !== 'web'` (an eBay/Etsy result with
 * qualityTier !== 'HIGH', a price conflict, or an unconfirmed requested
 * color/size is downgraded exactly like a web result would be). Downgrades
 * to WEB_LEAD, in order checked (first match wins — this is a gate, not a
 * weighted score):
 *   1. qualityTier !== 'HIGH' (see classifyResultQuality — already accounts
 *      for availability/condition/seller/authenticity completeness AND the
 *      unresolved-listing-page cap).
 *   2. verificationStatus === 'conflicting' (a real, detected price
 *      discrepancy between duplicate sources — see detectPriceConflict).
 *   3. A color was requested and the outcome is 'ambiguous' or 'unknown'
 *      (an INCOMPATIBLE color is never reached here at all — it was
 *      already excluded before classification, see
 *      ResultAnnotation.excludedByColor).
 *   4. A size was requested and the outcome is 'different' or 'absent'
 *      (never auto-rejected on size alone — see normalizeSizeForComparison's
 *      own comment on why — but never silently presented as VERIFIED either).
 * Returns 'VERIFIED_OPPORTUNITY' only when none of the above apply.
 */
export function classifyOpportunity(
  result: NormalizedSourcingResult,
  annotation: Pick<ResultAnnotation, 'colorOutcome' | 'sizeOutcome'>,
  qualityTier: 'HIGH' | 'MEDIUM' | 'LOW'
): Exclude<OpportunityClassification, 'REJECTED'> {
  if (qualityTier !== 'HIGH') return 'WEB_LEAD';
  if (result.verificationStatus === 'conflicting') return 'WEB_LEAD';
  if (annotation.colorOutcome === 'ambiguous' || annotation.colorOutcome === 'unknown') return 'WEB_LEAD';
  if (annotation.sizeOutcome === 'different' || annotation.sizeOutcome === 'absent') return 'WEB_LEAD';
  return 'VERIFIED_OPPORTUNITY';
}

/**
 * Web Sourcing smoke-test fix (section 3) — a concise, real explanation of
 * why classifyOpportunity returned 'WEB_LEAD' for this exact result,
 * mirroring that function's own gating conditions EXACTLY (same checks,
 * same order) so the two can never disagree. Derived only from signals
 * already real on `result`/`annotation` — never a new one, never
 * invented. Returns undefined when there is nothing to explain (the
 * result would classify as VERIFIED_OPPORTUNITY) — callers only need to
 * invoke this when classification is actually 'WEB_LEAD'.
 *
 * Deliberately a short label per factor (e.g. "availability not
 * confirmed"), not a restatement of the full warning sentences
 * annotateResult already produces — this is a compact "why", warnings
 * remain the detailed account.
 */
export function explainClassification(
  result: NormalizedSourcingResult,
  annotation: Pick<ResultAnnotation, 'colorOutcome' | 'sizeOutcome'>,
  qualityTier: 'HIGH' | 'MEDIUM' | 'LOW'
): string | undefined {
  const reasons: string[] = [];

  if (qualityTier !== 'HIGH') {
    const missing: string[] = [];
    if (result.availability === undefined) missing.push('availability not confirmed');
    if (result.condition === undefined) missing.push('condition not confirmed');
    const sellerKnown = result.seller !== undefined && (result.seller.feedbackScore !== undefined || result.seller.feedbackPercentage !== undefined);
    const authenticityEvidence = result.authenticityStatus === 'verified' || result.authenticityStatus === 'claimed';
    if (!sellerKnown && !authenticityEvidence) missing.push('seller/authenticity not confirmed');
    reasons.push(missing.length > 0 ? `listing quality is ${qualityTier} (${missing.join(', ')})` : `listing quality is ${qualityTier}`);
  }
  if (result.verificationStatus === 'conflicting') {
    reasons.push('a price conflict was detected between duplicate sources');
  }
  if (annotation.colorOutcome === 'ambiguous') {
    reasons.push('requested color only partially confirmed');
  } else if (annotation.colorOutcome === 'unknown') {
    reasons.push('requested color not confirmed by the source');
  }
  if (annotation.sizeOutcome === 'different') {
    reasons.push('reported size differs from the requested size');
  } else if (annotation.sizeOutcome === 'absent') {
    reasons.push('requested size not confirmed by the source');
  }

  return reasons.length > 0 ? reasons.join('; ') : undefined;
}

export const OpportunityRankingService = {
  annotateResult,
  compareByMatch,
  classifyResultQuality,
  computeOpportunityScore,
  detectPriceConflict,
  isLikelyListingPageUrl,
  isUnresolvedListingPage,
  normalizeColorTokens,
  compareColor,
  normalizeSizeForComparison,
  classifyOpportunity,
  explainClassification,
};

export default OpportunityRankingService;
