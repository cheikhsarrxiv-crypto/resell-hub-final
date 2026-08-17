import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { StripeService } from '@/services/StripeService';

/**
 * POST /api/stripe/webhooks
 * Handle Stripe webhook events
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 400 }
      );
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = StripeService.verifyWebhookSignature(body, signature);
    } catch (err) {
      console.error('[Webhook] Signature verification failed:', err);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Handle different event types
    switch (event.type) {
      case 'customer.subscription.created':
        await StripeService.handleSubscriptionCreated(
          event.data.object as Stripe.Subscription
        );
        break;

      case 'customer.subscription.updated':
        await StripeService.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription
        );
        break;

      case 'customer.subscription.deleted':
        await StripeService.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription
        );
        break;

      case 'invoice.payment_succeeded':
        console.log('[Webhook] Payment succeeded for event:', event.id);
        break;

      case 'invoice.payment_failed':
        await StripeService.handlePaymentFailed(
          event.data.object as Stripe.Invoice
        );
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Webhook] Error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
