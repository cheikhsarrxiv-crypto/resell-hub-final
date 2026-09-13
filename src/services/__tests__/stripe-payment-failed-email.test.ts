/**
 * Proves the payment-failed email fix: handlePaymentFailed() now emails the
 * workspace owner via EmailService.sendPaymentFailedNotification, exactly
 * once per failure episode, without changing the existing past_due status
 * logic or its idempotency guard.
 *
 * Same conventions as stripe-payment-failed-metadata.test.ts: real
 * PostgreSQL (no mocked DB), hand-built Invoice fixtures (no real Stripe
 * account here). EmailService is spied on rather than asserting real
 * third-party delivery (EMAIL_PROVIDER is unset/'none' in this environment).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type Stripe from 'stripe';

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY =
    process.env.STRIPE_SECRET_KEY || 'sk_test_unit_test_placeholder_not_real';
});

import { PrismaClient } from '@prisma/client';
import { StripeService } from '@/services/StripeService';
import { EmailService } from '@/services/EmailService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const createdUserIds: string[] = [];

async function createWorkspaceWithActiveSubscription(email?: string) {
  const user = await prisma.user.create({
    data: {
      email: email || `payment-failed-email-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Payment Failed Email Test User',
      password: 'not-used',
    },
  });
  createdUserIds.push(user.id);

  const plan = await prisma.plan.create({
    data: {
      name: `payment-failed-email-test-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      displayName: 'Payment Failed Email Test Plan',
    },
  });

  const subscription = await prisma.subscription.create({
    data: { planId: plan.id, status: 'active' },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Payment Failed Email Test Workspace',
      slug: `payment-failed-email-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId: user.id,
      subscriptionId: subscription.id,
    },
  });

  return { user, workspace, subscription };
}

function buildInvoice(workspaceId: string, amountDue = 2900): Stripe.Invoice {
  return {
    id: 'in_test_mock',
    amount_due: amountDue,
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        subscription: 'sub_test_mock',
        metadata: { workspaceId },
      },
    },
    metadata: null,
  } as unknown as Stripe.Invoice;
}

describe.skipIf(!dbAvailable)('StripeService.handlePaymentFailed — email notification', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of createdUserIds.splice(0)) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it('sends the payment-failed email to the workspace owner with the invoice amount', async () => {
    const { user, workspace, subscription } = await createWorkspaceWithActiveSubscription();
    const sendSpy = vi.spyOn(EmailService, 'sendPaymentFailedNotification');

    await StripeService.handlePaymentFailed(buildInvoice(workspace.id, 2900));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [toEmail, amount] = sendSpy.mock.calls[0] as [string, number];
    expect(toEmail).toBe(user.email);
    expect(amount).toBe(29); // amount_due is in cents (2900 = €29.00)

    const updated = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    expect(updated?.status).toBe('past_due'); // existing status logic untouched
  });

  it('does not send a second email when the subscription is already past_due (dunning retry)', async () => {
    const { workspace } = await createWorkspaceWithActiveSubscription();
    const sendSpy = vi.spyOn(EmailService, 'sendPaymentFailedNotification');

    // First failure: applies past_due and sends the email.
    await StripeService.handlePaymentFailed(buildInvoice(workspace.id));
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // A second, distinct invoice.payment_failed event for the same ongoing
    // failure (Stripe's own dunning retry) — same workspace, already past_due.
    await StripeService.handlePaymentFailed(buildInvoice(workspace.id));
    expect(sendSpy).toHaveBeenCalledTimes(1); // still just once, no double send
  });

  it('does not throw and still applies past_due when the email provider fails', async () => {
    const { workspace, subscription } = await createWorkspaceWithActiveSubscription();
    vi.spyOn(EmailService, 'sendPaymentFailedNotification').mockRejectedValue(
      new Error('provider unavailable')
    );

    await StripeService.handlePaymentFailed(buildInvoice(workspace.id)); // must resolve without throwing

    const updated = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    expect(updated?.status).toBe('past_due'); // status update is not rolled back by the email failure
  });

  it('does not send an email when there is no workspaceId in the invoice metadata', async () => {
    const sendSpy = vi.spyOn(EmailService, 'sendPaymentFailedNotification');

    await StripeService.handlePaymentFailed({
      id: 'in_test_mock_no_metadata',
      amount_due: 1000,
      parent: null,
      metadata: null,
    } as unknown as Stripe.Invoice);

    expect(sendSpy).not.toHaveBeenCalled();
  });
});
