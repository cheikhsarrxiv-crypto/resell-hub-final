/**
 * Phase 11C — extracts calculate_margin results out of the raw
 * `toolCalls[]` array a /api/ai/agent response already carries, exactly
 * as src/lib/ai/sourcingResults.ts does for search_products.
 *
 * ABSOLUTE RULE: this module computes NOTHING. It reads
 * MarginCalculationResult fields (already fully computed and rounded by
 * PricingService) and, at most, re-formats a number/currency pair for
 * display (Intl.NumberFormat) or picks a French label for an existing
 * category string. It never subtracts, divides, multiplies, converts a
 * currency, or invents a value for a missing/null field.
 *
 * `AgentToolCallRecord.result` is typed `unknown` on the backend
 * (src/services/ai/tools/types.ts) — nothing here is trusted blindly;
 * every item is structurally validated before being treated as a real
 * result. Only a type-only import from the backend's pricing types —
 * zero runtime coupling.
 */
import type { CostLine, CostSource, MarginCalculationResult } from '@/services/pricing/types';
import { formatSourcingPrice } from './sourcingResults';

export interface MarginToolError {
  toolCallIndex: number;
  status: 'error';
}

export interface MarginToolSuccess {
  toolCallIndex: number;
  status: 'ok';
  result: MarginCalculationResult;
}

export type MarginOutcome = MarginToolSuccess | MarginToolError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isCostSource(value: unknown): value is CostSource {
  return value === 'known' || value === 'estimated';
}

/**
 * Structural check against MarginCalculationResult's real shape
 * (src/services/pricing/types.ts). A CostLine's `description` is always
 * a string per that type, but this still checks it defensively rather
 * than assuming — same for every field here.
 */
function isCostLine(value: unknown): value is CostLine {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    typeof value.amount === 'number' &&
    Number.isFinite(value.amount) &&
    typeof value.currency === 'string' &&
    isCostSource(value.source) &&
    typeof value.description === 'string'
  );
}

export function isMarginCalculationResult(value: unknown): value is MarginCalculationResult {
  if (!isRecord(value)) return false;

  return (
    typeof value.currency === 'string' &&
    Array.isArray(value.costBreakdown) &&
    value.costBreakdown.every(isCostLine) &&
    isNullableNumber(value.totalCost) &&
    isNullableNumber(value.netProfit) &&
    isNullableNumber(value.marginAmount) &&
    isNullableNumber(value.marginPercent) &&
    isNullableNumber(value.roi) &&
    typeof value.isEstimate === 'boolean' &&
    Array.isArray(value.missingData) &&
    value.missingData.every((item) => typeof item === 'string') &&
    Array.isArray(value.warnings) &&
    value.warnings.every((item) => typeof item === 'string')
  );
}

/**
 * Every calculate_margin call in one turn's toolCalls, in order. A tool
 * call whose result is a real MarginCalculationResult is 'ok'; one whose
 * result is the backend's own generic `{ error: ... }` shape (invalid
 * input, or the handler threw — see AiAgentService's dispatch loop) is
 * 'error', WITHOUT carrying the raw error text forward — the UI shows a
 * fixed, generic message for it (see MarginSummary), never the backend's
 * own wording. Anything else (neither shape) is silently excluded —
 * genuinely malformed, not a recognizable outcome of either kind.
 */
export function extractMarginOutcomes(toolCalls: unknown[] | undefined): MarginOutcome[] {
  if (!Array.isArray(toolCalls)) return [];

  const outcomes: MarginOutcome[] = [];

  toolCalls.forEach((call, index) => {
    if (!isRecord(call) || call.name !== 'calculate_margin') return;

    const result = call.result;
    if (isMarginCalculationResult(result)) {
      outcomes.push({ toolCallIndex: index, status: 'ok', result });
      return;
    }
    if (isRecord(result) && typeof result.error === 'string') {
      outcomes.push({ toolCallIndex: index, status: 'error' });
    }
    // Anything else: not a recognizable calculate_margin outcome at all — excluded.
  });

  return outcomes;
}

const COST_TYPE_LABELS: Record<string, string> = {
  purchase_price: "Prix d'achat",
  purchase_shipping: 'Expédition (achat)',
  customs_duty: 'Douane / taxes',
  marketplace_fee: 'Frais marketplace',
  payment_fee: 'Frais de paiement',
  fulfillment_cost: 'Fulfillment',
};

/** Falls back to the raw type string (lightly de-slugified) for a type this module doesn't recognize — never invents a different meaning for it. */
export function describeCostType(type: string): string {
  return COST_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}

const MISSING_DATA_LABELS: Record<string, string> = {
  resalePrice: 'Prix de revente manquant',
  marketplace_fee: 'Frais marketplace inconnus',
  fx_rate: 'Conversion de devise indisponible',
};

/**
 * missingData entries follow "category" or "category:identifier" (e.g.
 * "marketplace_fee:ebay", "fx_rate:GBP_EUR", or the bare "resalePrice") —
 * see MarginCalculationResult's own comment. Only the category prefix is
 * mapped to a French label; an unrecognized category is shown as-is
 * rather than given a fabricated explanation.
 */
export function describeMissingData(entry: string): string {
  const category = entry.split(':')[0];
  return MISSING_DATA_LABELS[category] ?? entry;
}

/** '~ ' for an estimated line/value, '' for a known one — the only visual distinction this module ever adds; the underlying number is never changed. */
export function certaintyPrefix(source: CostSource): string {
  return source === 'estimated' ? '~ ' : '';
}

/**
 * Formats an already-computed percentage number AS GIVEN — 33.05 means
 * "33.05%", never re-derived or multiplied/divided by 100. Purely
 * cosmetic (locale decimal separator, fixed precision), never a
 * calculation.
 */
export function formatMarginPercent(value: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value)} %`;
}

export { formatSourcingPrice as formatMarginAmount };
