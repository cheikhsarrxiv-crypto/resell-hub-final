/**
 * CurrencyConversionProvider — abstraction for a real, external FX rate
 * source. CurrencyConversionService only ever falls through to a
 * provider AFTER identical-currency, explicit-rate, and configured-
 * static-rate have all failed to answer (see that file's priority order
 * — unchanged by this interface's existence).
 *
 * A provider that returns a rate MUST tag its real nature via `source`
 * (e.g. 'ecb_reference_rate') — never claim to be a live market rate
 * unless it genuinely is one. A provider with nothing configured, or
 * that fails/times out, returns null — CurrencyConversionService then
 * reports 'unavailable', never a fabricated fallback.
 */
export interface CurrencyRateResult {
  rate: number;
  /** The date/period the rate applies to, if the provider reports one — e.g. '2026-09-17'. */
  asOf?: string;
  /** Real provenance tag — e.g. 'ecb_reference_rate'. Never 'live_market_rate' unless actually true. */
  source: string;
}

export interface CurrencyConversionProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Returns null (never throws for a "no rate" case) — timeouts/HTTP errors/unsupported currencies all resolve to null. */
  getRate(from: string, to: string): Promise<CurrencyRateResult | null>;
}
