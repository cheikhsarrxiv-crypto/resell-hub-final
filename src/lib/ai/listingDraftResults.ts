/**
 * Phase 12B — extracts generate_listing_draft/edit_listing_draft results
 * out of a message's raw toolCalls[], the same way
 * src/lib/ai/sourcingResults.ts already does for search_products.
 * `AgentToolCallRecord.result` is typed `unknown` on the backend, so
 * nothing here is trusted blindly — a malformed/unexpected shape is
 * excluded, never fabricated into something that looks valid.
 */
import type { ListingDraft, MarketplaceListingValidation } from '@/lib/listing/listingDraft';
import type { MarginCalculationResult } from '@/services/pricing/types';

export interface ListingDraftOutcome {
  toolCallIndex: number;
  status: 'ok' | 'error';
  draft?: ListingDraft;
  marketplaceValidation?: { ebay: MarketplaceListingValidation; etsy: MarketplaceListingValidation };
  /** AI-first listing workflow — present only when the draft has a proposed price (see listingDraftTools.ts's computeMarginPreview). null/absent is the honest "not computable yet" state, never a fabricated number. */
  marginPreview?: MarginCalculationResult | null;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isListingDraftShape(value: unknown): value is ListingDraft {
  if (!isRecord(value)) return false;
  const source = value.source;
  const fields = value.fields;
  if (!isRecord(source) || !isRecord(fields)) return false;

  return (
    typeof source.sourceItemId === 'string' &&
    typeof source.sourceUrl === 'string' &&
    typeof source.title === 'string' &&
    typeof source.currency === 'string' &&
    Array.isArray(source.images) &&
    typeof fields.title === 'string' &&
    typeof fields.description === 'string' &&
    typeof fields.currency === 'string' &&
    Array.isArray(value.generatedFieldKeys) &&
    Array.isArray(value.editedFieldKeys)
  );
}

function isMarketplaceValidationShape(value: unknown): value is MarketplaceListingValidation {
  if (!isRecord(value)) return false;
  return (
    typeof value.ready === 'boolean' &&
    Array.isArray(value.errors) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.missingFields)
  );
}

function isMarginPreviewShape(value: unknown): value is MarginCalculationResult {
  if (!isRecord(value)) return false;
  return typeof value.currency === 'string' && Array.isArray(value.warnings) && Array.isArray(value.missingData) && Array.isArray(value.costBreakdown);
}

const DRAFT_TOOL_NAMES = new Set(['generate_listing_draft', 'edit_listing_draft']);

export function extractListingDraftOutcomes(toolCalls: unknown[] | undefined): ListingDraftOutcome[] {
  if (!Array.isArray(toolCalls)) return [];

  const outcomes: ListingDraftOutcome[] = [];

  toolCalls.forEach((call, index) => {
    if (!isRecord(call) || typeof call.name !== 'string' || !DRAFT_TOOL_NAMES.has(call.name)) return;

    const result = call.result;
    if (!isRecord(result)) return;

    if (typeof result.error === 'string') {
      outcomes.push({ toolCallIndex: index, status: 'error', error: result.error });
      return;
    }

    if (!isListingDraftShape(result.draft)) return;

    const rawValidation = result.marketplaceValidation;
    if (!isRecord(rawValidation) || !isMarketplaceValidationShape(rawValidation.ebay) || !isMarketplaceValidationShape(rawValidation.etsy)) {
      return;
    }

    outcomes.push({
      toolCallIndex: index,
      status: 'ok',
      draft: result.draft,
      marketplaceValidation: { ebay: rawValidation.ebay, etsy: rawValidation.etsy },
      marginPreview: isMarginPreviewShape(result.marginPreview) ? result.marginPreview : null,
    });
  });

  return outcomes;
}
