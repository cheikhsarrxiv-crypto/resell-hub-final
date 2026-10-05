# Testing

## Running

```bash
# Every fulfillment-foundation test:
npx vitest run src/services/fulfillment src/services/__tests__/FulfillmentService-provider-integration.test.ts

# Plus the pre-existing fulfillment suites, to prove zero regression:
npx vitest run src/services/__tests__/FulfillmentService.test.ts \
  src/services/ai/tools/__tests__/sendToFulfillmentTool.test.ts \
  src/services/ai/__tests__/send-to-fulfillment-pipeline-integration.test.ts

# Full suite:
npx vitest run
```

## New test files (59 new tests)

| File | Covers |
|---|---|
| `src/services/fulfillment/__tests__/registry.test.ts` | `getFulfillmentProvider` resolution, including every planned-but-unconfigured id, and an unknown id |
| `src/services/fulfillment/__tests__/MockFulfillmentProvider.test.ts` | Full lifecycle (created→accepted→processing→packed→shipped→delivered), duplicate-order idempotent replay, every forced error case (insufficient stock, temporary/permanent failure, provider unavailable, tracking unavailable), cancellation (incl. cancel-after-ship rejection), multi-order isolation, a concurrent-create race |
| `src/services/fulfillment/webhooks/__tests__/signature.test.ts` | HMAC verification (valid/tampered/wrong-secret/missing), hex + base64 encodings, timestamp freshness window (fresh/stale/future) |
| `src/services/fulfillment/webhooks/__tests__/WebhookEventProcessor.test.ts` | Signature/timestamp rejection, invalid JSON, missing/unknown `externalOrderId`, workspace resolved only from the matched `FulfillmentOrder`, duplicate-processed skip, failed-event retry, secret-safe error logging, concurrent-delivery race |
| `src/services/fulfillment/__tests__/reconciliation.test.ts` | In-sync/out-of-sync detection, no externalOrderId yet, never writes back |
| `src/services/__tests__/FulfillmentService-provider-integration.test.ts` | `sendToFulfillmentViaProvider` end-to-end with the real `MockFulfillmentProvider`; plan-gate and duplicate-order guards still enforced; an unconfigured provider id throws `NOT_CONFIGURED` with the local `FulfillmentOrder` row still intact; **multi-tenant isolation** (foreign-workspace order rejected; two workspaces' orders never cross-contaminate provider state) |

## Pre-existing suites re-verified unchanged (zero regression)

- `src/services/__tests__/FulfillmentService.test.ts` (simulate* idempotency/race conditions — untouched methods)
- `src/services/ai/tools/__tests__/sendToFulfillmentTool.test.ts` (the AI tool, still calling the plain `sendToFulfillment`)
- `src/services/ai/__tests__/send-to-fulfillment-pipeline-integration.test.ts` (full `AiActionService` pipeline)
- `src/services/__tests__/inventory-race-condition.test.ts`
- Full suite: 2399 passed, 0 failed, 124 skipped (same skip count as before this phase — nothing newly skipped or broken).

## What is deliberately NOT tested (and why)

- Any real network call to a real partner — none exists; `MockFulfillmentProvider` performs zero I/O, which the tests assert implicitly (no `fetch`/`http` mock is ever needed).
- Webhook signature schemes specific to a named partner — no partner's real scheme is known.
- `shippingRequirements` persistence — not implemented (see ARCHITECTURE.md), so nothing to test.
