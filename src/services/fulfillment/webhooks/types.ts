/**
 * Generic fulfillment webhook envelope — the shape ANY future real
 * partner webhook receiver route would normalize a partner's own raw
 * payload INTO, before handing it to WebhookEventProcessor. No real
 * partner webhook payload shape is known yet (RÈGLE ABSOLUE #2: never
 * invent an endpoint; by extension, never invent a payload shape either),
 * so this envelope only carries the fields every webhook foundation needs
 * regardless of partner: who sent it, what happened, when, and proof it's
 * really them.
 */
export interface FulfillmentWebhookEnvelope {
  /** Which FulfillmentProvider this event claims to be from — matched
   * against registry.ts's known ids, but intentionally a plain string
   * here (not FulfillmentProviderId) so an unknown/future id is a
   * reported VALIDATION_FAILURE, not a TypeScript-level impossibility. */
  providerId: string;
  /** The event's OWN id, as assigned by the partner — the real dedup key
   * together with providerId (see WebhookEventProcessor). Never
   * ADKSY-generated. */
  eventId: string;
  /** Partner-defined event type string (e.g. "order.shipped") — never
   * invented or assumed to match any particular partner's real vocabulary
   * until that partner's spec exists. */
  eventType: string;
  /** When the partner says this event occurred — used for replay-window
   * validation (see signature.ts), not for ordering guarantees. */
  timestamp: Date;
  /** Raw request body exactly as received, BEFORE any JSON.parse — HMAC
   * signatures are computed over raw bytes, never over a reserialized
   * object (same discipline as StripeService.verifyWebhookSignature,
   * which signs the raw body string, not a re-stringified one). */
  rawBody: string;
  /** The signature header value exactly as sent by the partner. */
  signatureHeader: string | null;
}

export type FulfillmentWebhookOutcome =
  | { status: 'processed' }
  | { status: 'skipped_duplicate' }
  | { status: 'rejected'; reason: string }
  | { status: 'failed'; error: string };
