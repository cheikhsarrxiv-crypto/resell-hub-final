/**
 * D-3 fix: StripeService.createCheckoutSession() now receives an explicit
 * billingPeriod ('monthly' | 'annual') and resolves the real Stripe Price
 * ID from the Plan row in the DB accordingly — never trusting any price
 * value the client might supply (CheckoutSessionData has no such field at
 * all), and never sending `price: null`/undefined to Stripe when the
 * requested cycle isn't configured for that plan.
 *
 * Uses a fully mocked @/lib/prisma and `stripe` SDK (no real DB/network
 * needed — unlike the sibling *-metadata.test.ts/*-blocks-double-
 * subscription.test.ts files, which run against a real Postgres and are
 * skipped in this sandbox), so this file actually runs and proves the fix
 * here and now.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockCheckoutSessionsCreate, mockCustomersCreate, planFindUniqueMock, workspaceFindUniqueMock, workspaceUpdateMock } = vi.hoisted(() => ({
  mockCheckoutSessionsCreate: vi.fn().mockResolvedValue({ id: 'cs_test_mock', url: 'https://checkout.stripe.com/test-mock' }),
  mockCustomersCreate: vi.fn().mockResolvedValue({ id: 'cus_test_mock' }),
  planFindUniqueMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  workspaceUpdateMock: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockCheckoutSessionsCreate } };
    customers = { create: mockCustomersCreate };
  },
}));

vi.mock('@/lib/prisma', () => {
  const client = {
    plan: { findUnique: planFindUniqueMock },
    workspace: { findUnique: workspaceFindUniqueMock, update: workspaceUpdateMock },
  };
  return { default: client, prisma: client };
});

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_unit_test_placeholder_not_real';

import { StripeService } from '@/services/StripeService';

const BASE_WORKSPACE = {
  id: 'ws-1',
  name: 'Test Workspace',
  stripeCustomerId: 'cus_existing_mock', // already has a customer — skips the customers.create branch
  subscription: null, // no existing subscription — never blocked by the double-subscription guard
};

const PLAN = {
  id: 'plan-1',
  name: 'starter',
  stripePriceIdMonthly: 'price_starter_monthly_mock',
  stripePriceIdAnnual: 'price_starter_annual_mock',
};

function baseParams(overrides: Partial<Parameters<typeof StripeService.createCheckoutSession>[0]> = {}) {
  return {
    planId: PLAN.id,
    billingPeriod: 'monthly' as const,
    workspaceId: BASE_WORKSPACE.id,
    email: 'buyer@example.com',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    ...overrides,
  };
}

describe('StripeService.createCheckoutSession — billingPeriod resolves the correct Price ID (D-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceFindUniqueMock.mockResolvedValue(BASE_WORKSPACE);
  });

  it.each([
    ['starter', 'monthly', 'price_starter_monthly_mock', 'price_starter_annual_mock'],
    ['starter', 'annual', 'price_starter_annual_mock', 'price_starter_monthly_mock'],
    ['pro', 'monthly', 'price_pro_monthly_mock', 'price_pro_annual_mock'],
    ['pro', 'annual', 'price_pro_annual_mock', 'price_pro_monthly_mock'],
    ['business', 'monthly', 'price_business_monthly_mock', 'price_business_annual_mock'],
    ['business', 'annual', 'price_business_annual_mock', 'price_business_monthly_mock'],
  ] as const)(
    '%s %s billing -> uses stripePriceId%s, never the other cycle\'s Price ID',
    async (planName, billingPeriod, expectedPriceId, wrongPriceId) => {
      const plan = {
        id: `plan-${planName}`,
        name: planName,
        stripePriceIdMonthly: billingPeriod === 'monthly' ? expectedPriceId : wrongPriceId,
        stripePriceIdAnnual: billingPeriod === 'annual' ? expectedPriceId : wrongPriceId,
      };
      planFindUniqueMock.mockResolvedValue(plan);

      await StripeService.createCheckoutSession(baseParams({ planId: plan.id, billingPeriod }));

      expect(mockCheckoutSessionsCreate).toHaveBeenCalledTimes(1);
      const callArg = mockCheckoutSessionsCreate.mock.calls[0][0];
      expect(callArg.line_items[0].price).toBe(expectedPriceId);
      expect(callArg.line_items[0].price).not.toBe(wrongPriceId);
      expect(callArg.metadata.billingPeriod).toBe(billingPeriod);
      expect(callArg.subscription_data.metadata.billingPeriod).toBe(billingPeriod);
    }
  );

  it('monthly requested but stripePriceIdMonthly is null -> refuses cleanly, never calls Stripe, never sends null', async () => {
    planFindUniqueMock.mockResolvedValue({ ...PLAN, stripePriceIdMonthly: null });

    await expect(
      StripeService.createCheckoutSession(baseParams({ billingPeriod: 'monthly' }))
    ).rejects.toThrow(/not configured for monthly billing/);

    expect(mockCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('annual requested but stripePriceIdAnnual is null -> refuses cleanly, never calls Stripe, never sends null', async () => {
    planFindUniqueMock.mockResolvedValue({ ...PLAN, stripePriceIdAnnual: null });

    await expect(
      StripeService.createCheckoutSession(baseParams({ billingPeriod: 'annual' }))
    ).rejects.toThrow(/not configured for annual billing/);

    expect(mockCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('Enterprise (both Price IDs null) -> refused for either billing period, matching its "Contact us" design', async () => {
    const enterprisePlan = { id: 'plan-enterprise', name: 'enterprise', stripePriceIdMonthly: null, stripePriceIdAnnual: null };
    planFindUniqueMock.mockResolvedValue(enterprisePlan);

    await expect(
      StripeService.createCheckoutSession(baseParams({ planId: enterprisePlan.id, billingPeriod: 'monthly' }))
    ).rejects.toThrow(/not configured for monthly billing/);

    await expect(
      StripeService.createCheckoutSession(baseParams({ planId: enterprisePlan.id, billingPeriod: 'annual' }))
    ).rejects.toThrow(/not configured for annual billing/);

    expect(mockCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('never sends price: null or price: undefined to Stripe under any refusal path', async () => {
    planFindUniqueMock.mockResolvedValue({ ...PLAN, stripePriceIdAnnual: null });

    await expect(StripeService.createCheckoutSession(baseParams({ billingPeriod: 'annual' }))).rejects.toThrow();

    for (const call of mockCheckoutSessionsCreate.mock.calls) {
      expect(call[0]?.line_items?.[0]?.price).not.toBeNull();
      expect(call[0]?.line_items?.[0]?.price).not.toBeUndefined();
    }
    expect(mockCheckoutSessionsCreate).not.toHaveBeenCalled();
  });
});
