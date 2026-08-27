import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { StripeService } from '@/services/StripeService';

/**
 * Best-effort workspaceId extraction for idempotency logging only — the
 * authoritative extraction (with its own error handling) still happens
 * inside each StripeService handler, unchanged. Mirrors the same metadata
 * paths StripeService reads: subscription_data.metadata for subscription
 * events, invoice.parent.subscription_details.metadata for invoice events.
 */
function extractWorkspaceIdForDedup(event: Stripe.Event): string | null {
  const obj = event.data.object as any;
  if (event.type.startsWith('customer.subscription.')) {
    return obj?.metadata?.workspaceId ?? null;
  }
  if (event.type.startsWith('invoice.')) {
    return (
      obj?.parent?.subscription_details?.metadata?.workspaceId ??
      obj?.metadata?.workspaceId ??
      null
    );
  }
  return null;
}

const STALE_PROCESSING_MS = 60 * 1000; // generous vs. a realistic serverless request duration

/**
 * POST /api/stripe/webhooks
 * Handle Stripe webhook events
 *
 * IDEMPOTENCE: Dedupes by Stripe's event.id using WebhookLog's existing
 * @@unique([workspaceId, marketplace, eventId]) constraint (marketplace:
 * "stripe"). The constraint itself — not an application-level
 * check-then-act — is what makes the very first "who gets to process
 * this" decision atomic under a race: of two concurrent create() calls
 * for the same event, Postgres guarantees exactly one succeeds.
 *
 * A row's status distinguishes three outcomes explicitly:
 *  - "processing": currently (or very recently) being handled.
 *  - "processed": finished successfully — always skip on redelivery.
 *  - "failed": the previous attempt finished (with a thrown error) and
 *    already returned its own 500 to Stripe — a redelivery is a
 *    legitimate retry and MUST be reprocessed, not swallowed as a
 *    duplicate. Reclaiming a "failed" (or long-stale "processing") row
 *    for retry is itself done via an atomic conditional update
 *    (updateMany + checking the affected row count), so two racing
 *    retries of the same previously-failed event can't both reprocess it.
 */
export async function POST(request: NextRequest) {
  let webhookLogId: string | null = null;

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

    const workspaceId = extractWorkspaceIdForDedup(event);

    if (workspaceId) {
      try {
        const log = await prisma.webhookLog.create({
          data: {
            workspaceId,
            marketplace: 'stripe',
            eventId: event.id,
            eventType: event.type,
            payload: event.type,
            status: 'processing',
          },
        });
        webhookLogId = log.id;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
          throw err;
        }

        // Same (workspaceId, "stripe", eventId) already exists.
        const existing = await prisma.webhookLog.findUnique({
          where: {
            workspaceId_marketplace_eventId: { workspaceId, marketplace: 'stripe', eventId: event.id },
          },
        });

        if (!existing || existing.status === 'processed') {
          return NextResponse.json({ received: true, duplicate: true });
        }

        if (existing.status === 'failed') {
          // The previous attempt already finished — unsuccessfully — and
          // returned its own 500. This redelivery is a legitimate retry.
          // Atomically reclaim the row so a second concurrent retry can't
          // also reprocess it.
          const claim = await prisma.webhookLog.updateMany({
            where: { id: existing.id, status: 'failed' },
            data: { status: 'processing', error: null },
          });
          if (claim.count === 0) {
            return NextResponse.json({ received: true, duplicate: true });
          }
          webhookLogId = existing.id;
        } else {
          // status === "processing": either a genuinely concurrent
          // delivery (the original should finish within seconds) or a
          // process that crashed/timed out before ever reaching this
          // route's own error handling below (which now marks "failed"
          // immediately on a normal thrown error — so "processing" for
          // longer than a realistic request duration means the original
          // never got that far at all).
          const isStale = Date.now() - existing.createdAt.getTime() > STALE_PROCESSING_MS;

          if (!isStale) {
            return NextResponse.json({ received: true, duplicate: true });
          }

          const claim = await prisma.webhookLog.updateMany({
            where: { id: existing.id, status: 'processing', processedAt: null },
            data: { processedAt: new Date() }, // atomic claim marker, overwritten with the real completion time on success
          });
          if (claim.count === 0) {
            return NextResponse.json({ received: true, duplicate: true });
          }
          webhookLogId = existing.id;
        }
      }
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

    if (webhookLogId) {
      await prisma.webhookLog
        .update({
          where: { id: webhookLogId },
          data: { status: 'processed', processedAt: new Date() },
        })
        .catch((err) => {
          // Logging-only write — never fail the webhook response over it.
          console.error('[Webhook] Failed to mark WebhookLog as processed:', err);
        });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Webhook] Error:', error);

    if (webhookLogId) {
      // Mark it "failed" (not left at "processing") so that a Stripe
      // retry of this same event.id is treated as a legitimate retry and
      // actually reprocessed, instead of being silently swallowed as a
      // duplicate.
      const message = error instanceof Error ? error.message : String(error);
      await prisma.webhookLog
        .update({
          where: { id: webhookLogId },
          data: { status: 'failed', error: message.slice(0, 2000) },
        })
        .catch((err) => {
          console.error('[Webhook] Failed to mark WebhookLog as failed:', err);
        });
    }

    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
