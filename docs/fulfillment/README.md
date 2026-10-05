# ADKSY Fulfillment Integration Layer

## What this is

A generic abstraction between ADKSY's own order/fulfillment data and any
number of external fulfillment partners, so that connecting a new partner
later is "write one adapter class", not "touch `FulfillmentService`,
`send_to_fulfillment`, the dashboard, and the DB schema again".

```
Marketplace → ADKSY → Fulfillment Integration Layer
                          ├── MockFulfillmentProvider   (IMPLEMENTED NOW — the only real one)
                          ├── FrenchlogAdapter           (NOT CONFIGURED — no real API doc yet)
                          ├── VintedMKPAdapter           (NOT CONFIGURED — no real API doc yet)
                          ├── ColockBoxAdapter           (NOT CONFIGURED — no real API doc yet)
                          └── NexeuroAdapter             (NOT CONFIGURED — no real API doc yet)
```

## IMPLEMENTED NOW vs PARTNER-SPECIFIC / NOT CONFIGURED

| Piece | Status |
|---|---|
| `FulfillmentProvider` interface (contract) | **IMPLEMENTED NOW** |
| `getFulfillmentProvider(providerId)` registry/factory | **IMPLEMENTED NOW** |
| `MockFulfillmentProvider` | **IMPLEMENTED NOW** — the only real, fully-executable provider |
| `NotConfiguredFulfillmentProvider` (shared stand-in for frenchlog/vintedmkp/colock_box/nexeuro) | **IMPLEMENTED NOW** (as a safe stub — zero network calls) |
| Typed error taxonomy (`FulfillmentProviderError`) | **IMPLEMENTED NOW** |
| `FulfillmentService.sendToFulfillmentViaProvider` (additive orchestration) | **IMPLEMENTED NOW** — not called by anything existing yet |
| Webhook foundation (signature, replay protection, idempotency via `WebhookLog`) | **IMPLEMENTED NOW** — foundation only |
| Reconciliation (detection-only status diff) | **IMPLEMENTED NOW** — detection only, never auto-corrects |
| A real `FrenchlogAdapter` / `VintedMKPAdapter` / `ColockBoxAdapter` / `NexeuroAdapter` | **PARTNER-SPECIFIC / NOT CONFIGURED** — no file exists; see PARTNER-INTEGRATION-CHECKLIST.md |
| A real partner webhook receiver route (`/api/webhooks/fulfillment/<partner>`) | **PARTNER-SPECIFIC / NOT CONFIGURED** — does not exist |
| `MarketplaceShippingRequirements` persistence to Prisma | **NOT IMPLEMENTED** — no real source data exists yet (see ARCHITECTURE.md) |

## What did NOT change

- `FulfillmentService.sendToFulfillment` — byte-for-byte the same method, same signature, same behavior.
- `send_to_fulfillment` (AI agent tool) — still calls the plain `sendToFulfillment`, unchanged.
- `POST /api/fulfillment/send` — unchanged.
- `simulateOrderAccepted/Processing/Shipped/Delivered` — unchanged.
- The `/dashboard/fulfillment` page and its API — unchanged.
- `prisma/schema.prisma` — **zero migration**, zero column added, zero model added.
- eBay/Etsy adapters, `AiActionService`, multi-tenant isolation — untouched.

## Where to go next

- [ARCHITECTURE.md](./ARCHITECTURE.md) — how the pieces fit together and the shipping-requirements persistence decision.
- [PROVIDER-CONTRACT.md](./PROVIDER-CONTRACT.md) — the `FulfillmentProvider` interface in detail.
- [WEBHOOKS.md](./WEBHOOKS.md) — the webhook foundation.
- [IDEMPOTENCY.md](./IDEMPOTENCY.md) — every idempotency mechanism in this layer.
- [TESTING.md](./TESTING.md) — what's tested and how to run it.
- [PARTNER-INTEGRATION-CHECKLIST.md](./PARTNER-INTEGRATION-CHECKLIST.md) — the 21 things a real partner integration needs before it can be built.
