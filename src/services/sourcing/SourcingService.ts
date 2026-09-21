import { createLogger } from '@/lib/logger';
import {
  NormalizedSearchQuery,
  NormalizedSourcingResult,
  SourcingSearchResponse,
} from './types';
import { SourcingProviderRegistry } from './SourcingProviderRegistry';
import { CurrencyConversionService } from '@/services/pricing/CurrencyConversionService';

const logger = createLogger('sourcing-service');

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

/**
 * Phase 2 — attaches `estimatedKnownCostEur`: the sum, in EUR, of every
 * cost line ADKSY actually has a real amount for (price + shippingCost +
 * each knownAdditionalCosts entry). Requires normalizedPriceEur to
 * already be set (attachNormalizedPrice must run first) — without a
 * converted price there is nothing real to build a landed cost from.
 * Never a partial/misleading sum: if ANY present cost line fails to
 * convert, `estimatedKnownCostEur` stays undefined entirely, rather than
 * silently omitting just that one line from the total.
 */
async function attachLandedCost(result: NormalizedSourcingResult): Promise<NormalizedSourcingResult> {
  if (result.normalizedPriceEur === undefined) {
    return result;
  }

  let total = result.normalizedPriceEur;

  try {
    if (result.shippingCost !== undefined && result.shippingCostCurrency) {
      const conversion = await CurrencyConversionService.convert(result.shippingCost, result.shippingCostCurrency, 'EUR');
      if (conversion.amount === null) return result;
      total += conversion.amount;
    }

    if (result.knownAdditionalCosts && result.knownAdditionalCosts.length > 0) {
      for (const cost of result.knownAdditionalCosts) {
        const conversion = await CurrencyConversionService.convert(cost.amount, cost.currency, 'EUR');
        if (conversion.amount === null) return result;
        total += conversion.amount;
      }
    }
  } catch (error) {
    logger.error(
      `Landed cost conversion failed for a sourcing result from "${result.source}"`,
      error instanceof Error ? error : String(error)
    );
    return result;
  }

  return { ...result, estimatedKnownCostEur: total };
}

/**
 * Phase 2 — orders combined, multi-provider results by real, comparable
 * price (normalizedPriceEur), ascending, so "moins de 400€, peu importe
 * le pays" style queries actually read as a price comparison across
 * sources. A result with no available EUR rate is never guessed into a
 * position — it's placed after every result that does have one (stable
 * order preserved otherwise), never dropped.
 */
function sortByNormalizedPrice(results: NormalizedSourcingResult[]): NormalizedSourcingResult[] {
  return [...results].sort((a, b) => {
    if (a.normalizedPriceEur === undefined && b.normalizedPriceEur === undefined) return 0;
    if (a.normalizedPriceEur === undefined) return 1;
    if (b.normalizedPriceEur === undefined) return -1;
    return a.normalizedPriceEur - b.normalizedPriceEur;
  });
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
   *   providers are actually queried (see types.ts) — everything else is
   *   unchanged from Phase 1.
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
      };
    }

    const rawResults: NormalizedSourcingResult[] = [];
    const providerErrors: SourcingSearchResponse['providerErrors'] = [];
    const providersSearched: string[] = [];
    const providersFailed: string[] = [];

    await Promise.all(
      selectedProviders.map(async (provider) => {
        providersSearched.push(provider.name);
        try {
          const outcome = await provider.searchProducts(query);
          rawResults.push(...outcome.results);
          if (outcome.error) {
            providerErrors.push(outcome.error);
            providersFailed.push(provider.name);
          }
        } catch (error) {
          // A provider is expected to catch its own errors and return
          // them via SourcingProviderSearchOutcome.error — this catch is
          // a defensive backstop against a provider bug, not the normal
          // path, so it's logged distinctly.
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
    const results = sortByNormalizedPrice(withLandedCost);

    return {
      status: 'ok',
      results,
      providerErrors,
      providersSearched,
      providersFailed,
      providersUnavailable,
      providersSkipped,
      totalResults: results.length,
    };
  }
}

export default SourcingService;
