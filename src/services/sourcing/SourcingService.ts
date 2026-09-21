import { createLogger } from '@/lib/logger';
import {
  NormalizedSearchQuery,
  NormalizedSourcingResult,
  SourcingProvider,
  SourcingSearchResponse,
} from './types';
import { EbayBrowseSourcingProvider } from './providers/EbayBrowseSourcingProvider';
import { CurrencyConversionService } from '@/services/pricing/CurrencyConversionService';

const logger = createLogger('sourcing-service');

/**
 * Every provider ADKSY knows about, real or not-yet-configured. Adding a
 * provider means adding one entry here — SourcingService itself never
 * changes. A provider whose credentials aren't set (isConfigured() ===
 * false) is simply skipped, not removed from this list — see
 * search()'s SOURCE_NOT_CONFIGURED handling below.
 */
function getAllProviders(): SourcingProvider[] {
  return [new EbayBrowseSourcingProvider()];
}

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
   *   exact-identifier only) and each carries a real, honestly-sourced
   *   normalizedPriceEur when a rate was available. providersSearched/
   *   providersFailed/providersUnavailable give the agent real,
   *   structured provenance of the search itself, so it never claims to
   *   have searched a source it didn't actually query.
   */
  static async search(query: NormalizedSearchQuery): Promise<SourcingSearchResponse> {
    const allProviders = getAllProviders();
    const configuredProviders = allProviders.filter((provider) => provider.isConfigured());
    const providersUnavailable = allProviders
      .filter((provider) => !provider.isConfigured())
      .map((provider) => provider.name);

    if (configuredProviders.length === 0) {
      logger.info('No sourcing provider is configured', { query: query.query });
      return {
        status: 'SOURCE_NOT_CONFIGURED',
        results: [],
        providerErrors: [],
        providersSearched: [],
        providersFailed: [],
        providersUnavailable,
        totalResults: 0,
      };
    }

    const rawResults: NormalizedSourcingResult[] = [];
    const providerErrors: SourcingSearchResponse['providerErrors'] = [];
    const providersSearched: string[] = [];
    const providersFailed: string[] = [];

    await Promise.all(
      configuredProviders.map(async (provider) => {
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
    const results = await Promise.all(deduped.map((result) => attachNormalizedPrice(result)));

    return {
      status: 'ok',
      results,
      providerErrors,
      providersSearched,
      providersFailed,
      providersUnavailable,
      totalResults: results.length,
    };
  }
}

export default SourcingService;
