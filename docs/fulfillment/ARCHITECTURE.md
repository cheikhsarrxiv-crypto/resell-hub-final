# Architecture

## Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Callers (unchanged)                                             │
│  - send_to_fulfillment (AI agent tool, actionTools.ts)           │
│  - POST /api/fulfillment/send                                    │
│  - /dashboard/fulfillment (reads via GET /api/fulfillment)        │
└───────────────────────────┬────────────────────────────────────┘
                            │  calls the SAME, UNCHANGED method:
                            ▼
                 FulfillmentService.sendToFulfillment()
                 (plan gate, order lookup, duplicate check,
                  FulfillmentOrder creation — byte-for-byte as before)
                            │
                            │  NEW, separate, additive method —
                            │  nothing above calls this yet:
                            ▼
          FulfillmentService.sendToFulfillmentViaProvider()
                            │
                            ▼
              getFulfillmentProvider(providerId)     <- registry.ts
                     │                    │
                     ▼                    ▼
       MockFulfillmentProvider   NotConfiguredFulfillmentProvider
       (IMPLEMENTED NOW,          (frenchlog / vintedmkp / colock_box /
        in-memory, zero I/O)      nexeuro — throws NOT_CONFIGURED,
                                  zero I/O, zero network call)
```

## Why a separate method instead of rewiring `sendToFulfillment` itself

`sendToFulfillment(orderId, workspaceId, partnerId)`'s signature was
explicitly required to stay unchanged, and no `FulfillmentPartner` row
today carries any field saying which `FulfillmentProvider` it maps to
(adding one wasn't pre-approved, and would have been a second schema
change beyond the one shipping-requirements field discussed). Branching
provider resolution automatically inside the existing method, keyed by
`FulfillmentPartner.name`, was considered and rejected: it would make a
production partner row (today only `"ShipMock France"`, see `prisma/seed.js`)
silently behave differently based on a naming convention nobody asked for
— exactly the kind of invented coupling RÈGLE ABSOLUE #7/#8 warns against.

`sendToFulfillmentViaProvider` is the honest alternative: it reuses
`sendToFulfillment` as its first step (so the FulfillmentOrder it creates
is identical to today's), then explicitly also calls the provider. Nothing
existing calls it, so it carries zero regression risk; wiring a real call
site to it (the AI tool, the dashboard route, or a new one) is a deliberate
future decision, not something this phase makes for you.

## Known limitation: no rollback on provider failure

If `sendToFulfillmentViaProvider`'s own `provider.createFulfillmentOrder()`
call fails, the `FulfillmentOrder` row created in step 1 is **not** rolled
back — it stays at `status: "pending"` with no `externalOrderId`. Full
saga-style compensation (or marking it `"failed"` automatically) is retry/
reconciliation territory, deliberately not solved in this phase. See
`reconciliation.ts` for the detection-only tool that surfaces this kind of
drift, and TESTING.md for the test that proves this exact behavior.

## Decision: MarketplaceShippingRequirements is NOT persisted to Prisma

The canonical contract (`FulfillmentProvider.ts`) defines
`MarketplaceShippingRequirements` with every field the spec asked for:
`carrier`, `service`, `shippingMethod`, `pickupPoint`, `locker`,
`requiresLabel`, `labelUrl`, `labelFormat`, `requiresTrackingNumber`,
`trackingReference`, `handlingDeadline`, `deliveryDeadline`.

**This phase does not add a `shippingRequirements Json?` column (or any
other column) to `FulfillmentOrder`, `Order`, or `OrderItem`.** Verified
before deciding: `OrdersSyncService`, `EbayAdapter`, and `EtsyAdapter` were
re-checked and none of them extracts or produces a real value for ANY of
these fields today. `Order`/`OrderItem` have no columns for them either.
Adding a column that nothing would ever populate with a real value is not
"preparing the architecture" — it is persisting a permanently-empty field,
which is its own form of inventing data (an implied promise that ADKSY
tracks this, when it does not). `sendToFulfillmentViaProvider` reflects
this honestly: it never passes `shippingRequirements` to the provider at
all (see its own code comment).

**When this becomes necessary** (a real marketplace integration starts
exposing shipping method/pickup point/label data, or a real partner
requires some of it inbound), the proposed minimal change is exactly what
was pre-approved: a single nullable `FulfillmentOrder.shippingRequirements
Json?` column, additive, non-destructive, no data loss for existing rows.
Nothing about today's interfaces would need to change — only a new line
in `sendToFulfillmentViaProvider` to read and pass it through.

## Multi-tenant isolation

Unchanged mechanism, reused as-is:
- `FulfillmentService.sendToFulfillment`'s own `{ id: orderId, workspaceId }`
  lookup is still the only way an order is found — a cross-workspace
  `orderId` guess still resolves to "Order not found".
- `sendToFulfillmentViaProvider` adds nothing new here: it calls the same
  lookup for the same reason (to build the provider's shipping-address
  input), still scoped by the same `{ id, workspaceId }` pair.
- The webhook foundation resolves the workspace strictly from the matched
  `FulfillmentOrder.workspaceId` — never from anything in the inbound
  payload itself (see WEBHOOKS.md) — so no event can be misattributed to
  the wrong workspace even if a payload field claimed one.
