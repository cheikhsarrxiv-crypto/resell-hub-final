-- Adds Etsy-specific listing metadata needed to publish real listings
-- instead of the previous hardcoded placeholders (taxonomy_id: 1,
-- when_made: 'made_to_order') — see EtsyListingMapper.ts.
--
-- Both new Product columns are nullable: every existing product (eBay-only
-- or not yet categorized for Etsy) stays valid with no backfill required.
-- etsyWhenMade stores the seller's chosen Etsy when_made value directly
-- (a string, one of Etsy's own enum values) rather than a numeric year —
-- Etsy's own API requires this exact enum on every listing (verified
-- against their real createDraftListing request schema), and there is no
-- honest year-to-bucket inference for years outside that verified enum,
-- so the seller picks the real bucket directly instead.
--
-- EtsyTaxonomyNode is a new, independent reference table (Etsy's public
-- seller-taxonomy tree, cached locally) with no foreign key from Product —
-- it can be empty or repopulated independently without touching Product
-- rows.
--
-- AlterTable
ALTER TABLE "Product" ADD COLUMN "etsyTaxonomyId" INTEGER,
ADD COLUMN "etsyWhenMade" TEXT;

-- CreateTable
CREATE TABLE "EtsyTaxonomyNode" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "parentId" INTEGER,
    "fullPath" TEXT NOT NULL,

    CONSTRAINT "EtsyTaxonomyNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EtsyTaxonomyNode_parentId_idx" ON "EtsyTaxonomyNode"("parentId");
