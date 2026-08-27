import Stripe from 'stripe';
import prisma from '@/lib/prisma';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // Use default API version
});

export interface CheckoutSessionData {
  planId: string;
  workspaceId: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
}

export interface WebhookEvent {
  type: string;
  data: any;
}

export class StripeService {
  /**
   * Create checkout session for plan upgrade
   * SECURITY: Uses Stripe Price IDs (not ad-hoc pricing)
   * IDEMPOTENT: Reuses existing Stripe customer if exists
   */
  static async createCheckoutSession(data: CheckoutSessionData) {
    try {
      // Validate plan exists and has Stripe Price ID
      const plan = await prisma.plan.findUnique({
        where: { id: data.planId },
      });

      if (!plan) {
        throw new Error('Plan not found');
      }

      // CRITICAL: Verify plan has Stripe Price ID
      if (!plan.stripePriceIdMonthly) {
        throw new Error(`Plan ${plan.name} not configured for Stripe. Missing Price ID.`);
      }

      // SECURITY: Verify workspace exists and is accessible
      const workspace = await prisma.workspace.findUnique({
        where: { id: data.workspaceId },
        include: { subscription: true },
      });

      if (!workspace) {
        throw new Error('Workspace not found');
      }

      // BILLING INTEGRITY: Refuse to open a second Checkout Session while a
      // real Stripe subscription still exists in any non-terminal state —
      // going through Checkout again would create a second real Stripe
      // subscription (double billing) rather than changing the existing
      // one. handleSubscriptionCreated/Updated copy Stripe's
      // subscription.status verbatim, so this can be any of Stripe's real
      // values: "incomplete", "trialing", "active", "past_due", "unpaid",
      // "paused" all still represent a real, currently-open Stripe
      // subscription — a "past_due" one in particular is NOT cancelled by
      // handlePaymentFailed, it only marks the row past_due, so it must
      // block too. Only "canceled" and "incomplete_expired" are terminal:
      // the subscription is genuinely dead (no billing, no way to reach
      // "active" again), so a brand-new Checkout must be allowed. A
      // workspace with no subscription, or one whose stripeSubscriptionId
      // is unset (e.g. the Free plan, which never goes through Stripe), is
      // unaffected either way. Managing/changing an existing non-terminal
      // subscription goes through the customer portal instead.
      const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired']);

      if (
        workspace.subscription?.stripeSubscriptionId &&
        !TERMINAL_SUBSCRIPTION_STATUSES.has(workspace.subscription.status)
      ) {
        throw new Error(
          'Workspace already has an active subscription. Use the billing portal to manage it.'
        );
      }

      // Get or create Stripe customer (IDEMPOTENT)
      let stripeCustomerId = workspace.stripeCustomerId;

      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: data.email,
          metadata: {
            workspaceId: data.workspaceId,
            workspaceName: workspace.name,
          },
        });
        stripeCustomerId = customer.id;

        // SECURITY: Only update stripeCustomerId, not entire workspace
        await prisma.workspace.update({
          where: { id: data.workspaceId },
          data: { stripeCustomerId },
        });
      }

      // Create checkout session using Stripe Price ID (BEST PRACTICE)
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: plan.stripePriceIdMonthly, // Use Price ID, not price_data
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: data.successUrl,
        cancel_url: data.cancelUrl,
        metadata: {
          workspaceId: data.workspaceId,
          planId: data.planId,
          planName: plan.name,
        },
        // Checkout Session metadata (above) is NOT copied to the Subscription
        // it creates — it must be set here explicitly, or the
        // customer.subscription.* webhooks (which read subscription.metadata)
        // never see workspaceId/planId at all.
        subscription_data: {
          metadata: {
            workspaceId: data.workspaceId,
            planId: data.planId,
            planName: plan.name,
          },
        },
      });

      return session;
    } catch (error) {
      console.error('[StripeService] Checkout creation error:', error);
      throw error;
    }
  }

  /**
   * Handle subscription created webhook
   * IDEMPOTENT: Safe to replay multiple times
   * SECURITY: Verifies workspace and subscription isolation
   */
  static async handleSubscriptionCreated(subscription: Stripe.Subscription) {
    try {
      const workspaceId = subscription.metadata?.workspaceId;
      const planId = subscription.metadata?.planId;

      if (!workspaceId || !planId) {
        throw new Error('Missing metadata in subscription');
      }

      // SECURITY: Verify workspace exists
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { subscription: true },
      });

      if (!workspace) {
        throw new Error('Workspace not found');
      }

      const subscriptionData = {
        planId,
        status: subscription.status as any,
        stripeSubscriptionId: subscription.id,
        currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
        currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
      };

      // IDEMPOTENCE: Check if subscription with this stripeSubscriptionId exists
      const existingStripeSubscription = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId: subscription.id },
      });

      if (existingStripeSubscription) {
        // Already processed - update if needed
        await prisma.subscription.update({
          where: { id: existingStripeSubscription.id },
          data: subscriptionData,
        });
        console.log(`[StripeService] Subscription already exists, updated: ${subscription.id}`);
        return;
      }

      if (workspace.subscription) {
        // Update existing workspace subscription
        await prisma.subscription.update({
          where: { id: workspace.subscription.id },
          data: subscriptionData,
        });
      } else {
        // Create new subscription
        const newSubscription = await prisma.subscription.create({
          data: subscriptionData,
        });

        // Link to workspace
        await prisma.workspace.update({
          where: { id: workspaceId },
          data: { subscriptionId: newSubscription.id },
        });
      }

      console.log(`[StripeService] Subscription created for workspace ${workspaceId}: ${subscription.id}`);
    } catch (error) {
      console.error('[StripeService] Subscription created error:', error);
      throw error;
    }
  }

  /**
   * Handle subscription updated webhook
   */
  static async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    try {
      const workspaceId = subscription.metadata?.workspaceId;

      if (!workspaceId) {
        throw new Error('Missing workspaceId in metadata');
      }

      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { subscription: true },
      });

      if (!workspace?.subscription) {
        throw new Error('Subscription not found');
      }

      await prisma.subscription.update({
        where: { id: workspace.subscription.id },
        data: {
          status: subscription.status as any,
          currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
          currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
        },
      });

      console.log(`[StripeService] Subscription updated for workspace ${workspaceId}`);
    } catch (error) {
      console.error('[StripeService] Subscription updated error:', error);
      throw error;
    }
  }

  /**
   * Handle subscription deleted webhook
   * IDEMPOTENT: Safe to replay
   * DOWNGRADE: Moves workspace to Free plan on cancellation
   */
  static async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    try {
      const workspaceId = subscription.metadata?.workspaceId;

      if (!workspaceId) {
        throw new Error('Missing workspaceId in metadata');
      }

      // SECURITY: Verify workspace exists
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { subscription: { include: { plan: true } } },
      });

      if (!workspace?.subscription) {
        console.log(`[StripeService] Subscription not found for workspace ${workspaceId}`);
        return;
      }

      // IDEMPOTENCE: Check if already canceled
      if (workspace.subscription.status === 'canceled') {
        console.log(`[StripeService] Subscription already canceled: ${workspace.subscription.id}`);
        return;
      }

      // Get Free plan
      const freePlan = await prisma.plan.findFirst({
        where: { name: 'free' },
      });

      if (!freePlan) {
        throw new Error('Free plan not found in database');
      }

      // Downgrade to Free plan
      await prisma.subscription.update({
        where: { id: workspace.subscription.id },
        data: {
          planId: freePlan.id,
          status: 'canceled',
          endDate: new Date(),
        },
      });

      console.log(`[StripeService] Subscription canceled for workspace ${workspaceId}, downgraded to Free`);
    } catch (error) {
      console.error('[StripeService] Subscription deleted error:', error);
      throw error;
    }
  }

  /**
   * Verify webhook signature
   */
  static verifyWebhookSignature(
    body: string | Buffer,
    signature: string
  ): Stripe.Event {
    try {
      return stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (error) {
      console.error('[StripeService] Webhook verification failed:', error);
      throw error;
    }
  }

  /**
   * Create customer portal session
   */
  static async createPortalSession(workspaceId: string, returnUrl: string) {
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });

      if (!workspace || !(workspace as any).stripeCustomerId) {
        throw new Error('No Stripe customer found');
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: (workspace as any).stripeCustomerId,
        return_url: returnUrl,
      });

      return session;
    } catch (error) {
      console.error('[StripeService] Portal session error:', error);
      throw error;
    }
  }

  /**
   * Get subscription details
   */
  static async getSubscriptionDetails(stripeSubscriptionId: string) {
    try {
      return await stripe.subscriptions.retrieve(stripeSubscriptionId);
    } catch (error) {
      console.error('[StripeService] Get subscription error:', error);
      throw error;
    }
  }

  /**
   * Cancel subscription
   */
  static async cancelSubscription(stripeSubscriptionId: string) {
    try {
      const subscription = await stripe.subscriptions.cancel(stripeSubscriptionId);
      return subscription;
    } catch (error) {
      console.error('[StripeService] Cancel subscription error:', error);
      throw error;
    }
  }

  /**
   * Handle payment failed webhook
   * IDEMPOTENT: Marks subscription as past_due
   * NOTIFY: TODO Phase 2.7 - Send email notification
   */
  static async handlePaymentFailed(invoice: Stripe.Invoice) {
    try {
      // For subscription invoices, Stripe snapshots the subscription's
      // metadata onto invoice.parent.subscription_details.metadata at
      // finalization time — the invoice's own top-level `metadata` (below,
      // kept as a fallback) is never set anywhere in this app and is a
      // different field entirely. See
      // node_modules/stripe/cjs/resources/Invoices.d.ts (Parent.SubscriptionDetails).
      const workspaceId =
        invoice.parent?.subscription_details?.metadata?.workspaceId ||
        invoice.metadata?.workspaceId;

      if (!workspaceId) {
        console.log('[StripeService] Payment failed webhook without workspaceId');
        return;
      }

      // SECURITY: Verify workspace exists
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: { subscription: true },
      });

      if (!workspace?.subscription) {
        console.log(`[StripeService] No subscription found for workspace ${workspaceId}`);
        return;
      }

      // IDEMPOTENCE: Only update if not already past_due
      if (workspace.subscription.status === 'past_due') {
        console.log(`[StripeService] Subscription already past_due: ${workspace.subscription.id}`);
        return;
      }

      // Update subscription status to past_due
      await prisma.subscription.update({
        where: { id: workspace.subscription.id },
        data: { status: 'past_due' },
      });

      console.log(`[StripeService] Payment failed for workspace ${workspaceId}, marked as past_due`);
      // TODO Phase 2.7: Send email notification to user about failed payment
    } catch (error) {
      console.error('[StripeService] Payment failed handler error:', error);
      throw error;
    }
  }
}
