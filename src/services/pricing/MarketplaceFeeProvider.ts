/**
 * MarketplaceFeeProvider — per-marketplace fee schedule, deliberately
 * separate from PricingService so eBay/Etsy/Vinted/Depop/Vestiaire can
 * each have their own (very different) real fee structure later without
 * PricingService's math changing.
 *
 * NO REAL FEE SCHEDULE IS HARDCODED HERE. eBay/Etsy/Vinted/Depop final
 * value fees change over time, vary by category, and were not verified
 * against current official rate cards in this step — hardcoding a
 * percentage would be exactly the "marketplace-specific fee without a
 * source" the brief forbids. A marketplace with no configured fee
 * returns null (not zero, not a guess) — PricingService then reports it
 * as missing data rather than silently omitting or fabricating it.
 *
 * Real rates can be supplied later via MARKETPLACE_FEE_CONFIG (an
 * operator-provided env var, e.g. sourced from each marketplace's own
 * published seller fee page) without any code change here beyond
 * pointing to a real source in the comment above the env var in
 * .env.example.
 *
 * TIERED FEES (Étape 4): the Étape 4 audit confirmed eBay's real final
 * value fee is NOT a flat percentage — it's applied progressively across
 * brackets (e.g. one rate up to a threshold, a different rate on the
 * portion above it), and can vary by category. `tiers` below represents
 * the progressive-bracket shape confirmed to exist; it deliberately does
 * NOT attempt to also model category/country/seller-type conditionality
 * automatically — `conditions` is documentary free text for that until a
 * real rules-matching design is scoped. An operator who needs a
 * genuinely different fee per category today can configure a more
 * specific marketplace key (e.g. "ebay:jewelry") and pass that exact
 * string as MarginCalculationInput.marketplace — MarketplaceFeeProvider
 * already checks the exact key before falling back to the generic one
 * (see getFeeStructure).
 */

import { createLogger } from '@/lib/logger';
import { ExactFeeQuery, ExactFeeResult, ExactMarketplaceFeeProvider } from './providers/ExactMarketplaceFeeProvider';

const logger = createLogger('marketplace-fee-provider');

export interface MarketplaceFeeTier {
  /**
   * Inclusive upper bound of this tier, in the fee's reference currency
   * (the resale amount, already converted to the target currency by the
   * time PricingService applies this). Omit on the LAST tier only, to
   * mean "no upper bound" — every other tier must set it.
   */
  upTo?: number;
  percentageFee?: number;
}

export interface MarketplaceFeeStructure {
  marketplace: string;
  /** Flat rate — Étape 3 shape, still supported as-is (e.g. fits Etsy's real flat transaction fee). Ignored if `tiers` is also set. */
  percentageFee?: number;
  /** Progressive-bracket shape (Étape 4) — takes precedence over percentageFee when present. See the module comment on the marginal/bracket interpretation. */
  tiers?: MarketplaceFeeTier[];
  fixedFee?: number;
  fixedFeeCurrency?: string;
  /** Where this number came from — required whenever a structure is returned at all, never left blank. */
  source: string;
  /** Date or version this fee schedule was checked against, if known — e.g. "checked 2026-09-17 against ebay.com/help/...". */
  asOf?: string;
  /** Free-text applicability notes (category/country/seller-type/...) — documentary only; not automatically matched in this step. */
  conditions?: string;
}

function loadConfiguredFees(): Record<string, MarketplaceFeeStructure> {
  const raw = process.env.MARKETPLACE_FEE_CONFIG;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed;
  } catch (error) {
    logger.warn('MARKETPLACE_FEE_CONFIG is set but is not valid JSON — ignoring it', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Normalizes provider-specific marketplace identifiers (e.g. eBay's
 * 'EBAY_GB' marketplace id from EbayBrowseSourcingProvider) down to a
 * plain marketplace name ('ebay') for fee lookup — fee schedules are
 * per-marketplace, not per-country, unless MARKETPLACE_FEE_CONFIG itself
 * is keyed more specifically.
 */
function normalizeMarketplaceKey(marketplace: string): string {
  return marketplace.trim().toLowerCase().split('_')[0];
}

export class MarketplaceFeeProvider {
  static getFeeStructure(marketplace: string): MarketplaceFeeStructure | null {
    const configured = loadConfiguredFees();
    const key = normalizeMarketplaceKey(marketplace);

    // Exact key first (lets an operator override per-country, or per a
    // more specific compound key like "ebay:jewelry", if they really
    // have that data), then the normalized generic key.
    return configured[marketplace] ?? configured[key] ?? null;
  }

  static isConfigured(marketplace: string): boolean {
    return this.getFeeStructure(marketplace) !== null;
  }

  /**
   * Phase 7 — the single entry point PricingService uses to resolve a
   * marketplace fee, distinguishing exactly what §4 requires: an 'exact'
   * figure (from a real per-workspace ExactMarketplaceFeeProvider, if one
   * is configured for that workspace and marketplace), an 'estimated'
   * figure (the existing configured percentageFee/tiers schedule — always
   * an estimate: even a correctly-sourced published rate is not a live
   * per-transaction calculation from the marketplace's own API), or
   * 'unknown' (neither is available — never defaulted to 0).
   *
   * `exactFeeProviders` defaults to an empty array — PricingService's own
   * production call site never passes any (no ExactMarketplaceFeeProvider
   * implementation is registered anywhere yet, see that interface's own
   * comment for exactly why). This keeps today's behavior for every
   * existing caller: with no providers, resolveFee always falls straight
   * through to the 'estimated'/'unknown' tiers, identical to the
   * pre-Phase-7 getFeeStructure-only behavior. Tests can pass fake
   * providers here to exercise the 'exact' tier and workspace isolation
   * without any real network/OAuth dependency.
   */
  static async resolveFee(
    query: ExactFeeQuery,
    exactFeeProviders: ExactMarketplaceFeeProvider[] = []
  ): Promise<MarketplaceFeeResolution> {
    const key = normalizeMarketplaceKey(query.marketplace);

    for (const provider of exactFeeProviders) {
      if (normalizeMarketplaceKey(provider.marketplace) !== key) continue;
      if (!provider.isConfigured(query.workspaceId)) continue;

      const exact = await provider.getExactFee(query);
      if (exact) {
        return { status: 'exact', exact };
      }
      // A configured provider that returned null (e.g. transient failure)
      // is not fatal — fall through to the next provider, then to the
      // estimated/unknown tiers below. Never a guessed amount.
    }

    const estimatedStructure = this.getFeeStructure(query.marketplace);
    if (estimatedStructure) {
      return { status: 'estimated', estimatedStructure };
    }

    return { status: 'unknown' };
  }
}

export type FeeCertainty = 'exact' | 'estimated' | 'unknown';

export interface MarketplaceFeeResolution {
  status: FeeCertainty;
  /** Set only when status === 'exact'. */
  exact?: ExactFeeResult;
  /** Set only when status === 'estimated' — PricingService still runs its own tiered/percentage math against this. */
  estimatedStructure?: MarketplaceFeeStructure;
}

export default MarketplaceFeeProvider;
