import { createLogger } from '@/lib/logger';
import {
  NormalizedSearchQuery,
  NormalizedSourcingResult,
  SourcingSearchResponse,
} from './types';
import { SourcingProviderRegistry } from './SourcingProviderRegistry';
import { CurrencyConversionService } from '@/services/pricing/CurrencyConversionService';
import { PricingService } from '@/services/pricing/PricingService';
import { annotateResult, compareByMatch, ResolvedPriceBounds } from './OpportunityRankingService';

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
  const seen = new Set<string>();
  const deduped: NormalizedSourcingResult[] = [];

  for (const result of results) {
    const key = result.sourceId
      ? `id:${result.source}:${result.sourceId}`
      : `url:${result.sourceUrl}`;

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
        total += conversion.amount;
      }
    }

    for (const cost of result.knownAdditionalCosts ?? []) {
      const conversion = await CurrencyConversionService.convert(cost.amount, cost.currency, 'EUR');
      if (conversion.amount === null) {
        unknownCostFactors = pushUnique(unknownCostFactors, 'currency_conversion_unavailable');
        blocked = true;
      } else {
        total += conversion.amount;
      }
    }
  } catch (error) {
    logger.error(
      `Landed cost conversion failed for a sourcing result from "${result.source}"`,
      error instanceof Error ? error : String(error)
    );
    return { ...result, unknownCostFactors: unknownCostFactors.length > 0 ? unknownCostFactors : result.unknownCostFactors };
  }

  if (blocked) {
    return { ...result, unknownCostFactors: unknownCostFactors.length > 0 ? unknownCostFactors : undefined };
  }

  return { ...result, estimatedKnownCostEur: total };
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

    return { ...result, estimatedMargin: marginResult.marginAmount, estimatedMarginPercent: marginResult.marginPercent };
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
      };
    }

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
    const withPrice = await Promise.all(deduped.map((result) => attachNormalizedPrice(result)));
    const withLandedCost = await Promise.all(withPrice.map((result) => attachLandedCost(result)));
    const withMargin = await Promise.all(withLandedCost.map((result) => attachMargin(result, query)));

    const priceBounds = await resolvePriceBoundsEur(query);
    const kept: NormalizedSourcingResult[] = [];
    for (const result of withMargin) {
      const { matchReasons, warnings, excludedByPrice } = annotateResult(result, query, priceBounds);
      if (excludedByPrice) continue;
      kept.push({ ...result, matchReasons, warnings });
    }

    const overallLimit = query.limit ?? DEFAULT_OVERALL_LIMIT;
    const balanced = balanceByProvider(kept, overallLimit);
    const results = sortResults(balanced, query.sort);

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
    };
  }
}

export default SourcingService;
