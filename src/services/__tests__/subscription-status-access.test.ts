/**
 * Real behavioral tests for the subscription-status-access fix:
 * SubscriptionService.getSubscription() now fails closed on a real
 * Subscription row whose Stripe status doesn't grant access (canceled/
 * unpaid/incomplete/incomplete_expired/unrecognized) — treating it exactly
 * like "no subscription at all" (falls back to the real Free plan) rather
 * than trusting a stale paid planId. hasFeature/getPlanLimits/isLimitReached
 * all resolve through getSubscription(), so this single fix cascades to all
 * three without duplicating the check anywhere else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { workspaceFindUniqueMock, planFindUniqueMock, productCountMock, fulfillmentPartnerFindManyMock, getOrderMock, sendToFulfillmentMock } = vi.hoisted(() => ({
  workspaceFindUniqueMock: vi.fn(),
  planFindUniqueMock: vi.fn(),
  productCountMock: vi.fn(),
  fulfillmentPartnerFindManyMock: vi.fn(),
  getOrderMock: vi.fn(),
  sendToFulfillmentMock: vi.fn(),
}));

vi.mock('@/services/OrderService', () => ({
  OrderService: { getOrder: getOrderMock },
}));
vi.mock('@/services/FulfillmentService', () => ({
  FulfillmentService: { sendToFulfillment: sendToFulfillmentMock },
}));
vi.mock('@/services/ListingService', () => ({
  ListingService: { getListing: vi.fn(), updateListing: vi.fn() },
  getAuthenticatedAdapter: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  // Real @/lib/prisma exports the SAME client both as `default` and as the
  // named `prisma` export (see that file's own source) — mirrored here as
  // one shared object so both import styles used across the codebase
  // (SubscriptionService uses the default import, actionTools.ts uses the
  // named one) see the exact same tables/mocks.
  const client = {
    workspace: { findUnique: workspaceFindUniqueMock },
    plan: { findUnique: planFindUniqueMock },
    product: { count: productCountMock },
    listing: { count: vi.fn().mockResolvedValue(0) },
    order: { count: vi.fn().mockResolvedValue(0) },
    marketplaceConnection: { count: vi.fn().mockResolvedValue(0) },
    fulfillmentPartner: { findMany: fulfillmentPartnerFindManyMock, findUnique: vi.fn() },
  };
  return { default: client, prisma: client };
});

import { SubscriptionService, ACCESS_GRANTING_SUBSCRIPTION_STATUSES } from '@/services/SubscriptionService';

const FREE_PLAN = {
  id: 'plan-free',
  name: 'free',
  maxProducts: 10,
  maxListings: 20,
  maxOrders: 50,
  maxMarketplaces: 2,
  maxUsers: 1,
  fulfillmentEnabled: false,
  advancedAnalytics: false,
  apiAccess: false,
  aiAssistant: false,
};

const BUSINESS_PLAN = {
  id: 'plan-business',
  name: 'business',
  maxProducts: 5000,
  maxListings: 10000,
  maxOrders: 10000,
  maxMarketplaces: 4,
  maxUsers: 5,
  fulfillmentEnabled: true,
  advancedAnalytics: true,
  apiAccess: true,
  aiAssistant: true,
};

function makeWorkspace(subscriptionStatus: string | null, plan = BUSINESS_PLAN) {
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

describe('SubscriptionService — subscription status access (fail-closed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planFindUniqueMock.mockResolvedValue(FREE_PLAN);
  });

  describe('A. active/trialing/past_due grant full plan access', () => {
    it('active + feature enabled on the plan -> granted', async () => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('active'));
      expect(await SubscriptionService.hasFeature('ws-1', 'aiAssistant')).toBe(true);
    });

    it('active + feature disabled on the plan -> refused (plan-level gate still applies)', async () => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('active', FREE_PLAN));
      expect(await SubscriptionService.hasFeature('ws-1', 'aiAssistant')).toBe(false);
    });

    it('trialing -> granted (never actually produced today, but Stripe-correct)', async () => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('trialing'));
      expect(await SubscriptionService.hasFeature('ws-1', 'fulfillmentEnabled')).toBe(true);
    });

    it('past_due -> granted (grace period, not a lockout — matches StripeService.handlePaymentFailed\'s own email-only behavior)', async () => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('past_due'));
      expect(await SubscriptionService.hasFeature('ws-1', 'fulfillmentEnabled')).toBe(true);
      expect(await SubscriptionService.hasFeature('ws-1', 'aiAssistant')).toBe(true);
    });
  });

  describe('B/C. canceled/unpaid/incomplete/incomplete_expired/unknown refuse access — fall back to the real Free plan', () => {
    it.each(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'some_future_stripe_status'])(
      'status "%s" -> hasFeature refused, even though subscription.planId still points at a paid plan',
      async (status) => {
        workspaceFindUniqueMock.mockResolvedValue(makeWorkspace(status));

        expect(await SubscriptionService.hasFeature('ws-1', 'aiAssistant')).toBe(false);
        expect(await SubscriptionService.hasFeature('ws-1', 'fulfillmentEnabled')).toBe(false);
        expect(await SubscriptionService.hasFeature('ws-1', 'advancedAnalytics')).toBe(false);
        expect(await SubscriptionService.hasFeature('ws-1', 'apiAccess')).toBe(false);
      }
    );

    it('canceled subscription falls back to the real Free plan\'s limits (getPlanLimits), never the stale paid plan\'s', async () => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('canceled'));

      const limits = await SubscriptionService.getPlanLimits('ws-1');

      expect(limits).toEqual({
        maxProducts: FREE_PLAN.maxProducts,
        maxListings: FREE_PLAN.maxListings,
        maxOrders: FREE_PLAN.maxOrders,
        maxMarketplaces: FREE_PLAN.maxMarketplaces,
        maxUsers: FREE_PLAN.maxUsers,
      });
    });

    it('unpaid subscription -> isLimitReached uses the Free plan\'s (lower) limits, not the paid plan\'s', async () => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('unpaid'));
      productCountMock.mockResolvedValue(15); // above Free's maxProducts (10), below Business's (5000)

      const reached = await SubscriptionService.isLimitReached('ws-1', 'products');

      expect(reached).toBe(true); // would be false if the stale Business limit (5000) were used
    });

    it('the real subscription row (status, stripeSubscriptionId, currentPeriodEnd) is still returned for display, only the effective plan changes', async () => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('canceled'));

      const subscription: any = await SubscriptionService.getSubscription('ws-1');

      expect(subscription.status).toBe('canceled');
      expect(subscription.stripeSubscriptionId).toBe('sub_stripe_1');
      expect(subscription.plan.name).toBe('free');
      expect(subscription.planId).toBe(FREE_PLAN.id);
    });
  });

  describe('fail-closed edge cases', () => {
    it('no subscription at all -> Free plan, unaffected by this fix (pre-existing behavior)', async () => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace(null));
      expect(await SubscriptionService.hasFeature('ws-1', 'aiAssistant')).toBe(false);
    });

    it('subscription references a plan but Free plan lookup fails -> hasFeature still refuses rather than crashing or silently granting access', async () => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('canceled'));
      planFindUniqueMock.mockResolvedValue(null); // Free plan missing entirely — pathological state

      const result = await SubscriptionService.hasFeature('ws-1', 'aiAssistant');

      expect(result).toBe(false);
    });

    it('workspace not found -> hasFeature returns false, never throws', async () => {
      workspaceFindUniqueMock.mockResolvedValue(null);
      expect(await SubscriptionService.hasFeature('ws-1', 'aiAssistant')).toBe(false);
    });

    it('isAccessGrantingStatus is a pure allow-list — an unrecognized status is never granted', () => {
      expect(SubscriptionService.isAccessGrantingStatus('some_made_up_status')).toBe(false);
      expect(ACCESS_GRANTING_SUBSCRIPTION_STATUSES.has('some_made_up_status')).toBe(false);
    });
  });

  describe('workspace isolation', () => {
    it('two different workspaces with different statuses never affect each other', async () => {
      workspaceFindUniqueMock.mockImplementation(async ({ where }: any) =>
        where.id === 'ws-active' ? makeWorkspace('active') : makeWorkspace('canceled')
      );

      expect(await SubscriptionService.hasFeature('ws-active', 'aiAssistant')).toBe(true);
      expect(await SubscriptionService.hasFeature('ws-canceled', 'aiAssistant')).toBe(false);
    });
  });

  describe('free feature (no plan gate) remains available regardless of status', () => {
    it('a feature the Free plan already grants stays available even on a canceled subscription', async () => {
      const freeWithFeature = { ...FREE_PLAN, apiAccess: true };
      planFindUniqueMock.mockResolvedValue(freeWithFeature);
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('canceled', BUSINESS_PLAN));

      expect(await SubscriptionService.hasFeature('ws-1', 'apiAccess')).toBe(true);
    });
  });
});

describe('send_to_fulfillment — non-regression with the corrected subscription-status logic (REAL SubscriptionService, not mocked)', () => {

  function makeOrder(overrides: Record<string, any> = {}) {
    return {
      id: 'order-1',
      workspaceId: 'ws-1',
      status: 'pending',
      fulfillmentOrder: null,
      items: [{ productId: 'product-1', title: 'Prada Sneakers', quantity: 1 }],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    planFindUniqueMock.mockResolvedValue(FREE_PLAN);
    fulfillmentPartnerFindManyMock.mockResolvedValue([{ id: 'partner-1', name: 'ShipMock France', status: 'active', country: 'FR', costPerOrder: 5, processingTime: 24, deliveryTime: 48 }]);
  });

  it('preview() reports fulfillmentEnabledForPlan:true for a past_due workspace (grace period preserved by the fix)', async () => {
    const { sendToFulfillmentTool } = await import('@/services/ai/tools/actionTools');
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('past_due'));
    getOrderMock.mockResolvedValue(makeOrder());

    const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1' });

    expect(result.fulfillmentEnabledForPlan).toBe(true);
  });

  it('preview() reports fulfillmentEnabledForPlan:false for a canceled workspace, even though Subscription.planId still points at Business', async () => {
    const { sendToFulfillmentTool } = await import('@/services/ai/tools/actionTools');
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspace('canceled'));
    getOrderMock.mockResolvedValue(makeOrder());

    const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1' });

    expect(result.fulfillmentEnabledForPlan).toBe(false);
    expect(result.message).toMatch(/does not include fulfillment/i);
  });
});
