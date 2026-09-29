import Stripe from 'stripe';
import prisma from '@/lib/prisma';
import { EmailService } from './EmailService';

/**
 * Phase 10 production-readiness fix — this used to construct the Stripe
 * client at MODULE LEVEL (`const stripe = new Stripe(process.env.
 * STRIPE_SECRET_KEY!, {})`), which throws immediately ("Neither apiKey nor
 * config.authenticator provided", verified directly against the real
 * Stripe SDK) the instant this file is imported with STRIPE_SECRET_KEY
 * unset — not when a Stripe method is actually called. Every route that
 * imports StripeService (checkout/webhooks/portal) would fail to even
 * load in any environment missing that one env var (a preview deployment,
 * a misconfigured environment, or — a well-known Next.js/Vercel gotcha —
 * during `next build` itself if the build step traces/evaluates the
 * module without the secret present at build time), rather than failing
 * only when Stripe is genuinely used. Lazily constructed and cached here
 * instead: importing this file is now always safe; only an actual call
 * into a StripeService method that needs Stripe fails, with a clear error,
 * if the key is genuinely missing.
 */
let stripeClient: Stripe | null = null;
function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // Use default API version
    });
  }
  return stripeClient;
}

export interface CheckoutSessionData {
  planId: string;
  billingPeriod: 'monthly' | 'annual';
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

      // The client only ever supplies WHICH billing cycle it wants — the
      // actual Stripe Price ID always comes from the Plan row in the DB,
      // never trusted from the request otherwise. 'monthly'/'annual' is
      // enforced as a strict enum by stripeCheckoutSchema before this is
      // ever reached (see /api/stripe/checkout/route.ts).
      const priceId =
        data.billingPeriod === 'annual' ? plan.stripePriceIdAnnual : plan.stripePriceIdMonthly;

      // CRITICAL: Verify the plan actually has a Stripe Price ID for the
      // requested billing cycle — e.g. Enterprise has neither (it's a
      // "Contact us" plan, never sold through Checkout), and a plan could
      // in principle have one cycle configured but not the other. Refuse
      // cleanly rather than ever sending `price: null`/undefined to Stripe.
      if (!priceId) {
        throw new Error(
          `Plan ${plan.name} is not configured for ${data.billingPeriod} billing in Stripe. Missing Price ID.`
        );
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
        const customer = await getStripeClient().customers.create({
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
      const session = await getStripeClient().checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId, // Use Price ID (resolved above for the requested billing cycle), not price_data
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
          billingPeriod: data.billingPeriod,
        },
        // Checkout Session metadata (above) is NOT copied to the Subscription
        // it creates — it must be set here explicitly, or the
        // customer.subscription.* webhooks (which read subscription.metadata)
        // never see workspaceId/planId at all. billingPeriod is carried
        // here for display/audit purposes only — handleSubscriptionUpdated
        // never trusts it; the real source of truth for "which plan is
        // this subscription on now" is always the live Price ID Stripe
        // reports on the subscription's own line item.
        subscription_data: {
          metadata: {
            workspaceId: data.workspaceId,
            planId: data.planId,
            planName: plan.name,
            billingPeriod: data.billingPeriod,
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
   *
   * D-1 fix: previously this only updated status/currentPeriodStart/End —
   * never Subscription.planId. A plan change made through the Stripe
   * customer portal (e.g. Starter -> Pro) would fire this event with a
   * new price on the subscription, but ADKSY kept showing the OLD plan
   * forever, since nothing here ever re-resolved it.
   *
   * The new plan is now resolved from the REAL Price ID Stripe reports on
   * the subscription's own first line item
   * (subscription.items.data[0].price.id) — never from
   * subscription.metadata.planId, which is only ever set once at Checkout
   * time and is never updated by Stripe when the price changes later.
   * Matched against BOTH stripePriceIdMonthly and stripePriceIdAnnual, so
   * a portal-driven monthly<->annual switch is resolved correctly too.
   *
   * If the Price ID doesn't match any real Plan row, this throws rather
   * than guessing — the webhook route's own WebhookLog mechanism marks the
   * event "failed" and lets Stripe's normal retry schedule reprocess it
   * (see that route's own header comment), which is appropriate if the
   * mismatch is transient (e.g. a Plan row not yet seeded); a genuinely
   * unrecognized Price ID needs an operator to add it to a real Plan
   * before this event can ever succeed. Nothing is written to the DB in
   * that case, so the Subscription row is left fully consistent (old
   * plan/status/dates all still in sync with each other) rather than
   * partially updated.
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

      const priceId = subscription.items?.data?.[0]?.price?.id;
      if (!priceId) {
        throw new Error(`Subscription ${subscription.id} update event has no price id on its first line item`);
      }

      const plan = await prisma.plan.findFirst({
        where: {
          OR: [{ stripePriceIdMonthly: priceId }, { stripePriceIdAnnual: priceId }],
        },
      });

      if (!plan) {
        console.error(
          `[StripeService] Subscription ${subscription.id} (workspace ${workspaceId}) updated to unrecognized Stripe Price ID "${priceId}" — no matching Plan found. Subscription left unchanged; this event will be retried.`
        );
        throw new Error(`Unrecognized Stripe Price ID: ${priceId}`);
      }

      await prisma.subscription.update({
        where: { id: workspace.subscription.id },
        data: {
          planId: plan.id,
          status: subscription.status as any,
          currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
          currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
        },
      });

      console.log(`[StripeService] Subscription updated for workspace ${workspaceId}: now on plan "${plan.name}"`);
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
      return getStripeClient().webhooks.constructEvent(
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

      const session = await getStripeClient().billingPortal.sessions.create({
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
      return await getStripeClient().subscriptions.retrieve(stripeSubscriptionId);
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
      const subscription = await getStripeClient().subscriptions.cancel(stripeSubscriptionId);
      return subscription;
    } catch (error) {
      console.error('[StripeService] Cancel subscription error:', error);
      throw error;
    }
  }

  /**
   * Handle payment failed webhook
   * IDEMPOTENT: Marks subscription as past_due and emails the workspace
   * owner exactly once per failure episode — both guarded by the same
   * "already past_due" check below, so a second invoice.payment_failed
   * event for the same ongoing dunning cycle (a distinct Stripe event.id,
   * so not caught by the route's own webhookLog dedup) is a no-op here too.
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
        include: { subscription: true, user: true },
      });

      if (!workspace?.subscription) {
        console.log(`[StripeService] No subscription found for workspace ${workspaceId}`);
        return;
      }

      // IDEMPOTENCE: Only update (and notify) if not already past_due
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

      // NOTIFY: best-effort — an email provider hiccup must not turn an
      // already-applied, correct status update into a failed webhook (which
      // would make Stripe retry delivery of an event we've fully handled).
      try {
        const emailResult = await EmailService.sendPaymentFailedNotification(
          workspace.user.email,
          (invoice.amount_due ?? 0) / 100
        );
        if (!emailResult.success) {
          console.error('[StripeService] Failed to send payment-failed email:', emailResult.error);
        }
      } catch (emailError) {
        console.error('[StripeService] Payment-failed email threw:', emailError);
      }
    } catch (error) {
      console.error('[StripeService] Payment failed handler error:', error);
      throw error;
    }
  }
}
