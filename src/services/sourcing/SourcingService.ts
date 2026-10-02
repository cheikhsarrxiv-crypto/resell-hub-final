import { createLogger } from '@/lib/logger';
import {
  NormalizedSearchQuery,
  NormalizedSourcingResult,
  SourcingSearchResponse,
  SourcingSearchDiagnostics,
} from './types';
import { SourcingProviderRegistry } from './SourcingProviderRegistry';
import { CurrencyConversionService } from '@/services/pricing/CurrencyConversionService';
import { PricingService } from '@/services/pricing/PricingService';
import {
  annotateResult,
  compareByMatch,
  classifyResultQuality,
  computeOpportunityScore,
  detectPriceConflict,
  ResolvedPriceBounds,
} from './OpportunityRankingService';

const logger = createLogger('sourcing-service');

/** Phase 3 — the OVERALL combined result count, distinct from any per-provider page size. See balanceByProvider. */
const DEFAULT_OVERALL_LIMIT = 20;

/**
 * Global Sourcing Engine — conservative deduplication only: two results
 * are the same opportunity only when they share the exact same
 * (provider, sourceId), or, when sourceId is missing, the exact same
 * sourceUrl. Never a fuzzy title/brand match — two different sourceIds
 * (or two different providers) are always two different annonces, even
 * if they look identical, per the standing provenance decision (see
 * ProductService/Product.sourceMarketplace+sourceId's own uniqueness
 * rule). The first occurrence wins; later duplicates are dropped.
 */
function deduplicate(results: NormalizedSourcingResult[]): NormalizedSourcingResult[] {
  const seen = new Map<string, NormalizedSourcingResult>();
  const order: string[] = [];

  for (const result of results) {
    const key = result.sourceId
      ? `id:${result.source}:${result.sourceId}`
      : `url:${result.sourceUrl}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, result);
      order.push(key);
      continue;
    }

    // Deep Web Sourcing Engine (mission section 13) — a real duplicate
    // (same provider+sourceId, or same sourceUrl) that disagrees on price
    // is never silently resolved by keeping whichever came first with no
    // trace of the discrepancy. The survivor is flagged 'conflicting' and
    // a warning names both real amounts — see
    // NormalizedSourcingResult.verificationStatus's own comment for why
    // this is the one, narrow case this engine actually sets it.
    const conflict = detectPriceConflict(existing, result);
    if (conflict.conflicting) {
      seen.set(key, {
        ...existing,
        verificationStatus: 'conflicting',
        warnings: [
          ...(existing.warnings ?? []),
          `Price conflict: this exact listing was reported as both ${conflict.priceA} and ${conflict.priceB} by duplicate sources — shown with the first price found; verify before relying on it.`,
        ],
      });
    }
  }

  return order.map((key) => seen.get(key)!);
}

/**
 * Deep Web Sourcing Engine (mission section 11) — a SECOND, narrower
 * dedup pass applied ONLY to `source === 'web'` results (the only
 * provider with no stable sourceId/sourceUrl-per-offer guarantee across
 * different pages — eBay/Etsy already dedup correctly on real IDs via
 * `deduplicate` above and are never touched here).
 *
 * Two web results are treated as the same real offer only when EVERY one
 * of these matches: normalized `marketplace`, normalized `brand`, `price`,
 * `currency` (case-insensitive), AND `size` — but `size` must be
 * EXACTLY equal (including "both undefined"); one result having a size
 * and the other not is NEVER treated as a match (could easily be two
 * different items). The same guard applies to `seller.name`: both must
 * be either equal or both undefined — two different named sellers (or a
 * named seller vs. an unknown one) are NEVER merged. This is deliberately
 * conservative — the mission's own warning against merging two really
 * distinct offers (different sizes, different sellers) is enforced as a
 * hard precondition, not a tiebreak.
 */
function deduplicateWebResultsBySignal(results: NormalizedSourcingResult[]): NormalizedSourcingResult[] {
  const webSignalKey = (r: NormalizedSourcingResult): string | null => {
    if (r.source !== 'web' || !r.brand) return null;
    return [
      r.marketplace.toLowerCase(),
      r.brand.toLowerCase().trim(),
      r.price,
      r.currency.toUpperCase(),
      r.size?.toLowerCase().trim() ?? '\u0000no-size',
      r.seller?.name?.toLowerCase().trim() ?? '\u0000no-seller',
    ].join('|');
  };

  const seen = new Set<string>();
  const deduped: NormalizedSourcingResult[] = [];

  for (const result of results) {
    const key = webSignalKey(result);
    if (key === null) {
      // Not eligible for this pass at all (not a 'web' result, or no
      // brand to anchor the comparison on) — always kept.
      deduped.push(result);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

/**
 * Global Sourcing Engine — attaches `normalizedPriceEur` via the real
 * CurrencyConversionService (never a made-up rate). A result whose
 * conversion is 'unavailable' keeps `normalizedPriceEur` undefined; its
 * original `price`/`currency` are never altered. Conversion failures for
 * one result never fail the whole search — logged and left undefined.
 */
async function attachNormalizedPrice(result: NormalizedSourcingResult): Promise<NormalizedSourcingResult> {
  try {
    const conversion = await CurrencyConversionService.convert(result.price, result.currency, 'EUR');
    if (conversion.amount === null) {
      return result;
    }
    return { ...result, normalizedPriceEur: conversion.amount };
  } catch (error) {
    logger.error(
      `Currency conversion failed for a sourcing result from "${result.source}"`,
      error instanceof Error ? error : String(error)
    );
    return result;
  }
}

function pushUnique(list: string[], value: string): string[] {
  return list.includes(value) ? list : [...list, value];
}

/**
 * Phase 2/3 — attaches `estimatedKnownCostEur`: the sum, in EUR, of every
 * cost line ADKSY actually has a real amount for (price + shippingCost +
 * each knownAdditionalCosts entry). Requires normalizedPriceEur to
 * already be set (attachNormalizedPrice must run first) — without a
 * converted price there is nothing real to build a landed cost from.
 *
 * Phase 3 tightened rule: a shippingCost that was never reported at all
 * (undefined) now blocks the total exactly like a failed conversion would
 * — it is pushed into `unknownCostFactors` as 'shipping_unknown' rather
 * than silently treated as "nothing to add". A real reported shippingCost
 * of 0 (free shipping) is unaffected — it's a known value, not missing.
 * `knownAdditionalCosts` keeps its Phase 2 treatment: it's an open-ended,
 * optional list of whatever extra fees a provider DID report — an empty
 * list means "nothing else was reported", not "something is being
 * hidden", so it never blocks the total by itself; a failed conversion of
 * an entry that IS present still blocks it (as 'currency_conversion_unavailable').
 */
async function attachLandedCost(result: NormalizedSourcingResult): Promise<NormalizedSourcingResult> {
  if (result.normalizedPriceEur === undefined) {
    return result;
  }

  let total = result.normalizedPriceEur;
  let blocked = false;
  let unknownCostFactors = result.unknownCostFactors ?? [];
  // Phase 6 — exposed as their OWN fields, independent of whether the
  // combined estimatedKnownCostEur ends up blocked for an unrelated
  // reason (e.g. shipping known but a knownAdditionalCosts line fails to
  // convert) — a real, converted shipping figure should still be shown
  // even when the overall total can't be.
  let shippingCostEur: number | undefined;
  let knownAdditionalCostsEur: number | undefined;

  try {
    if (result.shippingCost === undefined) {
      unknownCostFactors = pushUnique(unknownCostFactors, 'shipping_unknown');
      blocked = true;
    } else if (result.shippingCostCurrency) {
      const conversion = await CurrencyConversionService.convert(result.shippingCost, result.shippingCostCurrency, 'EUR');
      if (conversion.amount === null) {
        unknownCostFactors = pushUnique(unknownCostFactors, 'currency_conversion_unavailable');
        blocked = true;
      } else {
        shippingCostEur = conversion.amount;
        total += conversion.amount;
      }
    }

    if (result.knownAdditionalCosts && result.knownAdditionalCosts.length > 0) {
      let additionalTotal = 0;
      let additionalFullyKnown = true;
      for (const cost of result.knownAdditionalCosts) {
        const conversion = await CurrencyConversionService.convert(cost.amount, cost.currency, 'EUR');
        if (conversion.amount === null) {
          unknownCostFactors = pushUnique(unknownCostFactors, 'currency_conversion_unavailable');
          blocked = true;
          additionalFullyKnown = false;
        } else {
          additionalTotal += conversion.amount;
          total += conversion.amount;
        }
      }
      if (additionalFullyKnown) knownAdditionalCostsEur = additionalTotal;
    }
  } catch (error) {
    logger.error(
      `Landed cost conversion failed for a sourcing result from "${result.source}"`,
      error instanceof Error ? error : String(error)
    );
    return {
      ...result,
      unknownCostFactors: unknownCostFactors.length > 0 ? unknownCostFactors : result.unknownCostFactors,
      shippingCostEur,
      knownAdditionalCostsEur,
    };
  }

  if (blocked) {
    return {
      ...result,
      unknownCostFactors: unknownCostFactors.length > 0 ? unknownCostFactors : undefined,
      shippingCostEur,
      knownAdditionalCostsEur,
    };
  }

  return { ...result, estimatedKnownCostEur: total, shippingCostEur, knownAdditionalCostsEur };
}

/**
 * Phase 3 — resolves NormalizedSearchQuery.minPrice/maxPrice into a
 * single, real EUR range, ONCE per search (never per result, never a
 * per-item guess). `requested: false` when no bound was given at all —
 * OpportunityRankingService.annotateResult then does nothing price-bound
 * related. `unresolvable: true` means a bound WAS requested but no
 * reliable rate converted it — every result's price comparison is then
 * marked uncertain, NEVER silently included or excluded on a guess.
 */
async function resolvePriceBoundsEur(query: NormalizedSearchQuery): Promise<ResolvedPriceBounds> {
  if (query.minPrice === undefined && query.maxPrice === undefined) {
    return { requested: false, unresolvable: false };
  }

  const currency = query.currency ?? 'EUR';

  const convertBound = async (amount: number | undefined): Promise<{ ok: boolean; value?: number }> => {
    if (amount === undefined) return { ok: true, value: undefined };
    const conversion = await CurrencyConversionService.convert(amount, currency, 'EUR');
    if (conversion.amount === null) return { ok: false };
    return { ok: true, value: conversion.amount };
  };

  const [min, max] = await Promise.all([convertBound(query.minPrice), convertBound(query.maxPrice)]);

  if (!min.ok || !max.ok) {
    return { requested: true, unresolvable: true };
  }

  return { requested: true, unresolvable: false, minEur: min.value, maxEur: max.value };
}

/**
 * Phase 3 — a real margin PREVIEW via the SAME PricingService engine
 * calculate_margin uses (PricingService.fromSourcingResult +
 * PricingService.calculateMargin) — never a second, duplicated formula.
 * Deliberately requires estimatedKnownCostEur to already be attached
 * (attachLandedCost must run first): PricingService itself already
 * re-derives cost lines from the result's own price/shippingCost, so this
 * is just gating on "do we even have a usable cost picture for this
 * result" before spending a calculation on it. Never invents a resale
 * price — only runs at all when NormalizedSearchQuery.targetResalePrice
 * is set. No marketplace selling fee is included (no marketplace has
 * been chosen yet at sourcing time) — see NormalizedSourcingResult's own
 * comment on estimatedMargin for exactly why this differs from
 * calculate_margin's own number.
 */
async function attachMargin(result: NormalizedSourcingResult, query: NormalizedSearchQuery): Promise<NormalizedSourcingResult> {
  if (query.targetResalePrice === undefined || result.estimatedKnownCostEur === undefined) {
    return result;
  }

  try {
    const marginInput = PricingService.fromSourcingResult(result, {
      targetCurrency: 'EUR',
      resalePrice: query.targetResalePrice,
      resaleCurrency: query.currency ?? 'EUR',
    });
    const marginResult = await PricingService.calculateMargin(marginInput);

    if (marginResult.marginAmount === null || marginResult.marginPercent === null) {
      return result;
    }

    return {
      ...result,
      estimatedMargin: marginResult.marginAmount,
      estimatedMarginPercent: marginResult.marginPercent,
      // Phase 6 — echoed only alongside a real computed margin, so a
      // reader never has to cross-reference the original query to know
      // what estimatedMargin was measured against.
      targetResalePrice: query.targetResalePrice,
    };
  } catch (error) {
    logger.error(
      `Margin preview failed for a sourcing result from "${result.source}"`,
      error instanceof Error ? error : String(error)
    );
    return result;
  }
}

/**
 * Phase 3 — deterministic final ordering, dispatched from
 * NormalizedSearchQuery.sort. Default ('normalized_price_asc') is
 * unchanged from Phase 2's own behavior. Never an opaque relevance score
 * — see OpportunityRankingService.compareByMatch for exactly what 'match'
 * means.
 */
function sortResults(results: NormalizedSourcingResult[], sort: NormalizedSearchQuery['sort']): NormalizedSourcingResult[] {
  const sorted = [...results];

  switch (sort) {
    case 'price_asc':
      return sorted.sort((a, b) => a.price - b.price);
    case 'price_desc':
      return sorted.sort((a, b) => b.price - a.price);
    case 'known_cost_asc':
      return sorted.sort((a, b) => {
        if (a.estimatedKnownCostEur === undefined && b.estimatedKnownCostEur === undefined) return 0;
        if (a.estimatedKnownCostEur === undefined) return 1;
        if (b.estimatedKnownCostEur === undefined) return -1;
        return a.estimatedKnownCostEur - b.estimatedKnownCostEur;
      });
    case 'match':
      return sorted.sort(compareByMatch);
    case 'opportunity_score':
      // Deep Web Sourcing Engine — descending by the real, documented
      // OpportunityRankingService.computeOpportunityScore total,
      // undefined last (never treated as 0 — a result without a score
      // is "not scored", not "scored lowest").
      return sorted.sort((a, b) => {
        if (a.opportunityScore === undefined && b.opportunityScore === undefined) return 0;
        if (a.opportunityScore === undefined) return 1;
        if (b.opportunityScore === undefined) return -1;
        return b.opportunityScore - a.opportunityScore;
      });
    case 'normalized_price_asc':
    default:
      return sorted.sort((a, b) => {
        if (a.normalizedPriceEur === undefined && b.normalizedPriceEur === undefined) return 0;
        if (a.normalizedPriceEur === undefined) return 1;
        if (b.normalizedPriceEur === undefined) return -1;
        return a.normalizedPriceEur - b.normalizedPriceEur;
      });
  }
}

/**
 * Phase 3 — "provider fairness" (section 14 of the brief): when combined
 * results exceed the requested overall `limit`, a round-robin selection
 * across the PROVIDERS that actually contributed results guarantees no
 * single provider can claim every kept slot purely by having returned
 * more raw candidates than another. This runs BEFORE the final sort (so
 * the caller's requested sort order still decides final display order) —
 * it only decides WHICH results survive the cap, never their order.
 * Never an invented per-provider weight: every contributing provider gets
 * an equal turn in the round-robin, in the order results were pushed
 * (i.e., roughly each provider's own best-priced items, since dedup runs
 * before this and providers already return their own results in a
 * reasonable order).
 */
function balanceByProvider(results: NormalizedSourcingResult[], limit: number): NormalizedSourcingResult[] {
  if (results.length <= limit) return results;

  const byProvider = new Map<string, NormalizedSourcingResult[]>();
  for (const result of results) {
    const bucket = byProvider.get(result.source);
    if (bucket) bucket.push(result);
    else byProvider.set(result.source, [result]);
  }

  const queues = Array.from(byProvider.values());
  const balanced: NormalizedSourcingResult[] = [];
  let index = 0;
  while (balanced.length < limit) {
    const queue = queues[index % queues.length];
    if (queue.length > 0) balanced.push(queue.shift()!);
    index++;
    if (queues.every((q) => q.length === 0)) break;
  }

  return balanced;
}

export class SourcingService {
  /**
   * Queries every configured provider for the given normalized query,
   * normalizes and aggregates their results, and never fabricates a
   * result a provider didn't actually return.
   *
   * - No provider configured at all -> status: 'SOURCE_NOT_CONFIGURED',
   *   empty results. The caller (the search_products tool) must surface
   *   this plainly, never substitute a fake opportunity.
   * - A configured provider's call fails -> its error is recorded in
   *   providerErrors and the search continues with whatever other
   *   providers returned; the failure is never silently swallowed.
   * - Global Sourcing Engine: results are deduplicated (conservative,
   *   exact-identifier only), sorted by real normalizedPriceEur (when
   *   available), and each carries a real, honestly-sourced
   *   normalizedPriceEur/estimatedKnownCostEur when a rate was available.
   *   providersSearched/providersFailed/providersUnavailable/
   *   providersSkipped give the agent real, structured provenance of the
   *   search itself, so it never claims to have searched a source it
   *   didn't actually query.
   * - Phase 2: query.providers, when set, restricts which CONFIGURED
   *   providers are actually queried (see types.ts).
   * - Phase 3: results carry real matchReasons/warnings, a result whose
   *   price is confidently outside a requested [minPrice, maxPrice] (in
   *   EUR) is excluded (never one whose price comparison is merely
   *   uncertain), a margin preview is attached when targetResalePrice is
   *   given, the combined set is fairly balanced across providers before
   *   being capped at the requested limit, and providerLatencyMs reports
   *   real per-provider timing.
   */
  static async search(query: NormalizedSearchQuery): Promise<SourcingSearchResponse> {
    const allProviders = SourcingProviderRegistry.getAllProviders();
    const configuredProviders = allProviders.filter((provider) => provider.isConfigured());
    const providersUnavailable = allProviders
      .filter((provider) => !provider.isConfigured())
      .map((provider) => provider.name);

    const providerAllowlist = query.providers;
    const selectedProviders = providerAllowlist
      ? configuredProviders.filter((provider) => providerAllowlist.includes(provider.name))
      : configuredProviders;
    const providersSkipped = providerAllowlist
      ? configuredProviders
          .filter((provider) => !providerAllowlist.includes(provider.name))
          .map((provider) => provider.name)
      : [];

    const emptyDiagnostics: SourcingSearchDiagnostics = {
      rawResultsBeforeFiltering: 0,
      excludedByDeduplication: 0,
      excludedByPriceBound: 0,
      excludedByMinQuality: 0,
      excludedByOverallLimit: 0,
    };

    if (configuredProviders.length === 0) {
      logger.info('No sourcing provider is configured', { query: query.query });
      return {
        status: 'SOURCE_NOT_CONFIGURED',
        results: [],
        providerErrors: [],
        providersSearched: [],
        providersFailed: [],
        providersUnavailable,
        providersSkipped: [],
        totalResults: 0,
        providerLatencyMs: {},
        diagnostics: emptyDiagnostics,
      };
    }

    const searchStartedAt = Date.now();
    const rawResults: NormalizedSourcingResult[] = [];
    const providerErrors: SourcingSearchResponse['providerErrors'] = [];
    const providersSearched: string[] = [];
    const providersFailed: string[] = [];
    const providerLatencyMs: Record<string, number> = {};

    // Concurrent, bounded to exactly the providers actually selected for
    // this search (never unbounded — the provider set itself is the only
    // fan-out, no per-provider pagination loop happens here). One
    // provider's failure/timeout never blocks another's result from
    // coming back (each promise is independently caught below).
    await Promise.all(
      selectedProviders.map(async (provider) => {
        providersSearched.push(provider.name);
        const startedAt = Date.now();
        try {
          const outcome = await provider.searchProducts(query);
          providerLatencyMs[provider.name] = Date.now() - startedAt;
          rawResults.push(...outcome.results);
          if (outcome.error) {
            providerErrors.push(outcome.error);
            providersFailed.push(provider.name);
          }
        } catch (error) {
          providerLatencyMs[provider.name] = Date.now() - startedAt;
          // A provider is expected to catch its own errors (including a
          // timeout) and return them via SourcingProviderSearchOutcome.error
          // — this catch is a defensive backstop against a provider bug,
          // not the normal path, so it's logged distinctly.
          logger.error(
            `Sourcing provider "${provider.name}" threw instead of returning a structured error`,
            error instanceof Error ? error : String(error)
          );
          providerErrors.push({ provider: provider.name, message: 'Provider failed unexpectedly', kind: 'unknown' });
          providersFailed.push(provider.name);
        }
      })
    );

    const deduped = deduplicate(rawResults);
    // Deep Web Sourcing Engine (mission section 11) — a second, narrower
    // dedup pass for 'web' results only (see this function's own
    // comment); eBay/Etsy results already deduped above are never
    // touched again here.
    const webDeduped = deduplicateWebResultsBySignal(deduped);
    const withPrice = await Promise.all(webDeduped.map((result) => attachNormalizedPrice(result)));
    const withLandedCost = await Promise.all(withPrice.map((result) => attachLandedCost(result)));
    const withMargin = await Promise.all(withLandedCost.map((result) => attachMargin(result, query)));

    const priceBounds = await resolvePriceBoundsEur(query);
    const qualityRank: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const kept: NormalizedSourcingResult[] = [];
    let excludedByPriceBound = 0;
    let excludedByMinQuality = 0;
    for (const result of withMargin) {
      const { matchReasons, warnings: annotatedWarnings, excludedByPrice } = annotateResult(result, query, priceBounds);
      if (excludedByPrice) {
        excludedByPriceBound++;
        continue;
      }

      // Deep Web Sourcing Engine (mission sections 14/15) — real,
      // documented, additive signals computed from this result's own
      // already-real fields; never used to silently drop a result on
      // their own (only an explicit NormalizedSearchQuery.minQuality
      // opt-in, right below, ever excludes on quality).
      const qualityTier = classifyResultQuality(result);
      const { score: opportunityScore, factors: scoreFactors } = computeOpportunityScore(result);

      if (query.minQuality && qualityRank[qualityTier] < qualityRank[query.minQuality]) {
        excludedByMinQuality++;
        continue;
      }

      // Merge (never replace) — a pre-existing warning (today, only ever
      // the price-conflict warning deduplicate() may have set) is kept
      // alongside annotateResult's own freshly computed ones, never
      // silently dropped.
      const warnings = [...(result.warnings ?? []), ...annotatedWarnings];
      kept.push({ ...result, matchReasons, warnings, qualityTier, opportunityScore, scoreFactors });
    }

    const overallLimit = query.limit ?? DEFAULT_OVERALL_LIMIT;
    const balanced = balanceByProvider(kept, overallLimit);
    const results = sortResults(balanced, query.sort);

    const diagnostics: SourcingSearchDiagnostics = {
      rawResultsBeforeFiltering: rawResults.length,
      excludedByDeduplication: rawResults.length - webDeduped.length,
      excludedByPriceBound,
      excludedByMinQuality,
      excludedByOverallLimit: kept.length - balanced.length,
    };

    // Deep Web Sourcing Engine (mission section 19) — one structured
    // observability line per search, real counts only, never a secret
    // (no API key/token is ever part of this object).
    logger.info('Sourcing search completed', {
      query: query.query,
      deepSearch: query.deepSearch === true,
      providersSearched,
      providersFailed,
      durationMs: Date.now() - searchStartedAt,
      ...diagnostics,
      finalResultCount: results.length,
    });

    return {
      status: 'ok',
      results,
      providerErrors,
      providersSearched,
      providersFailed,
      providersUnavailable,
      providersSkipped,
      totalResults: results.length,
      providerLatencyMs,
      diagnostics,
    };
  }
}

export default SourcingService;
