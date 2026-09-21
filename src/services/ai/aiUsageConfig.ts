/**
 * Single source of truth for AiUsageService's two configurable numbers —
 * deliberately kept in one small, dependency-free file rather than inside
 * AiUsageService.ts itself, so either can be tuned without touching the
 * service's logic, and never duplicated in a second place.
 */

/**
 * AI Units cost per real tool execution (V1 barème, validated in the prior
 * commercial-proposal task). A tool mapped to `null` has no commercial
 * cost at all — AiUsageService.hasQuotaRemaining/recordUsage both
 * short-circuit to "always allowed / nothing recorded" for it, exactly
 * like AiEntitlementService.TOOL_CAPABILITIES treats the same tool as
 * having no capability gate. Today that is only `simulate_engage_action`
 * (an internal framework-testing tool with zero real effect — see
 * actionTools.ts's own comment).
 *
 * Read lookups (ai_chat/product_analysis tools) all cost 1 — technically
 * identical (a single DB-only Claude round-trip, no external call). The
 * rest scale with real technical cost: an external call (search_products)
 * or a real, potentially irreversible external/business effect
 * (marketplace_publish, fulfillment) cost more — see the prior commercial
 * proposal's own cost analysis for the full reasoning.
 */
export const TOOL_USAGE_UNITS: Readonly<Record<string, number | null>> = {
  get_order: 1,
  get_orders: 1,
  get_listing: 1,
  get_listings: 1,
  get_shipment: 1,
  get_customer: 1,
  get_customer_orders: 1,
  get_product: 1,
  get_inventory: 1,
  get_sales_summary: 1,
  calculate_margin: 1,
  search_products: 3,
  generate_listing_draft: 2,
  edit_listing_draft: 1,
  // create_product (no pre-existing barème entry to inspect — this tool
  // didn't exist before this task): costs the same as update_listing (3),
  // not generate_listing_draft's 2 — a real, persistent Product+Inventory
  // row is a heavier, less reversible internal business effect than an
  // ephemeral, conversation-scoped draft, but it's still an ADKSY-internal
  // write, never an external marketplace call — so priced below
  // publish_listing/publish_etsy_listing/send_to_fulfillment's 5, exactly
  // the same "external/irreversible effects cost more" reasoning this
  // whole table's own header comment already documents. A deliberate
  // choice, not an inherited convention.
  create_product: 3,
  update_listing: 3,
  publish_listing: 5,
  publish_etsy_listing: 5,
  send_to_fulfillment: 5,
  simulate_engage_action: null,
};

/**
 * A tool not in TOOL_USAGE_UNITS at all (a future tool nobody wired up
 * yet) also gets `null` — never a silent crash, and never fail-closed
 * either (an unmapped tool is a configuration gap, not a security
 * boundary — AiEntitlementService.TOOL_CAPABILITIES already gates real
 * access; a completeness test in ai-usage-service.test.ts asserts every
 * tool currently in AiToolRegistry has an explicit entry here so this
 * fallback is never silently relied on for a real, known tool).
 */
export function getToolUsageUnits(toolName: string): number | null {
  return Object.prototype.hasOwnProperty.call(TOOL_USAGE_UNITS, toolName) ? TOOL_USAGE_UNITS[toolName] : null;
}

/**
 * Default AI Units budget per real billing period, per plan name —
 * ONE global bucket per workspace (never one quota per capability, per
 * the "do not create several quota systems that could accidentally
 * stack" instruction). These are the commercial-proposal defaults,
 * explicitly configurable here and only here — never hardcoded a second
 * time anywhere else in AiUsageService.
 *
 * Free/Starter/Pro have real values here even though `Plan.aiAssistant`
 * is false for all three today (the AI Agent route already refuses them
 * entirely upstream — see AiEntitlementService) — this table is ready for
 * whenever that gate is loosened, without needing another change here.
 */
export const PLAN_MONTHLY_AI_UNITS: Readonly<Record<string, number>> = {
  free: 50,
  starter: 300,
  pro: 1000,
  business: 5000,
  enterprise: 5000,
};

/** An unrecognized plan name returns `null` — AiUsageService treats that as fail-closed (refuse), never as "unlimited". */
export function getDefaultMonthlyUnitsForPlan(planName: string): number | null {
  return Object.prototype.hasOwnProperty.call(PLAN_MONTHLY_AI_UNITS, planName) ? PLAN_MONTHLY_AI_UNITS[planName] : null;
}
