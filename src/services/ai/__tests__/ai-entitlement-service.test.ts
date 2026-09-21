/**
 * Behavioral tests for AiEntitlementService — the capability-based
 * entitlement layer sitting on top of SubscriptionService.getSubscription.
 * Uses the REAL SubscriptionService (never mocked) so Stripe-status logic
 * is proven to be inherited, not duplicated — only prisma.workspace/plan
 * are mocked, the same shared-client pattern already established in
 * subscription-status-access.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { workspaceFindUniqueMock, planFindUniqueMock } = vi.hoisted(() => ({
  workspaceFindUniqueMock: vi.fn(),
  planFindUniqueMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const client = {
    workspace: { findUnique: workspaceFindUniqueMock },
    plan: { findUnique: planFindUniqueMock },
  };
  return { default: client, prisma: client };
});

import { AiEntitlementService, TOOL_CAPABILITIES, getRequiredCapabilityForTool, type AiCapability } from '@/services/ai/AiEntitlementService';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';

// The 5 real plans from prisma/seed.js, exact flags — never a value this
// file invents. Starter/Free have no `aiAssistant` field set at all in
// seed.js (schema default: false); Pro has `fulfillmentEnabled: true` but
// still no `aiAssistant` — deliberately kept exactly as seeded, since that
// combination is precisely what proves the matrix's "aiAssistant gates
// everything, fulfillmentEnabled only additionally narrows fulfillment"
// design (see AiEntitlementService's own header comment).
const FREE_PLAN = { id: 'plan-free', name: 'free', aiAssistant: false, fulfillmentEnabled: false };
const STARTER_PLAN = { id: 'plan-starter', name: 'starter', aiAssistant: false, fulfillmentEnabled: false };
const PRO_PLAN = { id: 'plan-pro', name: 'pro', aiAssistant: false, fulfillmentEnabled: true };
const BUSINESS_PLAN = { id: 'plan-business', name: 'business', aiAssistant: true, fulfillmentEnabled: true };
const ENTERPRISE_PLAN = { id: 'plan-enterprise', name: 'enterprise', aiAssistant: true, fulfillmentEnabled: true };

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

function makeWorkspace(subscriptionStatus: string | null, plan: any) {
  if (subscriptionStatus === null) {
    return { id: 'ws-1', subscription: null };
  }
  return {
    id: 'ws-1',
    subscription: {
      id: 'sub-1',
      planId: plan.id,
      status: subscriptionStatus,
      stripeSubscriptionId: 'sub_stripe_1',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-02-01'),
      plan,
    },
  };
}

describe('AiEntitlementService.getPlanEntitlements — Plan -> Capability matrix (real seed.js plans)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planFindUniqueMock.mockResolvedValue(FREE_PLAN);
  });

  it.each([
    ['free', FREE_PLAN, false],
    ['starter', STARTER_PLAN, false],
    ['pro', PRO_PLAN, false],
  ])('%s plan (aiAssistant unset today) -> every capability is false, even where fulfillmentEnabled is true', async (_name, plan) => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('active', plan));

    const entitlements = await AiEntitlementService.getPlanEntitlements('ws-1');

    for (const capability of ALL_CAPABILITIES) {
      expect(entitlements.capabilities[capability]).toBe(false);
    }
    expect(entitlements.planName).toBe(plan.name);
  });

  it.each([
    ['business', BUSINESS_PLAN],
    ['enterprise', ENTERPRISE_PLAN],
  ])('%s plan (aiAssistant true, fulfillmentEnabled true) -> every capability is true', async (_name, plan) => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('active', plan));

    const entitlements = await AiEntitlementService.getPlanEntitlements('ws-1');

    for (const capability of ALL_CAPABILITIES) {
      expect(entitlements.capabilities[capability]).toBe(true);
    }
  });

  it('fulfillment is ANDed with fulfillmentEnabled — a hypothetical plan with aiAssistant true but fulfillmentEnabled false has every capability EXCEPT fulfillment', async () => {
    // No real plan in seed.js has this exact combination today — this
    // proves the AND logic itself stays correct if one ever does, without
    // asserting such a plan currently exists.
    const hypotheticalPlan = { id: 'plan-hypothetical', name: 'hypothetical', aiAssistant: true, fulfillmentEnabled: false };
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('active', hypotheticalPlan));

    const entitlements = await AiEntitlementService.getPlanEntitlements('ws-1');

    expect(entitlements.capabilities.fulfillment).toBe(false);
    for (const capability of ALL_CAPABILITIES) {
      if (capability === 'fulfillment') continue;
      expect(entitlements.capabilities[capability]).toBe(true);
    }
  });

  it('workspace isolation: two workspaces on different plans never affect each other', async () => {
    workspaceFindUniqueMock.mockImplementation(async ({ where }: any) =>
      where.id === 'ws-business' ? makeWorkspace('active', BUSINESS_PLAN) : makeWorkspace('active', FREE_PLAN)
    );

    expect(await AiEntitlementService.canUseCapability('ws-business', 'sourcing')).toBe(true);
    expect(await AiEntitlementService.canUseCapability('ws-free', 'sourcing')).toBe(false);
  });
});

describe('AiEntitlementService — real Stripe status matrix, inherited from SubscriptionService (never duplicated)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planFindUniqueMock.mockResolvedValue(FREE_PLAN);
  });

  it.each(['active', 'trialing', 'past_due'])('status "%s" on the Business plan -> capabilities granted', async (status) => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace(status, BUSINESS_PLAN));
    expect(await AiEntitlementService.canUseCapability('ws-1', 'ai_chat')).toBe(true);
  });

  it.each(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'some_future_status'])(
    'status "%s" on the Business plan -> falls back to Free, every capability refused',
    async (status) => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace(status, BUSINESS_PLAN));
      expect(await AiEntitlementService.canUseCapability('ws-1', 'ai_chat')).toBe(false);
    }
  );

  it('an inactive subscription status is reported as refused_subscription_inactive, not refused_plan_insufficient', async () => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('canceled', BUSINESS_PLAN));

    const result = await AiEntitlementService.getCapabilityStatus('ws-1', 'ai_chat');

    expect(result).toEqual({ capability: 'ai_chat', status: 'refused_subscription_inactive' });
  });

  it('a genuinely active subscription whose plan just lacks the capability is reported as refused_plan_insufficient', async () => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('active', PRO_PLAN));

    const result = await AiEntitlementService.getCapabilityStatus('ws-1', 'ai_chat');

    expect(result).toEqual({ capability: 'ai_chat', status: 'refused_plan_insufficient' });
  });

  it('no subscription at all -> refused_plan_insufficient (never mislabeled as "inactive" — getSubscription\'s own default status is "active")', async () => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace(null, FREE_PLAN));

    const result = await AiEntitlementService.getCapabilityStatus('ws-1', 'ai_chat');

    expect(result).toEqual({ capability: 'ai_chat', status: 'refused_plan_insufficient' });
  });

  it('an authorized capability is reported as authorized', async () => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('active', BUSINESS_PLAN));

    const result = await AiEntitlementService.getCapabilityStatus('ws-1', 'fulfillment');

    expect(result).toEqual({ capability: 'fulfillment', status: 'authorized' });
  });
});

describe('AiEntitlementService — fail-closed edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planFindUniqueMock.mockResolvedValue(FREE_PLAN);
  });

  it('an unknown capability string -> canUseCapability always false, never a default:true', async () => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('active', ENTERPRISE_PLAN));
    expect(await AiEntitlementService.canUseCapability('ws-1', 'delete_everything')).toBe(false);
  });

  it('an unknown capability string -> getCapabilityStatus is refused_unknown_capability, checked before any DB lookup', async () => {
    const result = await AiEntitlementService.getCapabilityStatus('ws-1', 'not_a_real_capability');
    expect(result).toEqual({ capability: 'not_a_real_capability', status: 'refused_unknown_capability' });
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });

  it('workspace not found -> every capability false, never throws', async () => {
    workspaceFindUniqueMock.mockResolvedValue(null);
    const entitlements = await AiEntitlementService.getPlanEntitlements('ws-does-not-exist');
    for (const capability of ALL_CAPABILITIES) {
      expect(entitlements.capabilities[capability]).toBe(false);
    }
  });

  it('a workspace with a subscription but no real Plan row (planId dangling) -> every capability false', async () => {
    workspaceFindUniqueMock.mockResolvedValue({ id: 'ws-1', subscription: { status: 'active', plan: null, planId: 'ghost-plan' } });
    expect(await AiEntitlementService.canUseCapability('ws-1', 'ai_chat')).toBe(false);
  });

  it('an unexpected DB error -> fails closed (every capability false), never throws, never leaks the raw error', async () => {
    workspaceFindUniqueMock.mockRejectedValue(new Error('connection refused: raw internal DB detail'));

    const entitlements = await AiEntitlementService.getPlanEntitlements('ws-1');
    for (const capability of ALL_CAPABILITIES) {
      expect(entitlements.capabilities[capability]).toBe(false);
    }
    expect(await AiEntitlementService.canUseCapability('ws-1', 'ai_chat')).toBe(false);

    const status = await AiEntitlementService.getCapabilityStatus('ws-1', 'ai_chat');
    expect(status.status).toBe('refused_plan_insufficient');
  });

  it('getPlanEntitlements never exposes anything beyond planId/planName/subscriptionStatus/capabilities — no Stripe id, no raw Plan row', async () => {
    workspaceFindUniqueMock.mockResolvedValue(
      makeWorkspace('active', { ...BUSINESS_PLAN, stripePriceIdMonthly: 'price_secret_123', maxUsers: 5 })
    );

    const entitlements = await AiEntitlementService.getPlanEntitlements('ws-1');

    expect(Object.keys(entitlements).sort()).toEqual(['capabilities', 'planId', 'planName', 'subscriptionStatus']);
    expect(JSON.stringify(entitlements)).not.toContain('price_secret_123');
  });
});

describe('AiEntitlementService.isKnownCapability / TOOL_CAPABILITIES — mapping completeness', () => {
  it('every one of the 9 declared AiCapability values is known', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(AiEntitlementService.isKnownCapability(capability)).toBe(true);
    }
  });

  it('a made-up string is never known', () => {
    expect(AiEntitlementService.isKnownCapability('made_up_capability')).toBe(false);
  });

  it('every real tool currently registered in AiToolRegistry has an explicit TOOL_CAPABILITIES entry (never silently falls through to null)', () => {
    for (const tool of AiToolRegistry.list()) {
      expect(Object.prototype.hasOwnProperty.call(TOOL_CAPABILITIES, tool.name)).toBe(true);
    }
  });

  it('every non-null TOOL_CAPABILITIES value is one of the 9 real capabilities', () => {
    for (const capability of Object.values(TOOL_CAPABILITIES)) {
      if (capability === null) continue;
      expect(AiEntitlementService.isKnownCapability(capability)).toBe(true);
    }
  });

  it('the real Tool -> Capability mapping matches this task\'s own audited assignment', () => {
    expect(getRequiredCapabilityForTool('get_order')).toBe('ai_chat');
    expect(getRequiredCapabilityForTool('get_orders')).toBe('ai_chat');
    expect(getRequiredCapabilityForTool('get_listing')).toBe('ai_chat');
    expect(getRequiredCapabilityForTool('get_listings')).toBe('ai_chat');
    expect(getRequiredCapabilityForTool('get_shipment')).toBe('ai_chat');
    expect(getRequiredCapabilityForTool('get_customer')).toBe('ai_chat');
    expect(getRequiredCapabilityForTool('get_customer_orders')).toBe('ai_chat');
    expect(getRequiredCapabilityForTool('get_product')).toBe('product_analysis');
    expect(getRequiredCapabilityForTool('get_inventory')).toBe('product_analysis');
    expect(getRequiredCapabilityForTool('get_sales_summary')).toBe('product_analysis');
    expect(getRequiredCapabilityForTool('calculate_margin')).toBe('product_analysis');
    expect(getRequiredCapabilityForTool('search_products')).toBe('sourcing');
    expect(getRequiredCapabilityForTool('generate_listing_draft')).toBe('listing_generation');
    expect(getRequiredCapabilityForTool('edit_listing_draft')).toBe('listing_edit');
    expect(getRequiredCapabilityForTool('update_listing')).toBe('listing_edit');
    expect(getRequiredCapabilityForTool('publish_listing')).toBe('marketplace_publish');
    expect(getRequiredCapabilityForTool('publish_etsy_listing')).toBe('marketplace_publish');
    expect(getRequiredCapabilityForTool('send_to_fulfillment')).toBe('fulfillment');
    expect(getRequiredCapabilityForTool('simulate_engage_action')).toBeNull();
  });

  it('a tool name not in the registry at all also gets null — never crashes, never silently authorized', () => {
    expect(getRequiredCapabilityForTool('some_future_tool_nobody_mapped_yet')).toBeNull();
  });
});
