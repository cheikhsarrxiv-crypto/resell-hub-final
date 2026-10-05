# Webhooks

Files: `src/services/fulfillment/webhooks/{types,signature,WebhookEventProcessor}.ts`.

## Status: foundation only — **NOT CONFIGURED** for any real partner

**There is no real partner webhook receiver route in this codebase.** No
partner has sent ADKSY a real webhook payload shape, so none is invented
here. What exists is the generic plumbing a future real route would call
into once a real partner's webhook spec arrives.

| Piece | Status |
|---|---|
| `FulfillmentWebhookEnvelope` (generic event shape) | **IMPLEMENTED NOW** |
| `verifyHmacSignature` / `isWebhookTimestampFresh` | **IMPLEMENTED NOW** — generic HMAC-SHA256 + replay window |
| `processFulfillmentWebhookEvent` (idempotency, validation, safe logging, retry) | **IMPLEMENTED NOW** |
| `/api/webhooks/fulfillment/frenchlog` (or any real partner route) | **NOT CONFIGURED** — does not exist |
| A partner-specific payload parser | **NOT CONFIGURED** — does not exist |

## How it works today

1. A future real route receives the partner's raw request, builds a
   `FulfillmentWebhookEnvelope { providerId, eventId, eventType, timestamp, rawBody, signatureHeader }`
   from it (never inventing a shape the partner doesn't actually send),
   and calls `processFulfillmentWebhookEvent(envelope, { secret }, handler)`.
2. **Signature verification** — HMAC-SHA256 over `rawBody`, the same real
   primitive `EbayAdapter.verifyWebhookSignature` already uses
   (`crypto.createHmac` + `crypto.timingSafeEqual`), generalized so it
   isn't reimplemented per partner. Supports `hex` (default) or `base64`
   digest encoding, since no two partners are assumed to agree.
3. **Replay protection** — `isWebhookTimestampFresh` rejects an event
   whose claimed timestamp is more than `toleranceSeconds` (default 300s)
   away from now, in either direction.
4. **Workspace resolution** — strictly from the matched `FulfillmentOrder`
   row (looked up by the payload's own `externalOrderId`), never from
   anything the payload itself claims about which workspace it belongs
   to. An unknown `externalOrderId` is rejected before any handler runs.
5. **Idempotency** — see IDEMPOTENCY.md. Reuses the existing `WebhookLog`
   model exactly like `/api/stripe/webhooks` already does — zero schema
   change.
6. **Safe logging** — the stored error message is the handler's own
   `Error.message`, capped at 2000 chars, same as the Stripe route.
   `rawBody` and `signatureHeader` are **never** written to `WebhookLog`
   or logged anywhere, even on failure.
7. **Retry** — a redelivery of a previously-`"failed"` event is
   atomically reclaimed and actually reprocessed (not silently swallowed
   as a duplicate) — same mechanism the Stripe route already relies on in
   production.
8. **Dead-letter (conceptual)** — `listDeadLetterFulfillmentWebhooks(workspaceId)`
   in `reconciliation.ts`'s sibling module surfaces every fulfillment
   `WebhookLog` row still at `"failed"`. There is no `attempts` counter or
   automatic quarantine yet — that would be a small additive migration,
   proposed only once a real partner webhook is live and this is observed
   to matter in practice.

## What a real partner integration still needs

See PARTNER-INTEGRATION-CHECKLIST.md — in particular: the partner's real
signature scheme (header name, digest encoding, signed-string format),
their real event-id field name, their real timestamp format/field, and
their real retry/redelivery behavior. None of these exist for any partner
today.
