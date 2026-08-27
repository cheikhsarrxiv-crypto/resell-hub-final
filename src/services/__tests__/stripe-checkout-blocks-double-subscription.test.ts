/**
 * Proves the double-subscription fix: createCheckoutSession() must refuse
 * to open a new Checkout Session whenever the workspace's existing
 * subscription is a real, still-open Stripe subscription (any status
 * except the two terminal ones, "canceled" and "incomplete_expired") —
 * going through Checkout again would create a second real Stripe
 * subscription (double billing), not change the existing one. A
 * terminal-state prior subscription, or no subscription at all, must NOT
 * block a new checkout.
 *
 * No real Stripe account/keys are available here, so the Stripe SDK is
 * mocked at the network layer only (as in stripe-checkout-metadata.test.ts)
 * — Plan/Workspace/Subscription setup and the assertion that Stripe was
 * never called run against a real PostgreSQL database.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockCheckoutSessionsCreate, mockCustomersCreate } = vi.hoisted(() => ({
  mockCheckoutSessionsCreate: vi.fn().mockResolvedValue({
    id: 'cs_test_mock',
    url: 'https://checkout.stripe.com/test-mock',
  }),
  mockCustomersCreate: vi.fn().mockResolvedValue({ id: 'cus_test_mock' }),
}));

vi.mock('stripe', () => ({
  default: class MockStripe {
    checkout = { sessions: { create: mockCheckoutSessionsCreate } };
    customers = { create: mockCustomersCreate };
  },
}));

process.env.STRIPE_SECRET_KEY =
  process.env.STRIPE_SECRET_KEY || 'sk_test_unit_test_placeholder_not_real';

import { PrismaClient } from '@prisma/client';
import { StripeService } from '@/services/StripeService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

async function createWorkspaceWithSubscription(status: string, stripeSubscriptionId: string | null) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `double-sub-test-${suffix}@example.com`,
      name: 'Double Sub Test User',
      password: 'not-used',
    },
  });
  const plan = await prisma.plan.create({
    data: {
      name: `double-sub-plan-${suffix}`,
      displayName: 'Double Sub Test Plan',
      stripePriceIdMonthly: 'price_test_mock',
    },
  });
  const subscription = await prisma.subscription.create({
    data: { planId: plan.id, status, stripeSubscriptionId: stripeSubscriptionId ?? undefined },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Double Sub Test Workspace',
      slug: `double-sub-test-${suffix}`,
      userId: user.id,
      subscriptionId: subscription.id,
    },
  });
  return { user, plan, subscription, workspace };
}

async function cleanup(entities: { workspace: any; subscription: any; plan: any; user: any }) {
  await prisma.workspace.delete({ where: { id: entities.workspace.id } }).catch(() => {});
  await prisma.subscription.delete({ where: { id: entities.subscription.id } }).catch(() => {});
  await prisma.plan.delete({ where: { id: entities.plan.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: entities.user.id } }).catch(() => {});
}

describe.skipIf(!dbAvailable)('StripeService.createCheckoutSession — blocks a second active subscription', () => {
  beforeEach(() => {
    mockCheckoutSessionsCreate.mockClear();
    mockCustomersCreate.mockClear();
  });

  const NON_TERMINAL_STATUSES = [
    'incomplete',
    'trialing',
    'active',
    'past_due',
    'unpaid',
    'paused',
  ];

  it.each(NON_TERMINAL_STATUSES)(
    'refuses to create a Checkout Session when the existing subscription status is "%s" (a real, still-open Stripe subscription)',
    async (status) => {
      // handlePaymentFailed only marks the subscription past_due — it
      // never cancels the underlying Stripe subscription — and none of
      // these other statuses represent a cancelled/dead subscription
      // either, so all of them must block, not just "active".
      const entities = await createWorkspaceWithSubscription(status, `sub_existing_${status}_mock`);

      try {
        await expect(
          StripeService.createCheckoutSession({
            planId: entities.plan.id,
            workspaceId: entities.workspace.id,
            email: entities.user.email,
            successUrl: 'https://example.com/success',
            cancelUrl: 'https://example.com/cancel',
          })
        ).rejects.toThrow('already has an active subscription');

        expect(mockCheckoutSessionsCreate).not.toHaveBeenCalled();
      } finally {
        await cleanup(entities);
      }
    }
  );

  const TERMINAL_STATUSES = ['canceled', 'incomplete_expired'];

  it.each(TERMINAL_STATUSES)(
    'still allows checkout when the existing subscription status is "%s" (a terminal state), even with a stripeSubscriptionId retained',
    async (status) => {
      // The interesting case: stripeSubscriptionId is still present
      // (Stripe keeps the ID around even for a dead subscription), but
      // the status is one of the two terminal values that must NOT block
      // a new checkout. "incomplete_expired" in particular is Stripe's
      // status when the very first payment (e.g. an abandoned/expired
      // 3D Secure confirmation) never completed — it never becomes
      // "canceled", but it is just as dead: no billing, no way back to
      // "active".
      const entities = await createWorkspaceWithSubscription(status, `sub_old_${status}_mock`);

      try {
        const session = await StripeService.createCheckoutSession({
          planId: entities.plan.id,
          workspaceId: entities.workspace.id,
          email: entities.user.email,
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        expect(session.id).toBe('cs_test_mock');
        expect(mockCheckoutSessionsCreate).toHaveBeenCalledTimes(1);
      } finally {
        await cleanup(entities);
      }
    }
  );

  it('allows checkout for a workspace with no subscription at all (new signup, free plan)', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `no-sub-test-${suffix}@example.com`, name: 'No Sub Test', password: 'not-used' },
    });
    const plan = await prisma.plan.create({
      data: {
        name: `no-sub-plan-${suffix}`,
        displayName: 'No Sub Test Plan',
        stripePriceIdMonthly: 'price_test_mock',
      },
    });
    const workspace = await prisma.workspace.create({
      data: { name: 'No Sub Test Workspace', slug: `no-sub-test-${suffix}`, userId: user.id },
    });

    try {
      const session = await StripeService.createCheckoutSession({
        planId: plan.id,
        workspaceId: workspace.id,
        email: user.email,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(session.id).toBe('cs_test_mock');
      expect(mockCheckoutSessionsCreate).toHaveBeenCalledTimes(1);
    } finally {
      await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => {});
      await prisma.plan.delete({ where: { id: plan.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});
