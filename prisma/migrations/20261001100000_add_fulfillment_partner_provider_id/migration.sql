-- Fulfillment Integration Foundation V1 (Phase C) — additive-only,
-- nullable column. Maps a FulfillmentPartner to a FulfillmentProvider id
-- (src/services/fulfillment/registry.ts, e.g. "mock"). NULL for every
-- existing partner row, including the seeded "ShipMock France" — never
-- backfilled or inferred from the partner's name. A partner with
-- providerId=null keeps FulfillmentService.sendToFulfillment's exact
-- historical, provider-less behavior; only a partner explicitly given a
-- real providerId is ever dispatched to a real FulfillmentProvider.
ALTER TABLE "FulfillmentPartner" ADD COLUMN "providerId" TEXT;
