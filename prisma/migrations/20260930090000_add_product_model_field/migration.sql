-- AI-first listing workflow fix (Priority 2 — model field): additive-only,
-- nullable column. Product.model was previously captured on a listing
-- draft (ListingDraftFields.model) but had no home on the real Product
-- row, so it was silently lost at create_product time. NULL for every
-- existing product — never backfilled or inferred.
ALTER TABLE "Product" ADD COLUMN "model" TEXT;
