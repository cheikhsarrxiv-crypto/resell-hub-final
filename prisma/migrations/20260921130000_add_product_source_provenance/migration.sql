-- Provenance/deduplication architecture decision (Option A): records the
-- one external marketplace item a Product was created from, when it was
-- created from a real sourcing result — see Product's own schema comment.
--
-- Purely additive: three nullable columns, no default, no NOT NULL, no
-- CHECK constraint. Every existing Product row gets
-- sourceMarketplace = NULL, sourceId = NULL, sourceUrl = NULL and stays
-- exactly as valid as before — no backfill of any kind is performed or
-- attempted. Provenance for products that already existed before this
-- migration cannot be honestly reconstructed from their sku, their
-- Listing(s), their Listing's externalId, their MarketplaceConnection, or
-- supplierSku (none of those are the same identifier space as a sourcing
-- result's own sourceId/sourceUrl — see the provenance/deduplication audit),
-- so none of that is attempted here.
--
-- The new UNIQUE index is workspace-scoped, exactly like the existing
-- Product_workspaceId_sku_key — two different workspaces can source the
-- same external item independently, and standard Postgres UNIQUE
-- semantics already allow any number of rows with NULL in
-- sourceMarketplace/sourceId (NULL is never equal to NULL), so a
-- manually-created Product with no provenance is never blocked by this
-- constraint.
--
-- AlterTable
ALTER TABLE "Product" ADD COLUMN "sourceMarketplace" TEXT,
ADD COLUMN "sourceId" TEXT,
ADD COLUMN "sourceUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_workspaceId_sourceMarketplace_sourceId_key" ON "Product"("workspaceId", "sourceMarketplace", "sourceId");
