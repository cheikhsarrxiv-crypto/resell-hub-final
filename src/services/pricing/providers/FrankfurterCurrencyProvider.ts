import { createLogger } from '@/lib/logger';
import { CurrencyConversionProvider, CurrencyRateResult } from './CurrencyConversionProvider';

const logger = createLogger('frankfurter-currency-provider');

// Endpoint per Frankfurter's own current documentation (frankfurter.dev),
// using the `from`/`to` query parameters shown in their own request
// example. NOT independently re-verified against a live response in this
// session — developer-facing frankfurter.dev/app were unreachable from
// this sandbox's network egress. Verify this exact URL/response shape
// against a real request before relying on it in production.
const BASE_URL = 'https://api.frankfurter.dev/v1/latest';
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Frankfurter — free, no-API-key service serving the European Central
 * Bank's daily reference exchange rates (~30 major currencies, updated
 * once per business day, historical data back to 1999).
 *
 * IMPORTANT: these are ECB REFERENCE rates, not live market/trading
 * rates — every successful result is tagged source: 'ecb_reference_rate'.
 * CurrencyConversionService/PricingService must never relabel this as a
 * live rate, and calculate_margin's tool description tells the agent to
 * say so explicitly to the user.
 *
 * Off by default: FRANKFURTER_FX_ENABLED must be explicitly "true" to
 * activate this provider at all. Adding a new outbound network
 * dependency to an already-validated engine (Étape 3) should never
 * happen silently by just deploying this file — an operator opts in
 * deliberately.
 */
export class FrankfurterCurrencyProvider implements CurrencyConversionProvider {
  readonly name = 'frankfurter';

  isConfigured(): boolean {
    return process.env.FRANKFURTER_FX_ENABLED === 'true';
  }

  async getRate(from: string, to: string): Promise<CurrencyRateResult | null> {
    if (!this.isConfigured()) {
      return null;
    }

    let response: Response;
    try {
      const url = `${BASE_URL}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      // Timeout or network failure -> unavailable. NEVER a fallback rate.
      logger.warn(`Frankfurter request failed for ${from}->${to}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (!response.ok) {
      logger.warn(`Frankfurter returned a non-ok status for ${from}->${to}`, { status: response.status });
      return null;
    }

    const data = await response.json().catch(() => null);
    const rate = data?.rates?.[to];

    if (typeof rate !== 'number') {
      // Includes the case of a currency Frankfurter doesn't cover
      // (it serves ~30 major currencies, not the full ISO 4217 list) —
      // reported as unavailable, never guessed at.
      logger.warn(`Frankfurter has no rate for ${from}->${to}`);
      return null;
    }

    return { rate, asOf: typeof data.date === 'string' ? data.date : undefined, source: 'ecb_reference_rate' };
  }
}

export default FrankfurterCurrencyProvider;
