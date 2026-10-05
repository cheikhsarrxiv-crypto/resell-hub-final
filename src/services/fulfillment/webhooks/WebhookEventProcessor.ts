import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyHmacSignature, isWebhookTimestampFresh } from './signature';
import type { FulfillmentWebhookEnvelope, FulfillmentWebhookOutcome } from './types';
import { KNOWN_FULFILLMENT_PROVIDER_IDS } from '../registry';

const STALE_PROCESSING_MS = 60 * 1000; // same generous bound as the existing Stripe webhook route

export type FulfillmentWebhookHandler = (envelope: FulfillmentWebhookEnvelope, parsedPayload: unknown) => Promise<void>;

/**
 * Generic fulfillment webhook foundation — signature + timestamp/replay
 * validation, then idempotent processing, reusing the EXISTING WebhookLog
 * model and its real @@unique([workspaceId, marketplace, eventId])
 * constraint exactly the way /api/stripe/webhooks/route.ts already does
 * (there, marketplace="stripe"; here, marketplace=the fulfillment
 * provider id, e.g. "mock"). No schema change: WebhookLog.marketplace was
 * always a free string, never a DB-level enum.
 *
 * This function is the FOUNDATION only — no real partner webhook ROUTE
 * exists yet (there is no real partner to receive one from). A future
 * real partner integration would add `/api/webhooks/fulfillment/<partner>`,
 * normalize that partner's own raw payload into a FulfillmentWebhookEnvelope,
 * and call this function with its real secret and a handler that updates
 * FulfillmentOrder/Shipment/TrackingEvent — none of which is invented
 * here.
 *
 * Multi-tenant safety: the workspace is resolved from the EXISTING
 * FulfillmentOrder row (created by FulfillmentService.sendToFulfillment),
 * keyed by the payload's own externalOrderId — never trusted from the
 * envelope itself, never a new workspace-mapping table. An event whose
 * externalOrderId doesn't match any FulfillmentOrder is rejected before
 * any handler runs, and before anything workspace-scoped is touched.
 */
export async function processFulfillmentWebhookEvent(
  envelope: FulfillmentWebhookEnvelope,
  options: { secret?: string; toleranceSeconds?: number },
  handler: FulfillmentWebhookHandler
): Promise<FulfillmentWebhookOutcome> {
  if (!envelope.providerId || !envelope.eventId) {
    return { status: 'rejected', reason: 'missing_provider_id_or_event_id' };
  }

  // Signature + replay-window validation only runs when a secret is
  // supplied — a future real route always will (per-provider secret, read
  // from its own env var, never a shared/default one; never logged here
  // or anywhere below).
  if (options.secret) {
    const validSignature = verifyHmacSignature({
      rawBody: envelope.rawBody,
      signatureHeader: envelope.signatureHeader,
      secret: options.secret,
    });
    if (!validSignature) {
      console.warn(`[FulfillmentWebhook] Rejected: invalid signature (provider="${envelope.providerId}", eventId="${envelope.eventId}").`);
      return { status: 'rejected', reason: 'invalid_signature' };
    }
    if (!isWebhookTimestampFresh(envelope.timestamp, options.toleranceSeconds)) {
      console.warn(`[FulfillmentWebhook] Rejected: timestamp outside tolerance (provider="${envelope.providerId}", eventId="${envelope.eventId}").`);
      return { status: 'rejected', reason: 'timestamp_out_of_tolerance' };
    }
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(envelope.rawBody);
  } catch {
    return { status: 'rejected', reason: 'invalid_json_payload' };
  }

  const externalOrderId = (parsedPayload as { externalOrderId?: unknown } | null)?.externalOrderId;
  if (typeof externalOrderId !== 'string' || externalOrderId.length === 0) {
    return { status: 'rejected', reason: 'missing_external_order_id_in_payload' };
  }

  const fulfillmentOrder = await prisma.fulfillmentOrder.findFirst({ where: { externalOrderId } });
  if (!fulfillmentOrder) {
    return { status: 'rejected', reason: 'unknown_external_order_id' };
  }
  const workspaceId = fulfillmentOrder.workspaceId;

  let webhookLogId: string;
  try {
    const log = await prisma.webhookLog.create({
      data: {
        workspaceId,
        marketplace: envelope.providerId,
        eventId: envelope.eventId,
        eventType: envelope.eventType,
        payload: envelope.eventType, // same convention as the Stripe route: a short descriptor, never the raw payload/signature
        status: 'processing',
      },
    });
    webhookLogId = log.id;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
      throw err;
    }

    const existing = await prisma.webhookLog.findUnique({
      where: { workspaceId_marketplace_eventId: { workspaceId, marketplace: envelope.providerId, eventId: envelope.eventId } },
    });

    if (!existing || existing.status === 'processed') {
      return { status: 'skipped_duplicate' };
    }

    if (existing.status === 'failed') {
      // Legitimate retry (the partner redelivering a previously-failed
      // event) — atomically reclaim so a second concurrent retry can't
      // also reprocess it.
      const claim = await prisma.webhookLog.updateMany({ where: { id: existing.id, status: 'failed' }, data: { status: 'processing', error: null } });
      if (claim.count === 0) return { status: 'skipped_duplicate' };
      webhookLogId = existing.id;
    } else {
      const isStale = Date.now() - existing.createdAt.getTime() > STALE_PROCESSING_MS;
      if (!isStale) return { status: 'skipped_duplicate' };
      const claim = await prisma.webhookLog.updateMany({ where: { id: existing.id, status: 'processing', processedAt: null }, data: { processedAt: new Date() } });
      if (claim.count === 0) return { status: 'skipped_duplicate' };
      webhookLogId = existing.id;
    }
  }

  try {
    await handler(envelope, parsedPayload);
    await prisma.webhookLog
      .update({ where: { id: webhookLogId }, data: { status: 'processed', processedAt: new Date() } })
      .catch((err) => console.error('[FulfillmentWebhook] Failed to mark WebhookLog as processed:', err));
    return { status: 'processed' };
  } catch (err) {
    // Never logs envelope.rawBody or envelope.signatureHeader — only a
    // short, capped message, same discipline as the Stripe route.
    const message = err instanceof Error ? err.message : String(err);
    await prisma.webhookLog
      .update({ where: { id: webhookLogId }, data: { status: 'failed', error: message.slice(0, 2000) } })
      .catch((err2) => console.error('[FulfillmentWebhook] Failed to mark WebhookLog as failed:', err2));
    return { status: 'failed', error: message };
  }
}

/**
 * Dead-letter visibility (conceptual-level, per this phase's own scope):
 * a WebhookLog row for a fulfillment provider stuck at "failed" after the
 * partner's own redelivery attempts are exhausted IS today's dead-letter
 * signal — no new table or `attempts` counter exists yet (would be a
 * small additive migration, only worth doing once a real partner webhook
 * is live and this is observed to matter). This helper just surfaces that
 * existing signal for an operator/cron to inspect.
 */
export async function listDeadLetterFulfillmentWebhooks(workspaceId: string) {
  return prisma.webhookLog.findMany({
    where: { workspaceId, marketplace: { in: [...KNOWN_FULFILLMENT_PROVIDER_IDS] }, status: 'failed' },
    orderBy: { createdAt: 'desc' },
  });
}
