/**
 * CurrencyConversionService — deliberately separate from PricingService
 * (per the Étape 3 architecture) so a real FX provider can be plugged in
 * (and swapped/removed) without PricingService's math changing.
 *
 * PRIORITY ORDER (fixed, never reordered — each tier is only consulted
 * if every earlier one had nothing to say):
 *  1. Same currency -> rate is exactly 1, always correct, not an estimate,
 *     no network call.
 *  2. An explicit rate the CALLER already provides (e.g. a rate the user
 *     typed in, or a real provider integrated later) -> used as given,
 *     never second-guessed, but tagged so PricingService can mark the
 *     calculation as non-authoritative.
 *  3. A rate from CURRENCY_STATIC_RATES (an operator-configured env var,
 *     NOT this codebase's own guess) -> same tagging.
 *  4. A real CurrencyConversionProvider (Frankfurter/ECB reference rates
 *     — Étape 4) -> only consulted if configured (FRANKFURTER_FX_ENABLED),
 *     tagged with the provider's own reported source (e.g.
 *     'ecb_reference_rate') — NEVER relabeled as a live market rate.
 *  5. Nothing answered -> 'unavailable'. Never a guessed number, never a
 *     silent fallback to rate 1.
 *
 * Async because tier 4 can be a real network call — every caller
 * (PricingService) awaits this.
 */

import { createLogger } from '@/lib/logger';
import { CurrencyConversionProvider } from './providers/CurrencyConversionProvider';
import { FrankfurterCurrencyProvider } from './providers/FrankfurterCurrencyProvider';

const logger = createLogger('currency-conversion');

export type ConversionSource =
  | 'identical_currency'
  | 'explicit_rate'
  | 'configured_static_rate'
  | 'ecb_reference_rate' // Frankfurter's own reported source today — extend this union if another real provider with a different tag is added later
  | 'unavailable';

export interface ConversionResult {
  amount: number | null;
  rate: number | null;
  source: ConversionSource;
  /** Set only when a provider reports one (e.g. Frankfurter's rate date) — the "conserve la date du taux" requirement. */
  asOf?: string;
  /** Set only when a provider (tier 4) resolved the rate — lets the caller know exactly which one, for traceability. */
  providerName?: string;
}

function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

function loadStaticRates(): Record<string, number> {
  const raw = process.env.CURRENCY_STATIC_RATES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed;
  } catch (error) {
    logger.warn('CURRENCY_STATIC_RATES is set but is not valid JSON — ignoring it', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

// A single default instance is enough here (no per-request state) — kept
// as a module-level list, same shape as SourcingService's provider list,
// so adding a second real FX provider later is a one-line change.
function getProviders(): CurrencyConversionProvider[] {
  return [new FrankfurterCurrencyProvider()];
}

export class CurrencyConversionService {
  static async convert(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    options?: { explicitRates?: Record<string, number> }
  ): Promise<ConversionResult> {
    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);

    if (from === to) {
      return { amount, rate: 1, source: 'identical_currency' };
    }

    const pairKey = `${from}_${to}`;

    const explicitRate = options?.explicitRates?.[pairKey];
    if (explicitRate !== undefined) {
      return { amount: amount * explicitRate, rate: explicitRate, source: 'explicit_rate' };
    }

    const staticRates = loadStaticRates();
    const staticRate = staticRates[pairKey];
    if (typeof staticRate === 'number') {
      return { amount: amount * staticRate, rate: staticRate, source: 'configured_static_rate' };
    }

    for (const provider of getProviders()) {
      if (!provider.isConfigured()) continue;

      const result = await provider.getRate(from, to);
      if (result) {
        return {
          amount: amount * result.rate,
          rate: result.rate,
          source: result.source as ConversionSource,
          asOf: result.asOf,
          providerName: provider.name,
        };
      }
      // A configured provider that returned null (unsupported pair,
      // timeout, HTTP error) is NOT treated as fatal — fall through to
      // the next provider (if any) or to 'unavailable' below. Never a
      // guessed rate.
    }

    return { amount: null, rate: null, source: 'unavailable' };
  }

  static isConfigured(): boolean {
    return Object.keys(loadStaticRates()).length > 0 || getProviders().some((p) => p.isConfigured());
  }
}

export default CurrencyConversionService;
