/**
 * Pricing/Margin Engine — deterministic, backend-only math. The LLM never
 * computes a number here; it only ever reads what PricingService already
 * calculated (see AiAgentService's system prompt and the calculate_margin
 * tool, which is the ONLY way the agent touches this engine).
 *
 * Core rule enforced throughout this module: every cost line is either a
 * real known value, an explicitly-flagged estimate, or reported as
 * missing — never silently assumed. See PricingService's own comment for
 * exactly how "missing" propagates (a missing/unconvertible cost blocks
 * the total, it never gets treated as zero).
 */

export type CostSource = 'known' | 'estimated';

export interface CostLine {
  type: string; // e.g. 'purchase_price', 'purchase_shipping', 'customs_duty', 'marketplace_fee', 'payment_fee', 'fulfillment_cost'
  amount: number;
  currency: string;
  source: CostSource;
  /** Free-text provenance — e.g. "eBay Browse API listing price", "MarketplaceFeeProvider: no configured rate for 'depop'", "caller-provided estimate". Never left implicit. */
  description: string;
}

export interface AdditionalCostInput {
  type: string;
  amount: number;
  currency: string;
  source?: CostSource; // defaults to 'known' — the caller is asserting a real figure unless it says otherwise
  description?: string;
}

export interface MarginCalculationInput {
  purchasePrice: number;
  purchaseCurrency: string;
  purchasePriceSource?: CostSource; // defaults to 'known'
  /** Everything is computed and reported in this currency. */
  targetCurrency: string;
  /** Without this, margin/ROI cannot be computed — see MarginCalculationResult.warnings. */
  resalePrice?: number;
  resaleCurrency?: string;
  /** For MarketplaceFeeProvider lookup — a free string (e.g. 'ebay', 'EBAY_GB', 'etsy'); normalized internally. Omit to skip marketplace fee entirely (not an error). */
  marketplace?: string;
  /** Purchase shipping, customs/duty, payment processing, fulfillment cost, or anything else the caller already knows or estimates — never fabricated by this engine itself. */
  additionalCosts?: AdditionalCostInput[];
  /**
   * Optional explicit FX rate(s) the caller already has (e.g. from a real
   * provider integrated later, or a rate the user typed in themselves).
   * Keyed "FROM_TO", e.g. { "GBP_EUR": 1.17 }. Only used if
   * CurrencyConversionService has no cheaper/more certain answer
   * (identical currency).
   */
  explicitRates?: Record<string, number>;
  /**
   * Phase 7 — session-derived, trusted workspace (see AgentToolDefinition's
   * own contract: never sourced from model/user input). Used ONLY to look
   * up a per-workspace exact marketplace fee provider, if one is ever
   * registered (see MarketplaceFeeProvider.resolveFee and
   * ExactMarketplaceFeeProvider) — no other lookup in this engine uses it.
   * Omitted entirely, the engine behaves exactly as before Phase 7,
   * falling back to a configured/estimated fee or reporting it as unknown.
   */
  workspaceId?: string;
}

export interface MarginCalculationResult {
  currency: string; // === input.targetCurrency
  costBreakdown: CostLine[];
  /** null when any required cost line could not be converted/resolved — never a partial sum presented as complete. */
  totalCost: number | null;
  netProfit: number | null;
  marginAmount: number | null; // === netProfit, kept as a distinct field to match the requested "marge en €" output name
  marginPercent: number | null;
  roi: number | null;
  /** True the moment any cost line's source is 'estimated' or any conversion used a non-live configured/explicit rate rather than an exact known value. */
  isEstimate: boolean;
  /** Structured list of exactly what's missing — e.g. 'resalePrice', 'fx_rate:GBP_EUR', 'marketplace_fee:depop'. Meant for the agent to ask the user for, not just prose. */
  missingData: string[];
  /** Human-readable explanations, always paired with what's in missingData — never a bare number with no context. */
  warnings: string[];
}
