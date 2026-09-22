/**
 * Phase 11B — extracts search_products results out of the raw
 * `toolCalls[]` array a /api/ai/agent response already carries (see the
 * Phase 11 audit: `toolCalls[].result` already contains the full
 * NormalizedSourcingResult[] — no backend change was needed for this).
 *
 * `AgentToolCallRecord.result` is typed `unknown` on the backend
 * (src/services/ai/tools/types.ts), so nothing here is trusted blindly:
 * every item is structurally validated before being treated as a real
 * sourcing result. A malformed/unexpected shape is silently excluded,
 * never fabricated into something that looks valid.
 *
 * Only a type-only import from the backend's sourcing types — zero
 * runtime coupling, and this file doesn't (and can't) execute or modify
 * any backend logic.
 */
import type { AuthenticityStatus, NormalizedSourcingResult } from '@/services/sourcing/types';

export interface SourcingProviderErrorInfo {
  provider: string;
  message: string;
  kind: string;
}

/**
 * One search_products call's outcome, already reduced to what the UI
 * needs. Phase 4 (Global Sourcing Engine UI) adds the provider-provenance
 * fields the backend has carried since Phase 1/2 (providersSearched/
 * providersFailed/providersUnavailable/providersSkipped/totalResults) —
 * previously extracted but never surfaced to the UI, so a partial-results
 * situation (e.g. eBay succeeded, Etsy failed) was invisible. Each is a
 * real, structurally-validated array/number, defaulting to an empty
 * array/0 when the backend response doesn't carry it (an older/mocked
 * response shape) — never fabricated, just "we don't know" rendered as
 * "no such provider".
 */
export interface SourcingSearchOutcome {
  toolCallIndex: number;
  status: 'ok' | 'SOURCE_NOT_CONFIGURED' | 'unknown';
  results: NormalizedSourcingResult[];
  providerErrors: SourcingProviderErrorInfo[];
  providersSearched: string[];
  providersFailed: string[];
  providersUnavailable: string[];
  providersSkipped: string[];
  totalResults: number;
  /**
   * Phase 4 — echoed back from the tool CALL's own input (never the
   * result), so the UI can honestly say what was actually asked for
   * (e.g. "recherche mondiale") without re-deriving it from the results.
   * `undefined` when the input didn't set it — never defaulted to false/
   * true, since "not requested" and "requested as false" both exist as
   * real, distinct states in the underlying Zod schema.
   */
  requestedWorldwide?: boolean;
}

const AUTHENTICITY_STATUSES: readonly AuthenticityStatus[] = ['verified', 'claimed', 'unverified', 'unknown'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Structural check against NormalizedSourcingResult's real, required
 * fields (src/services/sourcing/types.ts). Optional fields (shippingCost,
 * seller, authenticitySource, ...) are passed through as-is if present
 * and simply omitted from rendering if not — never defaulted.
 */
export function isNormalizedSourcingResult(value: unknown): value is NormalizedSourcingResult {
  if (!isRecord(value)) return false;

  return (
    typeof value.source === 'string' &&
    typeof value.sourceUrl === 'string' &&
    typeof value.title === 'string' &&
    typeof value.price === 'number' &&
    Number.isFinite(value.price) &&
    typeof value.currency === 'string' &&
    typeof value.marketplace === 'string' &&
    Array.isArray(value.images) &&
    typeof value.authenticityStatus === 'string' &&
    (AUTHENTICITY_STATUSES as string[]).includes(value.authenticityStatus)
  );
}

function isProviderErrorInfo(value: unknown): value is SourcingProviderErrorInfo {
  return (
    isRecord(value) &&
    typeof value.provider === 'string' &&
    typeof value.message === 'string' &&
    typeof value.kind === 'string'
  );
}

/** A real array of provider-name strings, or [] when the field is absent/malformed — never a guess at what it might have contained. */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Extracts every search_products outcome from one assistant message's
 * toolCalls (a conversation can, in principle, call it more than once in
 * a single turn — every call is kept, in order, none merged/deduped).
 */
export function extractSourcingOutcomes(toolCalls: unknown[] | undefined): SourcingSearchOutcome[] {
  if (!Array.isArray(toolCalls)) return [];

  const outcomes: SourcingSearchOutcome[] = [];

  toolCalls.forEach((call, index) => {
    if (!isRecord(call) || call.name !== 'search_products') return;

    const result = call.result;
    if (!isRecord(result)) return;

    const status = result.status === 'ok' || result.status === 'SOURCE_NOT_CONFIGURED' ? result.status : 'unknown';
    const rawResults = Array.isArray(result.results) ? result.results : [];
    const rawErrors = Array.isArray(result.providerErrors) ? result.providerErrors : [];
    const validResults = rawResults.filter(isNormalizedSourcingResult);
    const input = isRecord(call.input) ? call.input : undefined;

    outcomes.push({
      toolCallIndex: index,
      status,
      results: validResults,
      providerErrors: rawErrors.filter(isProviderErrorInfo),
      providersSearched: asStringArray(result.providersSearched),
      providersFailed: asStringArray(result.providersFailed),
      providersUnavailable: asStringArray(result.providersUnavailable),
      providersSkipped: asStringArray(result.providersSkipped),
      // Prefer the backend's own totalResults when it's a real number;
      // otherwise fall back to what actually validated, never a guess.
      totalResults: typeof result.totalResults === 'number' ? result.totalResults : validResults.length,
      requestedWorldwide: typeof input?.worldwide === 'boolean' ? input.worldwide : undefined,
    });
  });

  return outcomes;
}

/** Convenience flattening when the caller only needs the results, not per-call status/errors. */
export function extractSourcingResults(toolCalls: unknown[] | undefined): NormalizedSourcingResult[] {
  return extractSourcingOutcomes(toolCalls).flatMap((outcome) => outcome.results);
}

/**
 * Formats a real amount+currency pair for display. Never invents a
 * currency symbol for a currency Intl doesn't recognize — falls back to
 * "<amount> <CODE>" (e.g. "500 XYZ") rather than throwing or guessing a
 * symbol. Intl.NumberFormat itself throws a RangeError for a malformed
 * currency code, which this catches.
 */
export function formatSourcingPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/**
 * A short, human-readable label from real fields only — never a
 * fabricated country/region. eBay's own marketplace ids (e.g. 'EBAY_GB')
 * are the only ones this provider ever returns (see
 * EbayBrowseSourcingProvider.SUPPORTED_MARKETPLACES); any other shape is
 * shown as-is rather than guessed at. Etsy (Phase 2) has no per-country
 * marketplace split — EtsySourcingProvider always reports the constant
 * 'ETSY' — so 'source' alone (not the marketplace value) picks the label.
 */
export function formatMarketplaceLabel(marketplace: string, source: string): string {
  const match = /^EBAY_([A-Z]{2})$/.exec(marketplace);
  if (source === 'ebay' && match) {
    return `eBay · ${match[1]}`;
  }
  if (source === 'ebay') {
    return 'eBay';
  }
  if (source === 'etsy') {
    return 'Etsy';
  }
  return marketplace;
}

/**
 * Phase 4 — French labels for NormalizedSourcingResult.unknownCostFactors'
 * OWN controlled vocabulary (see src/services/sourcing/types.ts — this
 * frontend module owns no separate list, it mirrors that exact backend
 * enum). Never a translation of arbitrary/untrusted text: every key here
 * is a fixed code ADKSY's own backend defines and documents, not
 * something a provider/seller supplied — an unrecognized code (a future
 * backend addition this file hasn't caught up with yet) falls back to the
 * raw code rather than a guessed label.
 */
const UNKNOWN_COST_FACTOR_LABELS: Record<string, string> = {
  shipping_unknown: 'Frais de livraison',
  currency_conversion_unavailable: 'Conversion de devise indisponible',
  import_tax_unknown: "Taxes d'importation",
  customs_unknown: 'Frais de douane',
  provider_fee_unknown: 'Frais de plateforme',
  authentication_cost_unknown: "Frais d'authentification",
};

export function formatUnknownCostFactor(factor: string): string {
  return UNKNOWN_COST_FACTOR_LABELS[factor] ?? factor;
}

/**
 * Phase 4 — a display name for a bare SourcingProvider.name (e.g. from
 * providersSearched/providersFailed/providersUnavailable/providersSkipped
 * — no marketplace value available for these, unlike a specific result).
 * Never a fabricated brand for a provider this file doesn't know about —
 * falls back to the raw name.
 */
export function formatProviderName(source: string): string {
  if (source === 'ebay') return 'eBay';
  if (source === 'etsy') return 'Etsy';
  return source;
}
