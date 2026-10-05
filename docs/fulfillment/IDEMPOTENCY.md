# Idempotency

Three independent idempotency mechanisms exist in this layer — none of
them new infrastructure, all reusing an existing real guarantee.

## 1. ADKSY-side: `FulfillmentOrder.orderId` is `@unique` — **pre-existing, unchanged**

The real Postgres constraint `FulfillmentOrder.orderId` being `@unique`
already guarantees only one `FulfillmentOrder` can ever exist per ADKSY
`Order`. `FulfillmentService.sendToFulfillment`'s own pre-check
(`"Fulfillment order already created"`) and this DB constraint together
mean two concurrent confirmations (e.g. a double-click on
`send_to_fulfillment`) can both pass the pre-check, but only one
`create()` ever succeeds — the loser's raw Prisma error propagates
unmodified (see `actionTools.ts`'s own comment on this). Nothing in this
phase changes this.

## 2. Provider-side: `MockFulfillmentProvider`'s own in-memory idempotency — **new, this phase**

`MockFulfillmentProvider.createFulfillmentOrder` is keyed by the ADKSY
`orderId`: calling it twice (double-click, retry, or a genuine "duplicate
order" scenario) returns the **same** `externalOrderId`/`status` both
times — never creates a second simulated order. This mirrors, at the
provider level, the exact same discipline `FulfillmentOrder.orderId
@unique` already enforces at the ADKSY level. A real partner adapter, once
built, would need to implement the equivalent itself (e.g. by sending its
own idempotency key, if the partner's real API supports one — never
assumed without that partner's spec).

## 3. Webhook idempotency: reuses `WebhookLog` — **new, this phase, zero schema change**

`WebhookLog`'s real `@@unique([workspaceId, marketplace, eventId])`
constraint is **already in production use**, today, for Stripe webhooks
(`marketplace: "stripe"` in `/api/stripe/webhooks/route.ts`). The
`marketplace` column was always a free `String`, never a DB-level enum —
reusing it for a fulfillment provider id (`marketplace: "mock"`, e.g.) is
not a repurposing hack, it's exactly what the column already is.

`processFulfillmentWebhookEvent` mirrors the Stripe route's own proven
reclaim logic exactly:
- First delivery of `(workspaceId, providerId, eventId)` → `create()`
  succeeds, `status: "processing"`.
- A concurrent/retried delivery hits the real unique constraint (`P2002`)
  → looked up by the same compound key.
  - `status: "processed"` → `{ status: 'skipped_duplicate' }`, handler
    never called again.
  - `status: "failed"` → atomically reclaimed (`updateMany` with
    `where: { status: 'failed' }`) and **reprocessed** — a legitimate
    retry, not swallowed.
  - `status: "processing"` and not stale (< 60s old) → treated as a
    genuinely concurrent delivery, skipped.
  - `status: "processing"` and stale (≥ 60s) → reclaimed and retried
    (the original likely crashed before finishing).

Each reclaim path's `updateMany` is itself the atomic, race-safe claim —
exactly the `updateMany`-as-conditional-lock pattern
`FulfillmentService.simulateOrderShipped/Delivered` already uses for its
own, unrelated idempotency fix (Phase 8, prior work). This phase doesn't
invent a new concurrency primitive — it reuses the one already proven in
this codebase.
