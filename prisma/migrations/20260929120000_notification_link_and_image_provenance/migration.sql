-- AI-first listing workflow: additive-only, nullable columns.
-- Notification.link: lets a notification deep-link to the conversation/
-- draft it's about (e.g. "/dashboard/agent?conversationId=...").
ALTER TABLE "Notification" ADD COLUMN "link" TEXT;

-- ProductImage provenance: distinguishes a real source photo from an
-- AI-generated one, and records where each came from. NULL for every
-- pre-existing row (manual dashboard uploads) — unchanged behavior.
ALTER TABLE "ProductImage" ADD COLUMN "sourceType" TEXT;
ALTER TABLE "ProductImage" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "ProductImage" ADD COLUMN "generationMetadata" TEXT;
