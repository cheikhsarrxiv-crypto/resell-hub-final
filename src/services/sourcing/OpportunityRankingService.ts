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
import { NormalizedSearchQuery, NormalizedSourcingResult } from './types';

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
   * True only when this result's own normalizedPriceEur is confidently
   * known AND confidently outside the requested [minEur, maxEur] range —
   * SourcingService excludes it entirely in that case. A result whose
   * price comparison is uncertain is NEVER excluded on that basis alone.
   */
  excludedByPrice: boolean;
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

  // --- Price bounds (Phase 3 "robust price filtering") ---
  if (priceBounds.requested) {
    if (priceBounds.unresolvable) {
      warnings.push('Price comparison against the requested price range is uncertain — no reliable exchange rate was available to convert it to EUR.');
    } else if (result.normalizedPriceEur === undefined) {
      warnings.push(`Price comparison is uncertain — no reliable exchange rate was available to convert this listing's price (${result.currency}) to EUR.`);
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

  return { matchReasons, warnings, excludedByPrice };
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

export const OpportunityRankingService = {
  annotateResult,
  compareByMatch,
};

export default OpportunityRankingService;
