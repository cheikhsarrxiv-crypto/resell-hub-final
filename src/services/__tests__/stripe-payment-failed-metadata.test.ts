/**
 * Proves the handlePaymentFailed() metadata-source fix. For subscription
 * invoices, Stripe snapshots the subscription's metadata onto
 * invoice.parent.subscription_details.metadata at finalization time (see
 * node_modules/stripe/cjs/resources/Invoices.d.ts, Parent.SubscriptionDetails)
 * — the invoice's own top-level `metadata` is a different field, never set
 * anywhere in this app.
 *
 * No real Stripe account is available in this environment, so the Invoice
 * payload is a hand-built fixture matching the shape documented in the
 * installed SDK's types (stripe v22.5.0), not a real webhook delivery.
 * Workspace/Subscription/Plan setup and the resulting DB state run against
 * a real PostgreSQL database (not mocked).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

// vi.hoisted runs before any import is evaluated (plain top-level statements
// do not, since ESM import hoisting always resolves imports first) — needed
// here because StripeService.ts constructs `new Stripe(...)` at module load,
// which throws if STRIPE_SECRET_KEY isn't set yet.
vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY =
    process.env.STRIPE_SECRET_KEY || 'sk_test_unit_test_placeholder_not_real';
});

import { PrismaClient } from '@prisma/client';
import { StripeService } from '@/services/StripeService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const createdUserIds: string[] = [];

async function createWorkspaceWithActiveSubscription() {
  const user = await prisma.user.create({
    data: {
      email: `payment-failed-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Payment Failed Test User',
      password: 'not-used',
    },
  });
  createdUserIds.push(user.id);

  const plan = await prisma.plan.create({
    data: {
      name: `payment-failed-test-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      displayName: 'Payment Failed Test Plan',
    },
  });

  const subscription = await prisma.subscription.create({
    data: { planId: plan.id, status: 'active' },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Payment Failed Test Workspace',
      slug: `payment-failed-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      subscriptionId: subscription.id,
    },
  });

  return { workspace, subscription };
}

function buildInvoice(
  parent: Stripe.Invoice.Parent | null,
  topLevelMetadata: Record<string, string> | null = null
): Stripe.Invoice {
  return { id: 'in_test_mock', parent, metadata: topLevelMetadata } as unknown as Stripe.Invoice;
}

describe.skipIf(!dbAvailable)('StripeService.handlePaymentFailed — Invoice metadata source', () => {
  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it('reads workspaceId from invoice.parent.subscription_details.metadata and marks the subscription past_due', async () => {
    const { workspace, subscription } = await createWorkspaceWithActiveSubscription();

    const invoice = buildInvoice({
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        subscription: 'sub_test_mock',
        metadata: { workspaceId: workspace.id },
      },
    });

    await StripeService.handlePaymentFailed(invoice);

    const updated = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    expect(updated?.status).toBe('past_due');
  });

  it('does nothing and does not throw when subscription_details.metadata has no workspaceId', async () => {
    const invoice = buildInvoice({
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        subscription: 'sub_test_mock',
        metadata: null,
      },
    });

    await StripeService.handlePaymentFailed(invoice); // must resolve without throwing
  });

  it('does nothing and does not throw when the invoice has no parent at all', async () => {
    const invoice = buildInvoice(null);

    await StripeService.handlePaymentFailed(invoice); // must resolve without throwing
  });
});
