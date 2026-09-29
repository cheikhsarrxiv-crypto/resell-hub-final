/**
 * D-1 fix: StripeService.handleSubscriptionUpdated() now resolves the
 * CURRENT plan from the real Stripe Price ID on
 * subscription.items.data[0].price.id — matched against both
 * stripePriceIdMonthly and stripePriceIdAnnual — instead of trusting
 * subscription.metadata.planId (only ever set once, at Checkout time,
 * and never updated by Stripe when the price changes later, e.g. via the
 * customer portal).
 *
 * Fully mocked @/lib/prisma — no real DB needed, runs in this sandbox.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { planFindFirstMock, workspaceFindUniqueMock, subscriptionUpdateMock } = vi.hoisted(() => ({
  planFindFirstMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  subscriptionUpdateMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const client = {
    plan: { findFirst: planFindFirstMock },
    workspace: { findUnique: workspaceFindUniqueMock },
    subscription: { update: subscriptionUpdateMock },
  };
  return { default: client, prisma: client };
});

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_unit_test_placeholder_not_real';

import { StripeService } from '@/services/StripeService';

const STARTER_MONTHLY = { id: 'plan-starter', name: 'starter', stripePriceIdMonthly: 'price_starter_m', stripePriceIdAnnual: 'price_starter_a' };
const PRO = { id: 'plan-pro', name: 'pro', stripePriceIdMonthly: 'price_pro_m', stripePriceIdAnnual: 'price_pro_a' };
const BUSINESS = { id: 'plan-business', name: 'business', stripePriceIdMonthly: 'price_business_m', stripePriceIdAnnual: 'price_business_a' };
const ALL_PLANS = [STARTER_MONTHLY, PRO, BUSINESS];

function resolvePlanByPriceId(priceId: string) {
  return ALL_PLANS.find((p) => p.stripePriceIdMonthly === priceId || p.stripePriceIdAnnual === priceId) ?? null;
}

function makeStripeSubscription(priceId: string | undefined, overrides: Record<string, any> = {}) {
  return {
    id: 'sub_mock_1',
    status: 'active',
    metadata: { workspaceId: 'ws-1', planId: 'stale-planId-from-checkout-time' },
    items: { data: priceId ? [{ price: { id: priceId } }] : [] },
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    ...overrides,
  } as any;
}

const EXISTING_WORKSPACE = {
  id: 'ws-1',
  subscription: { id: 'db-sub-1', planId: STARTER_MONTHLY.id, status: 'active' },
};

describe('StripeService.handleSubscriptionUpdated — resolves the plan from the real Price ID (D-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceFindUniqueMock.mockResolvedValue(EXISTING_WORKSPACE);
    planFindFirstMock.mockImplementation(async ({ where }: any) => {
      const priceId = where.OR[0].stripePriceIdMonthly ?? where.OR[1].stripePriceIdAnnual;
      return resolvePlanByPriceId(priceId);
    });
    subscriptionUpdateMock.mockResolvedValue({});
  });

  it('Starter monthly -> Pro monthly: updates planId to Pro, ignores the stale metadata.planId', async () => {
    await StripeService.handleSubscriptionUpdated(makeStripeSubscription(PRO.stripePriceIdMonthly));

    expect(subscriptionUpdateMock).toHaveBeenCalledTimes(1);
    const data = subscriptionUpdateMock.mock.calls[0][0].data;
    expect(data.planId).toBe(PRO.id);
    expect(data.planId).not.toBe('stale-planId-from-checkout-time');
  });

  it('Starter monthly -> Pro annual: resolves via stripePriceIdAnnual, still lands on the Pro plan', async () => {
    await StripeService.handleSubscriptionUpdated(makeStripeSubscription(PRO.stripePriceIdAnnual));

    const data = subscriptionUpdateMock.mock.calls[0][0].data;
    expect(data.planId).toBe(PRO.id);
  });

  it('Pro annual -> Business monthly: cross-plan AND cross-cycle change both resolved correctly', async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      id: 'ws-1',
      subscription: { id: 'db-sub-1', planId: PRO.id, status: 'active' },
    });

    await StripeService.handleSubscriptionUpdated(makeStripeSubscription(BUSINESS.stripePriceIdMonthly));

    const data = subscriptionUpdateMock.mock.calls[0][0].data;
    expect(data.planId).toBe(BUSINESS.id);
  });

  it('downgrade (Business -> Starter) is resolved exactly like an upgrade — no special-casing based on direction', async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      id: 'ws-1',
      subscription: { id: 'db-sub-1', planId: BUSINESS.id, status: 'active' },
    });

    await StripeService.handleSubscriptionUpdated(makeStripeSubscription(STARTER_MONTHLY.stripePriceIdMonthly));

    const data = subscriptionUpdateMock.mock.calls[0][0].data;
    expect(data.planId).toBe(STARTER_MONTHLY.id);
  });

  it('also updates status/currentPeriodStart/currentPeriodEnd alongside planId (pre-existing behavior preserved)', async () => {
    await StripeService.handleSubscriptionUpdated(
      makeStripeSubscription(PRO.stripePriceIdMonthly, { status: 'past_due' })
    );

    const data = subscriptionUpdateMock.mock.calls[0][0].data;
    expect(data.status).toBe('past_due');
    expect(data.currentPeriodStart).toEqual(new Date(1_700_000_000 * 1000));
    expect(data.currentPeriodEnd).toEqual(new Date(1_702_592_000 * 1000));
  });

  it('an unrecognized Stripe Price ID -> throws, never writes anything, never guesses a plan', async () => {
    await expect(
      StripeService.handleSubscriptionUpdated(makeStripeSubscription('price_completely_unknown'))
    ).rejects.toThrow(/Unrecognized Stripe Price ID/);

    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it('a subscription update event with no price item at all -> throws, never writes anything', async () => {
    await expect(
      StripeService.handleSubscriptionUpdated(makeStripeSubscription(undefined))
    ).rejects.toThrow(/no price id/);

    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });

  it('repeated delivery of the same update event is idempotent at this layer: calling it twice yields the same final planId, never drifts', async () => {
    const subscription = makeStripeSubscription(PRO.stripePriceIdMonthly);

    await StripeService.handleSubscriptionUpdated(subscription);
    await StripeService.handleSubscriptionUpdated(subscription);

    expect(subscriptionUpdateMock).toHaveBeenCalledTimes(2);
    const firstCallPlanId = subscriptionUpdateMock.mock.calls[0][0].data.planId;
    const secondCallPlanId = subscriptionUpdateMock.mock.calls[1][0].data.planId;
    expect(firstCallPlanId).toBe(secondCallPlanId);
    expect(firstCallPlanId).toBe(PRO.id);
    // Dedup itself (never processing the SAME Stripe event.id twice) is the
    // webhook route's own job — see webhooks-idempotency.test.ts. This
    // test only proves handleSubscriptionUpdated's own logic never
    // produces a different/inconsistent result on a legitimate replay.
  });

  it('never trusts a workspaceId that did not come from subscription.metadata', async () => {
    await expect(
      StripeService.handleSubscriptionUpdated(makeStripeSubscription(PRO.stripePriceIdMonthly, { metadata: {} }))
    ).rejects.toThrow('Missing workspaceId in metadata');

    expect(subscriptionUpdateMock).not.toHaveBeenCalled();
  });
});
