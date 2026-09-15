-- Prevents two active (not soft-deleted) Listing rows for the same
-- (productId, marketplaceConnectionId) pair — the DB-level half of the
-- publish-idempotency guard in ListingService.createListing.
--
-- A partial index, not a plain UNIQUE constraint, because deleteListing
-- soft-deletes (sets deletedAt) rather than removing the row, and a
-- legitimate republish after a real delist must remain possible.
--
-- Verified before writing this migration (via Supabase project
-- introspection on kowlzbmtqhlkstvecxhx / ADKSY): the live "Listing" table
-- currently has 0 rows, so no duplicate (productId, marketplaceConnectionId)
-- pair can exist yet — this index can be created directly with no backfill,
-- cleanup, or data migration needed.
CREATE UNIQUE INDEX "Listing_active_product_connection_key"
ON "Listing" ("productId", "marketplaceConnectionId")
WHERE "deletedAt" IS NULL;
