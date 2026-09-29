import { z } from 'zod';
import { isNormalizedSourcingResult } from '@/lib/ai/sourcingResults';
import {
  applyDraftEdit,
  setImageExcluded,
  validateEbayDraft,
  validateEtsyDraft,
  type ListingDraft,
  type ListingDraftFields,
} from '@/lib/listing/listingDraft';
import { ListingGenerationService } from '@/services/listing/ListingGenerationService';
import { isValidEtsyWhenMade } from '@/services/marketplace/EtsyListingMapper';
import { NotificationService } from '@/services/NotificationService';
import { PricingService } from '@/services/pricing/PricingService';
import type { NormalizedSourcingResult } from '@/services/sourcing/types';
import { AgentToolDefinition } from './types';
import { findToolResultsByName } from './conversationToolResults';

/**
 * AI-first listing workflow — the same margin math calculate_margin
 * itself uses (PricingService.fromSourcingResult + calculateMargin —
 * never a second/duplicated formula), computed here so a draft's own
 * "marge estimée" preview is available the moment a proposed selling
 * price exists, without the reseller having to call calculate_margin
 * separately. Returns null (never a fabricated number) when the draft has
 * no proposed price yet — exactly like calculate_margin's own missingData
 * would report resalePrice as missing.
 */
async function computeMarginPreview(sourced: NormalizedSourcingResult, draft: ListingDraft, workspaceId: string) {
  if (draft.fields.price === undefined || draft.fields.price === null) return null;
  const input = PricingService.fromSourcingResult(sourced, {
    targetCurrency: draft.fields.currency,
    resalePrice: draft.fields.price,
    resaleCurrency: draft.fields.currency,
    workspaceId,
  });
  return PricingService.calculateMargin(input);
}

function isListingDraft(value: unknown): value is ListingDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;
  return !!v.source && typeof v.source.sourceItemId === 'string' && !!v.fields && typeof v.fields.title === 'string';
}

/**
 * Never trusts a sourceUrl the model merely repeats back — confirms it
 * was really returned by a real search_products call earlier IN THIS
 * CONVERSATION (see conversationToolResults.ts). A sourceUrl that never
 * actually appeared (a fabricated/foreign one, or one from a different
 * conversation/workspace entirely — tool results are scoped to
 * conversationId, itself already workspace-verified by
 * AiAgentService.resolveConversation) never produces a draft.
 */
async function findSourcedResult(conversationId: string, sourceUrl: string, workspaceId: string) {
  const entries = await findToolResultsByName(conversationId, ['search_products'], workspaceId);
  for (const entry of entries) {
    const payload = entry.result as { results?: unknown[] } | null;
    const results = Array.isArray(payload?.results) ? payload!.results! : [];
    for (const candidate of results) {
      if (isNormalizedSourcingResult(candidate) && candidate.sourceUrl === sourceUrl) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Most recent draft for this exact sourceItemId — generate_listing_draft
 * and edit_listing_draft both write results this looks through. Exported
 * for reuse by publish_listing (Phase 12C-Offline — see actionTools.ts),
 * which must revalidate the SAME way rather than trust a draft handed to
 * it any other way.
 */
export async function findLatestDraft(conversationId: string, sourceItemId: string, workspaceId: string): Promise<ListingDraft | null> {
  const entries = await findToolResultsByName(
    conversationId,
    ['generate_listing_draft', 'edit_listing_draft', 'generate_listing_draft_image'],
    workspaceId
  );
  let latest: ListingDraft | null = null;
  for (const entry of entries) {
    const payload = entry.result as { draft?: unknown } | null;
    if (payload?.draft && isListingDraft(payload.draft) && payload.draft.source.sourceItemId === sourceItemId) {
      latest = payload.draft; // entries are chronological — the last match wins
    }
  }
  return latest;
}

export function buildValidationResult(draft: ListingDraft) {
  return { draft, marketplaceValidation: { ebay: validateEbayDraft(draft), etsy: validateEtsyDraft(draft) } };
}

const generateListingDraftInputSchema = z.object({
  sourceUrl: z.string().url(),
  proposedPrice: z.number().min(0).optional(),
  proposedCurrency: z.string().length(3).optional(),
  // AI-first listing workflow — an alternative to proposedPrice: when the
  // reseller states a target margin instead of a target price (e.g. "avec
  // une marge de 30%"), this computes proposedPrice by pure algebra from
  // the source's own real price (see ListingGenerationService's own
  // computePriceForTargetMargin) — never a default/invented margin.
  // Ignored if proposedPrice is also given (proposedPrice always wins).
  targetMarginPercent: z.number().min(0).max(99).optional(),
});

export const generateListingDraftTool: AgentToolDefinition<z.infer<typeof generateListingDraftInputSchema>> = {
  name: 'generate_listing_draft',
  description:
    "Prepares a listing draft (never a real publication) for a product the reseller selected from a previous search_products result in THIS conversation. " +
    'sourceUrl must be the exact sourceUrl of one of those real results — a fabricated or foreign one is rejected, never accepted on trust. ' +
    'proposedPrice, if given, is the reseller\'s PROPOSED selling price (distinct from the source\'s own cost) — never invented by this tool if omitted. ' +
    'targetMarginPercent is an alternative way to set the same proposed price: give it INSTEAD of proposedPrice only when the reseller stated a target ' +
    'margin rather than a target price — this computes the price by exact algebra from the source\'s own real purchase price, never a default/assumed margin. ' +
    'If neither is given, the draft\'s proposed price stays unset (never defaulted to the source\'s own cost) — ask the reseller for one before publishing. ' +
    'Title/description are generated deterministically from real source fields only — never invents brand/size/color/material/condition that are not already present ' +
    '(size/color/material have no source equivalent and can only ever be added later via edit_listing_draft, from the reseller\'s own explicit input). ' +
    'Returns marketplace-readiness validation for eBay and Etsy (never publishes). Triggers an in-app notification the reseller can use to come back to this draft.',
  category: 'write',
  inputSchema: generateListingDraftInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      sourceUrl: { type: 'string', description: 'The exact sourceUrl of a result already returned by search_products in this conversation.' },
      proposedPrice: { type: 'number', description: "The reseller's proposed selling price, if they gave one. Never invented." },
      proposedCurrency: { type: 'string', description: 'ISO 4217 code for proposedPrice. Defaults to the source item\'s own currency if omitted.' },
      targetMarginPercent: {
        type: 'number',
        description:
          'Alternative to proposedPrice: a target margin percentage (0-99) the reseller explicitly stated, e.g. 30 for "30%". The proposed price is then computed by exact algebra from the source\'s own real price — never a default/assumed margin. Ignored if proposedPrice is also given.',
      },
    },
    required: ['sourceUrl'],
  },
  async handler(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const sourced = await findSourcedResult(context.conversationId, input.sourceUrl, workspaceId);
    if (!sourced) {
      return { error: "This product was not found among this conversation's own search results. Search again before selecting it." };
    }

    const draft = ListingGenerationService.buildDraftFromSourcingResult(sourced, {
      proposedPrice: input.proposedPrice,
      proposedCurrency: input.proposedCurrency,
      targetMarginPercent: input.targetMarginPercent,
    });

    // AI-first listing workflow — notify the reseller the draft is ready
    // to review, with a real deep link back to this exact conversation.
    // Never throws (NotificationService.createNotification's own
    // guarantee) — a notification failure must never break draft
    // generation itself.
    await NotificationService.createNotification(
      workspaceId,
      'listing_draft_ready',
      'Annonce prête à vérifier',
      `Ton annonce "${draft.fields.title}" est prête à être vérifiée.`,
      undefined,
      `/dashboard/agent?conversationId=${context.conversationId}`
    );

    const marginPreview = await computeMarginPreview(sourced, draft, workspaceId);
    return { ...buildValidationResult(draft), marginPreview };
  },
};

const editableFieldsPatchSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(5000),
    price: z.number().min(0),
    currency: z.string().length(3),
    quantity: z.number().int().min(1),
    sku: z.string().max(100),
    condition: z.string().max(100),
    size: z.string().max(50),
    color: z.string().max(50),
    material: z.string().max(100),
    model: z.string().max(100),
    etsyTaxonomyId: z.number().int().positive(),
    // Audit finding (publish_listing hardening pass): previously any
    // string up to 50 chars was accepted here, so a typo'd/invented
    // etsyWhenMade could pass generate/edit_listing_draft's own validation
    // and only fail once it actually reached a real Etsy API call. Now
    // validated against the SAME real, Etsy-schema-verified list
    // ListingService.createListing's own error mapping already references
    // (EtsyListingMapper.ETSY_WHEN_MADE_OPTIONS) — never a separately
    // invented list.
    etsyWhenMade: z.string().max(50).refine(isValidEtsyWhenMade, { message: "Not a value Etsy's when_made currently accepts" }),
    etsyWhoMade: z.string().max(50),
    // Phase 12C-Prep — eBay-only, real, required fields for a ready eBay
    // draft (see EbayAdapter.validateListingInputForPublish). Never
    // inferred/guessed here either — only ever set by an explicit edit.
    ebayCategoryId: z.number().int().positive(),
    ebayMarketplaceId: z.string().max(20),
  })
  .partial();

const editListingDraftInputSchema = z.object({
  sourceUrl: z.string().url(),
  patch: editableFieldsPatchSchema,
  // AI-first listing workflow — image exclusion, never deletion: these
  // must be image urls already present in the draft's own source.images
  // or generatedImages (see the handler below, which filters out anything
  // that isn't) — a real photo is never removed from source.images/
  // generatedImages themselves, only excluded from what gets used for
  // this listing (see ListingDraft.excludedImageUrls's own comment).
  excludeImageUrls: z.array(z.string()).optional(),
  includeImageUrls: z.array(z.string()).optional(),
});

export const editListingDraftTool: AgentToolDefinition<z.infer<typeof editListingDraftInputSchema>> = {
  name: 'edit_listing_draft',
  description:
    'Applies an edit (e.g. a new proposed price, an updated title) on top of the MOST RECENT listing draft already generated for sourceUrl in this conversation, ' +
    'and re-validates it for eBay/Etsy. sourceUrl must match a draft this conversation already produced via generate_listing_draft — never accepted on trust. ' +
    'Never publishes anything. Only fields explicitly present in patch are changed; every edited field keeps its original generated value recoverable. ' +
    'excludeImageUrls/includeImageUrls toggle which of the draft\'s already-real images (source.images/generatedImages) are used for this listing — this ' +
    'NEVER deletes or overwrites a real photo, only marks it unused/used again; only urls already present on the draft are accepted.',
  category: 'write',
  inputSchema: editListingDraftInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      sourceUrl: { type: 'string', description: 'The sourceUrl of the product whose draft to edit — must already have a draft in this conversation.' },
      patch: {
        type: 'object',
        description: 'Only the fields to change — e.g. {"price": 449} to update just the proposed price.',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number', description: 'New proposed selling price.' },
          currency: { type: 'string' },
          quantity: { type: 'number' },
          sku: { type: 'string' },
          condition: { type: 'string' },
          size: { type: 'string' },
          color: { type: 'string', description: 'Color — has no source equivalent, only ever set from an explicit reseller instruction, never guessed.' },
          material: { type: 'string', description: 'Material — has no source equivalent, only ever set from an explicit reseller instruction, never guessed.' },
          model: { type: 'string', description: 'Model — has no source equivalent, only ever set from an explicit reseller instruction, never guessed.' },
          etsyTaxonomyId: { type: 'number', description: 'Etsy category id — only ever set from an explicit reseller instruction, never guessed.' },
          etsyWhenMade: { type: 'string' },
          etsyWhoMade: { type: 'string', description: 'Etsy who_made value (e.g. "i_did", "someone_else", "collective") — only ever set from an explicit reseller instruction, never guessed.' },
          ebayCategoryId: { type: 'number', description: 'eBay category id — only ever set from an explicit reseller instruction, never guessed.' },
          ebayMarketplaceId: { type: 'string', description: 'Target eBay country marketplace to sell on, e.g. "EBAY_FR" — never assumed from the source item\'s own marketplace.' },
        },
      },
      excludeImageUrls: {
        type: 'array',
        items: { type: 'string' },
        description: 'Image urls (from source.images/generatedImages) to stop using for this listing — never deletes the real photo, only excludes it.',
      },
      includeImageUrls: {
        type: 'array',
        items: { type: 'string' },
        description: 'Previously excluded image urls to use again for this listing.',
      },
    },
    required: ['sourceUrl', 'patch'],
  },
  async handler(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const latest = await findLatestDraft(context.conversationId, input.sourceUrl, workspaceId);
    if (!latest) {
      return { error: 'No listing draft found for this product in this conversation. Generate one first with generate_listing_draft.' };
    }

    let updated = applyDraftEdit(latest, input.patch as Partial<ListingDraftFields>);

    // Image exclusion — never deletion. Only urls that genuinely belong to
    // this draft's own source.images/generatedImages are accepted; a
    // fabricated/foreign url is silently ignored rather than recorded as
    // "excluded", since it could never have been shown to the reseller in
    // the first place.
    const knownImageUrls = new Set([...updated.source.images, ...(updated.generatedImages ?? []).map((img) => img.url)]);
    for (const url of input.excludeImageUrls ?? []) {
      if (knownImageUrls.has(url)) updated = setImageExcluded(updated, url, true);
    }
    for (const url of input.includeImageUrls ?? []) {
      if (knownImageUrls.has(url)) updated = setImageExcluded(updated, url, false);
    }

    const sourced = await findSourcedResult(context.conversationId, updated.source.sourceUrl, workspaceId);
    const marginPreview = sourced ? await computeMarginPreview(sourced, updated, workspaceId) : null;
    return { ...buildValidationResult(updated), marginPreview };
  },
};
