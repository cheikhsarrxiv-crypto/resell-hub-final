# Partner Integration Checklist

Before writing a real adapter (`FrenchlogAdapter`, `VintedMKPAdapter`,
`ColockBoxAdapter`, `NexeuroAdapter`, or any other partner), **every** item
below must come from that partner's own real, received technical
documentation — never guessed, never copied from another partner, never
assumed "probably similar to eBay/Etsy". If any item is unknown, the
adapter is not ready to be written yet.

## Authentication & identity
1. Real authentication scheme (API key / OAuth / mutual TLS / other) and exactly how it's presented on each request.
2. Real base API URL(s) per environment (sandbox vs. production).
3. How ADKSY's own workspace/seller maps to the partner's own seller/account id (the workspace ↔ partner-seller-id mapping this architecture does not yet implement — see ARCHITECTURE.md).

## Order creation
4. The real endpoint and HTTP method to create a fulfillment order.
5. The real required/optional request fields and their exact names/types (never assume ADKSY's `CreateFulfillmentOrderInput` field names match).
6. The real response shape, including the partner's own order-id field name.
7. The partner's real idempotency mechanism, if any (a header, a client-generated key, or none at all).

## Order lifecycle & status
8. The real status vocabulary the partner uses, and how each value maps onto `FulfillmentProviderOrderStatus.status`.
9. Whether status changes are pushed (webhook) or must be polled, and if polled, the real endpoint + realistic rate limits.
10. The real cancellation endpoint, and the real rule for when cancellation is no longer allowed (e.g. after pickup).

## Shipping & labels
11. Whether the partner supports pickup points/lockers at all, and if so, the real endpoint to list/select one.
12. Whether the partner supports label generation, in what format(s), and the real endpoint to retrieve the label artifact.
13. Which, if any, of `MarketplaceShippingRequirements`'s fields (carrier/service/shippingMethod/pickupPoint/locker/labelFormat/trackingReference/deadlines) the partner's API actually accepts or requires — never assumed from the interface alone.

## Tracking
14. The real tracking endpoint and the real event vocabulary/shape it returns.
15. Whether tracking can genuinely be "unavailable" for a period (and for how long), vs. always present once shipped.

## Webhooks (if the partner offers them)
16. The real webhook payload shape (field names for event id, event type, timestamp, order reference).
17. The real signature scheme: header name, algorithm, digest encoding (hex/base64/other), and the exact string that gets signed (raw body? a canonicalized subset?).
18. The real redelivery/retry behavior (does the partner retry on non-2xx? how many times? what backoff?).
19. The real per-provider webhook secret, obtained and stored as a real environment variable — never a placeholder committed to the repo.

## Costs & returns
20. The real cost model (per order / per kg / tiered) — never assumed to match `FulfillmentPartner.costPerOrder`/`costPerKg`'s existing shape without confirming the partner actually bills that way.
21. The partner's real returns process, if ADKSY is to support returns through them (no `Return` model exists in ADKSY today — a separate, not-yet-scoped piece of work).

## Once all 21 are answered

Write `src/services/fulfillment/providers/<Partner>Adapter.ts`
implementing `FulfillmentProvider`, add its id to
`registry.ts`'s resolution (replacing its current
`NotConfiguredFulfillmentProvider` fallback), and add partner-specific
tests mirroring `MockFulfillmentProvider.test.ts`'s structure. Wiring a
real call site to it (the AI tool, the dashboard, a new route) is a
separate decision made at that time, not before.
