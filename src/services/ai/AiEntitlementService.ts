import { SubscriptionService } from '@/services/SubscriptionService';

/**
 * Every capability the AI Agent can gate a tool behind. This is a closed
 * set — canUseCapability/getCapabilityStatus below refuse anything not in
 * it, on purpose (see isKnownCapability). Two entries, 'order_actions' and
 * 'automations', currently have no tool mapped to them at all (see
 * TOOL_CAPABILITIES's own comment) — kept here because they are part of
 * the target capability model this service is built around, not because
 * any real tool uses them yet. Adding a real tool for either later means
 * adding one TOOL_CAPABILITIES entry, nothing else.
 */
export type AiCapability =
  | 'ai_chat'
  | 'product_analysis'
  | 'sourcing'
  | 'listing_generation'
  | 'listing_edit'
  | 'marketplace_publish'
  | 'order_actions'
  | 'fulfillment'
  | 'automations';

const ALL_CAPABILITIES: readonly AiCapability[] = [
  'ai_chat',
  'product_analysis',
  'sourcing',
  'listing_generation',
  'listing_edit',
  'marketplace_publish',
  'order_actions',
  'fulfillment',
  'automations',
];

const CAPABILITY_SET: ReadonlySet<string> = new Set(ALL_CAPABILITIES);

/**
 * Tool -> capability mapping, derived from each tool's own real behavior
 * (audited in tools/*.ts, not guessed):
 * - get_order/get_orders/get_listing/get_listings/get_shipment/
 *   get_customer/get_customer_orders: plain factual lookups a reseller
 *   would ask about in ordinary chat (an order's status, a listing's
 *   details, who the customer is) -> 'ai_chat', the baseline capability.
 * - get_product/get_inventory/get_sales_summary/calculate_margin: deeper
 *   business/financial analysis (cost, live stock, sales performance,
 *   margin) -> 'product_analysis'.
 * - search_products: external sourcing search -> 'sourcing'.
 * - create_product: turns a sourced item into a new ADKSY catalog Product
 *   -> 'listing_generation'. No dedicated "catalog management" capability
 *   exists (or is needed — see this file's own binary aiEnabled design
 *   note below), and create_product is conceptually the same bucket as
 *   generate_listing_draft: preparing a new sellable thing from a
 *   sourcing result, just now a real Product instead of an ephemeral
 *   draft. A deliberate choice, not an inherited convention (this tool
 *   didn't exist before this task).
 * - generate_listing_draft: prepares a NEW draft -> 'listing_generation'.
 * - edit_listing_draft AND update_listing: both edit an already-identified
 *   listing (one still a draft, one already real/published) with the same
 *   fields (title/description/price/quantity) -> both 'listing_edit'. This
 *   was the one genuinely ambiguous case the task flagged; treating them
 *   as the same capability, not two, is the smaller, more defensible
 *   choice, since they are the same conceptual reseller action.
 * - publish_listing/publish_etsy_listing: publish a draft to a real
 *   marketplace -> 'marketplace_publish'.
 * - send_to_fulfillment: send an order to ADKSY's fulfillment pipeline ->
 *   'fulfillment'.
 * - simulate_engage_action: an internal framework-testing tool with zero
 *   real effect (see actionTools.ts's own comment) — not a real business
 *   capability, so it is deliberately mapped to `null` (no capability
 *   check at all; only the existing global aiAssistant gate applies to
 *   it, same as before this service existed).
 *
 * No tool today does a direct order mutation (cancel/refund/edit an
 * order) distinct from sending it to fulfillment, and no tool automates
 * anything — 'order_actions' and 'automations' are reserved capabilities
 * with no mapped tool yet, never force-fit onto an existing one.
 */
export const TOOL_CAPABILITIES: Readonly<Record<string, AiCapability | null>> = {
  get_order: 'ai_chat',
  get_orders: 'ai_chat',
  get_listing: 'ai_chat',
  get_listings: 'ai_chat',
  get_shipment: 'ai_chat',
  get_customer: 'ai_chat',
  get_customer_orders: 'ai_chat',
  get_product: 'product_analysis',
  get_inventory: 'product_analysis',
  get_sales_summary: 'product_analysis',
  calculate_margin: 'product_analysis',
  search_products: 'sourcing',
  create_product: 'listing_generation',
  generate_listing_draft: 'listing_generation',
  edit_listing_draft: 'listing_edit',
  update_listing: 'listing_edit',
  publish_listing: 'marketplace_publish',
  publish_etsy_listing: 'marketplace_publish',
  send_to_fulfillment: 'fulfillment',
  simulate_engage_action: null,
};

/** A tool not in TOOL_CAPABILITIES at all (e.g. a future tool added without updating this map) also gets `null` — no capability gate, same as simulate_engage_action — never a silent crash. */
export function getRequiredCapabilityForTool(toolName: string): AiCapability | null {
  return Object.prototype.hasOwnProperty.call(TOOL_CAPABILITIES, toolName) ? TOOL_CAPABILITIES[toolName] : null;
}

export type AiCapabilityStatus =
  | 'authorized'
  | 'refused_plan_insufficient'
  | 'refused_subscription_inactive'
  | 'refused_unknown_capability';

export interface AiPlanEntitlements {
  planId: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  capabilities: Record<AiCapability, boolean>;
}

function allFalseCapabilities(): Record<AiCapability, boolean> {
  return ALL_CAPABILITIES.reduce((acc, capability) => {
    acc[capability] = false;
    return acc;
  }, {} as Record<AiCapability, boolean>);
}

/**
 * Capability-based entitlement layer for the AI Agent, sitting between
 * SubscriptionService (which already resolves the workspace's EFFECTIVE
 * plan, fail-closed on an inactive/unknown subscription status — see that
 * file's own comments) and AiAgentService/AiActionService.
 *
 * Grounded strictly in the two real Plan flags that already exist —
 * `aiAssistant` (whether the AI Agent is enabled for this plan at all —
 * true only for business/enterprise today, see prisma/seed.js) and
 * `fulfillmentEnabled` (the separate, pre-existing fulfillment feature
 * gate, true for pro/business/enterprise). No new Prisma column, no
 * Stripe change, no usage/quota tracking — see this task's own scope.
 *
 * A per-capability matrix that differentiated Starter/Pro (e.g. "Starter
 * gets ai_chat only", "Pro gets everything except publish/fulfillment")
 * was proposed as a starting point for this task, but is deliberately NOT
 * implemented here: no real plan/pricing data in this repository backs
 * that distinction today (Starter and Pro both have aiAssistant unset,
 * i.e. false — the existing /api/ai/agent route already refuses them
 * entirely before AiAgentService ever runs), and inventing a partial
 * capability set for them would be exactly the kind of fabricated
 * business rule this project must never introduce. Today's real signal
 * is binary: a plan either has the full AI Agent (aiAssistant: true) or
 * it has none of it. Once product/pricing actually defines graduated AI
 * tiers for Starter/Pro (a real Plan-level decision, not one this service
 * can invent), only CAPABILITY updates below need to change — the
 * plumbing (getPlanEntitlements/canUseCapability/getCapabilityStatus,
 * and their callers) already supports a non-binary matrix as-is.
 *
 * 'fulfillment' is additionally ANDed with the plan's own
 * `fulfillmentEnabled` flag, never just `aiAssistant` alone — so
 * send_to_fulfillment stays gated by both the AI capability AND the
 * pre-existing fulfillment feature flag, exactly as this task requires,
 * and remains correct even if a future plan ever has one flag without
 * the other (today none does: business/enterprise have both).
 */
export class AiEntitlementService {
  static isKnownCapability(capability: string): capability is AiCapability {
    return CAPABILITY_SET.has(capability);
  }

  /**
   * The full capability matrix for a workspace's current effective plan.
   * Never throws — any failure (workspace/subscription/plan lookup error)
   * fails closed to every capability false, exactly like
   * SubscriptionService.hasFeature's own fail-closed catch.
   */
  static async getPlanEntitlements(workspaceId: string): Promise<AiPlanEntitlements> {
    try {
      const subscription = await SubscriptionService.getSubscription(workspaceId);
      const plan = subscription?.plan as
        | { id: string; name: string; aiAssistant?: boolean; fulfillmentEnabled?: boolean }
        | null
        | undefined;

      const aiEnabled = Boolean(plan?.aiAssistant);
      const fulfillmentEnabled = Boolean(plan?.fulfillmentEnabled);

      const capabilities = ALL_CAPABILITIES.reduce((acc, capability) => {
        acc[capability] = capability === 'fulfillment' ? aiEnabled && fulfillmentEnabled : aiEnabled;
        return acc;
      }, {} as Record<AiCapability, boolean>);

      return {
        planId: plan?.id ?? null,
        planName: plan?.name ?? null,
        subscriptionStatus: subscription?.status ?? null,
        capabilities,
      };
    } catch (error) {
      console.error('[AiEntitlementService] Error computing plan entitlements:', error);
      return { planId: null, planName: null, subscriptionStatus: null, capabilities: allFalseCapabilities() };
    }
  }

  /** Unknown capability string -> always false. Never a `default: true`. */
  static async canUseCapability(workspaceId: string, capability: string): Promise<boolean> {
    if (!this.isKnownCapability(capability)) {
      return false;
    }
    const entitlements = await this.getPlanEntitlements(workspaceId);
    return entitlements.capabilities[capability] === true;
  }

  /**
   * Same authorization result as canUseCapability, plus (best-effort) WHY
   * it was refused — only to the extent SubscriptionService's own data
   * model can actually support the distinction:
   * - 'refused_unknown_capability': the capability string itself isn't
   *   one of the 9 real ones.
   * - 'refused_subscription_inactive': the workspace HAS a Subscription
   *   row whose real Stripe status isn't access-granting (canceled/
   *   unpaid/incomplete/...) — SubscriptionService.getSubscription
   *   preserves that real status even while it forces the effective plan
   *   to Free, which is what makes this distinction possible here without
   *   duplicating any status logic.
   * - 'refused_plan_insufficient': every other refusal — no subscription
   *   at all, or a genuinely active subscription whose plan simply
   *   doesn't include this capability. These two cases are NOT further
   *   distinguished (a workspace with literally no subscription is
   *   already indistinguishable from a Free-plan one throughout
   *   SubscriptionService itself — see getSubscription's own comment) —
   *   inventing a third label here would be exactly the kind of
   *   unsupported distinction this task says not to make.
   */
  static async getCapabilityStatus(
    workspaceId: string,
    capability: string
  ): Promise<{ capability: string; status: AiCapabilityStatus }> {
    if (!this.isKnownCapability(capability)) {
      return { capability, status: 'refused_unknown_capability' };
    }

    try {
      const [subscription, entitlements] = await Promise.all([
        SubscriptionService.getSubscription(workspaceId),
        this.getPlanEntitlements(workspaceId),
      ]);

      if (entitlements.capabilities[capability]) {
        return { capability, status: 'authorized' };
      }

      const subscriptionIsInactive = Boolean(subscription?.status) && !SubscriptionService.isAccessGrantingStatus(subscription.status);
      if (subscriptionIsInactive) {
        return { capability, status: 'refused_subscription_inactive' };
      }

      return { capability, status: 'refused_plan_insufficient' };
    } catch (error) {
      console.error('[AiEntitlementService] Error computing capability status:', error);
      return { capability, status: 'refused_plan_insufficient' };
    }
  }
}

export default AiEntitlementService;
