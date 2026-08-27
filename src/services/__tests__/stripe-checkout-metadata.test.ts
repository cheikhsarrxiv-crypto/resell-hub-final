/**
 * Proves the Stripe checkout metadata fix: Checkout Session top-level
 * `metadata` is NOT copied to the Subscription it creates in `mode:
 * 'subscription'` — only `subscription_data.metadata` is. Since the
 * customer.subscription.* webhook handlers (handleSubscriptionCreated/
 * Updated/Deleted) read `subscription.metadata` directly, workspaceId/
 * planId/planName must also be set there, or paid subscriptions never get
 * linked to a workspace.
 *
 * No real Stripe account/keys are available in this environment, so the
 * Stripe SDK itself is mocked — this test asserts the call Stripe.js
 * receives is constructed correctly, not real Stripe API behavior. The
 * Plan/Workspace/User lookups StripeService performs run against a real
 * PostgreSQL database (not mocked), consistent with the rest of this suite.
 */
import { vi, describe, it, expect } from 'vitest';

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

describe.skipIf(!dbAvailable)(
  'StripeService.createCheckoutSession — subscription_data.metadata',
  () => {
    it('sets workspaceId, planId, and planName in subscription_data.metadata, alongside the existing top-level metadata', async () => {
      const user = await prisma.user.create({
        data: {
          email: `stripe-meta-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
          name: 'Stripe Meta Test User',
          password: 'not-used',
        },
      });
      const plan = await prisma.plan.create({
        data: {
          name: `stripe-meta-test-plan-${Date.now()}`,
          displayName: 'Stripe Meta Test Plan',
          stripePriceIdMonthly: 'price_test_mock',
        },
      });
      const workspace = await prisma.workspace.create({
        data: {
          name: 'Stripe Meta Test Workspace',
          slug: `stripe-meta-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          userId: user.id,
        },
      });

      try {
        await StripeService.createCheckoutSession({
          planId: plan.id,
          workspaceId: workspace.id,
          email: user.email,
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        expect(mockCheckoutSessionsCreate).toHaveBeenCalledTimes(1);
        const callArg = mockCheckoutSessionsCreate.mock.calls[0][0];

        const expectedMetadata = {
          workspaceId: workspace.id,
          planId: plan.id,
          planName: plan.name,
        };

        // Pre-existing Session-level metadata must still be present (not removed).
        expect(callArg.metadata).toEqual(expectedMetadata);

        // The fix: the same values must ALSO be under subscription_data.metadata —
        // the only place customer.subscription.* webhooks can read them from.
        expect(callArg.subscription_data).toBeDefined();
        expect(callArg.subscription_data.metadata).toEqual(expectedMetadata);
      } finally {
        await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => {});
        await prisma.plan.delete({ where: { id: plan.id } }).catch(() => {});
        await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      }
    });
  }
);
