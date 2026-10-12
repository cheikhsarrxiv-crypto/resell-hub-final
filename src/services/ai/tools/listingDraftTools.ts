import { z } from 'zod';
import { randomUUID } from 'crypto';
import { isNormalizedSourcingResult } from '@/lib/ai/sourcingResults';
import {
  applyDraftEdit,
  setImageExcluded,
  validateEbayDraft,
  validateEtsyDraft,
  type ListingDraft,
  type ListingDraftFields,
} from '@/lib/listing/listingDraft';
import { ListingGenerationService, type FreeDraftPhoto } from '@/services/listing/ListingGenerationService';
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

/**
 * Free listing creation (real photo analysis) — collects every real photo
 * the reseller has uploaded to THIS conversation so far, across every
 * prior turn, via POST /api/ai/agent/photos. Reuses the exact same
 * findToolResultsByName mechanism (and the same conversation+workspace
 * ownership check it already performs) that revalidates sourceUrl/draftId
 * elsewhere in this file — never a second, parallel photo-tracking system.
 * AiAgentService.sendMessage persists one 'user_photos_uploaded' entry per
 * turn that had attachments; this flattens all of them in chronological
 * order, so a draft generated after several photo-sending turns gets every
 * one of them, not just the latest turn's.
 */
async function findUploadedPhotos(conversationId: string, workspaceId: string): Promise<FreeDraftPhoto[]> {
  const entries = await findToolResultsByName(conversationId, ['user_photos_uploaded'], workspaceId);
  const photos: FreeDraftPhoto[] = [];
  for (const entry of entries) {
    const payload = entry.result as { photos?: Array<{ url?: unknown; storagePath?: unknown; mimeType?: unknown }> } | null;
    for (const photo of Array.isArray(payload?.photos) ? payload!.photos! : []) {
      if (typeof photo?.url === 'string' && typeof photo?.storagePath === 'string' && typeof photo?.mimeType === 'string') {
        photos.push({ url: photo.url, storagePath: photo.storagePath, mimeType: photo.mimeType });
      }
    }
  }
  return photos;
}

/**
 * P2-2 fix (final review finding) — `.strict()` on BOTH top-level branches
 * (here and on freeGenerateDraftInputSchema below) so a call mixing fields
 * from both modes (e.g. {sourceUrl, title} together) fails validation
 * explicitly on EVERY branch of the union, instead of this schema silently
 * matching first and dropping the free-mode fields the model also sent —
 * which would otherwise produce a draft in a mode the model may not have
 * intended, with no error at all. Only the TOP-level shape is strict;
 * nested objects (editableFieldsPatchSchema) keep their own existing,
 * deliberately non-strict stripping behavior (see that schema's own XSS
 * test) — unaffected by this.
 */
const sourcedGenerateDraftInputSchema = z
  .object({
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
  })
  .strict();

/**
 * Free listing creation (real photo analysis) — the reseller already owns
 * this item; there is no sourceUrl at all (that is exactly what
 * distinguishes this branch — see the union below). Every field here is
 * the reseller's own explicit statement, never guessed from a photo or
 * invented — the same discipline SYSTEM_PROMPT_INSTRUCTIONS already
 * requires of the model when it fills this in.
 */
const freeGenerateDraftInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    brand: z.string().max(100).optional(),
    condition: z.string().max(100).optional(),
    size: z.string().max(50).optional(),
    color: z.string().max(50).optional(),
    material: z.string().max(100).optional(),
    model: z.string().max(100).optional(),
    proposedPrice: z.number().min(0).optional(),
    proposedCurrency: z.string().length(3).optional(),
  })
  .strict();

const generateListingDraftInputSchema = z.union([sourcedGenerateDraftInputSchema, freeGenerateDraftInputSchema]);
type SourcedGenerateDraftInput = z.infer<typeof sourcedGenerateDraftInputSchema>;
type FreeGenerateDraftInput = z.infer<typeof freeGenerateDraftInputSchema>;
type GenerateListingDraftInput = SourcedGenerateDraftInput | FreeGenerateDraftInput;

/**
 * The union's own discriminant: whichever branch Zod actually matched is
 * told apart by the one field only the sourced branch ever has. Never
 * inferred from anything else (never "guessed" from whether other optional
 * fields are present).
 */
function isSourcedGenerateInput(input: GenerateListingDraftInput): input is SourcedGenerateDraftInput {
  return typeof (input as SourcedGenerateDraftInput).sourceUrl === 'string';
}

export const generateListingDraftTool: AgentToolDefinition<GenerateListingDraftInput> = {
  name: 'generate_listing_draft',
  description:
    'Prepares a listing draft (never a real publication) in one of two modes, told apart by whether sourceUrl is given. ' +
    "SOURCED mode (sourceUrl given): for a product the reseller selected from a previous search_products result in THIS conversation. " +
    'sourceUrl must be the exact sourceUrl of one of those real results — a fabricated or foreign one is rejected, never accepted on trust. ' +
    'Title/description are generated deterministically from real source fields only — never invents brand/size/color/material/condition that are not already present. ' +
    'FREE mode (sourceUrl omitted entirely): for an item the reseller already owns and is NOT sourced from anywhere — use this whenever the reseller is listing ' +
    'their own item. Requires `title`; brand/condition/size/color/material/model are each ONLY ever the reseller\'s own explicit statement, never guessed from a ' +
    'photo or invented — leave a field unset rather than guessing it. Any real photo already sent in this conversation (see user_photos_uploaded) is attached ' +
    'automatically; you never pass an image yourself. Returns a draftId (free mode only) — pass it back as draftId on every later edit_listing_draft call ' +
    'for this same item (NEVER to create_product, which does not accept a draftId at all and only works for a sourced item — see SYSTEM_PROMPT_INSTRUCTIONS\' ' +
    'own "Free draft — a real, honest limitation" note). ' +
    'In EITHER mode: proposedPrice, if given, is the reseller\'s PROPOSED selling price — never invented by this tool if omitted. targetMarginPercent (sourced mode ' +
    'only) is an alternative way to set the same proposed price, computed by exact algebra from the source\'s own real purchase price — never a default/assumed ' +
    'margin, and ignored if proposedPrice is also given. If neither is given, the draft\'s proposed price stays unset. ' +
    'Returns marketplace-readiness validation for eBay and Etsy (never publishes). Triggers an in-app notification the reseller can use to come back to this draft.',
  category: 'write',
  inputSchema: generateListingDraftInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      sourceUrl: {
        type: 'string',
        description:
          'SOURCED mode only: the exact sourceUrl of a result already returned by search_products in this conversation. Omit this field ENTIRELY (never an empty string) to use FREE mode for an item the reseller already owns.',
      },
      title: { type: 'string', description: 'FREE mode only (required in that mode): the item\'s title, from the reseller\'s own words. Never used/needed in sourced mode.' },
      brand: { type: 'string', description: 'FREE mode only. Only ever the reseller\'s own explicit statement, never guessed from a photo.' },
      condition: { type: 'string', description: 'FREE mode only. Only ever the reseller\'s own explicit statement, never guessed from a photo.' },
      size: { type: 'string', description: 'FREE mode only. Only ever the reseller\'s own explicit statement, never guessed from a photo.' },
      color: { type: 'string', description: 'FREE mode only. Only ever the reseller\'s own explicit statement, never guessed from a photo.' },
      material: { type: 'string', description: 'FREE mode only. Only ever the reseller\'s own explicit statement, never guessed from a photo.' },
      model: { type: 'string', description: 'FREE mode only. Only ever the reseller\'s own explicit statement, never guessed from a photo.' },
      proposedPrice: { type: 'number', description: "Either mode: the reseller's proposed selling price, if they gave one. Never invented." },
      proposedCurrency: { type: 'string', description: 'Either mode: ISO 4217 code for proposedPrice. Sourced mode defaults to the source item\'s own currency; free mode defaults to EUR if omitted.' },
      targetMarginPercent: {
        type: 'number',
        description:
          'SOURCED mode only: alternative to proposedPrice — a target margin percentage (0-99) the reseller explicitly stated, e.g. 30 for "30%". Computed by exact algebra from the source\'s own real price. Ignored if proposedPrice is also given.',
      },
    },
    required: [],
  },
  async handler(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    if (isSourcedGenerateInput(input)) {
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
      return { ...buildValidationResult(draft), marginPreview, draftId: draft.source.sourceItemId };
    }

    // FREE mode — no external source at all. draftId is minted here (never
    // by the model) and becomes this draft's own sourceItemId, the same
    // stable key findLatestDraft/edit_listing_draft already use for a
    // sourced draft's sourceUrl. NEVER accepted by create_product, which
    // has no draftId field and remains sourced-only (see this tool's own
    // description and SYSTEM_PROMPT_INSTRUCTIONS).
    const draftId = `free-${randomUUID()}`;
    const photos = await findUploadedPhotos(context.conversationId, workspaceId);
    const draft = ListingGenerationService.buildFreeDraft(input, photos, draftId);

    await NotificationService.createNotification(
      workspaceId,
      'listing_draft_ready',
      'Annonce prête à vérifier',
      `Ton annonce "${draft.fields.title}" est prête à être vérifiée.`,
      undefined,
      `/dashboard/agent?conversationId=${context.conversationId}`
    );

    // Margin preview is never computed here for a free draft — there is no
    // sourced purchase cost to base it on. The reseller uses the separate,
    // already-standalone calculate_margin tool once they've stated their
    // own purchase price (see SYSTEM_PROMPT_INSTRUCTIONS) — never a second,
    // duplicated margin formula.
    return { ...buildValidationResult(draft), marginPreview: null, draftId };
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

// P2-2 fix — `.strict()` on both top-level branches, same reasoning as
// generate_listing_draft's own two schemas above: a call mixing sourceUrl
// and draftId together must fail explicitly, never silently match one
// branch and drop the other's fields. Still never affects the nested
// `patch` object's own non-strict stripping (editableFieldsPatchSchema is
// shared, unchanged).
const sourcedEditListingDraftInputSchema = z
  .object({
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
  })
  .strict();

/**
 * Free listing creation (real photo analysis) — edits a free-mode draft by
 * its minted draftId (returned by generate_listing_draft's free mode)
 * instead of a sourceUrl, since a free draft never had one.
 */
const freeEditListingDraftInputSchema = z
  .object({
    draftId: z.string().min(1),
    patch: editableFieldsPatchSchema,
    excludeImageUrls: z.array(z.string()).optional(),
    includeImageUrls: z.array(z.string()).optional(),
  })
  .strict();

const editListingDraftInputSchema = z.union([sourcedEditListingDraftInputSchema, freeEditListingDraftInputSchema]);
type SourcedEditListingDraftInput = z.infer<typeof sourcedEditListingDraftInputSchema>;
type FreeEditListingDraftInput = z.infer<typeof freeEditListingDraftInputSchema>;
type EditListingDraftInput = SourcedEditListingDraftInput | FreeEditListingDraftInput;

function isSourcedEditInput(input: EditListingDraftInput): input is SourcedEditListingDraftInput {
  return typeof (input as SourcedEditListingDraftInput).sourceUrl === 'string';
}

export const editListingDraftTool: AgentToolDefinition<EditListingDraftInput> = {
  name: 'edit_listing_draft',
  description:
    'Applies an edit (e.g. a new proposed price, an updated title) on top of the MOST RECENT listing draft already generated in this conversation, ' +
    'and re-validates it for eBay/Etsy. SOURCED mode: pass sourceUrl, matching a draft this conversation already produced via generate_listing_draft\'s ' +
    'sourced mode — never accepted on trust. FREE mode: pass draftId instead (the id generate_listing_draft\'s free mode returned) — never a sourceUrl, ' +
    'since a free draft never has one. Never publishes anything. Only fields explicitly present in patch are changed; every edited field keeps its ' +
    'original generated value recoverable. excludeImageUrls/includeImageUrls toggle which of the draft\'s already-real images (source.images/' +
    'generatedImages) are used for this listing — this NEVER deletes or overwrites a real photo, only marks it unused/used again; only urls already ' +
    'present on the draft are accepted.',
  category: 'write',
  inputSchema: editListingDraftInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      sourceUrl: { type: 'string', description: 'SOURCED mode only: the sourceUrl of the product whose draft to edit — must already have a draft in this conversation. Omit entirely for a free-mode draft (use draftId instead).' },
      draftId: { type: 'string', description: 'FREE mode only: the draftId generate_listing_draft\'s free mode returned for this item. Omit entirely for a sourced draft (use sourceUrl instead).' },
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
    required: ['patch'],
  },
  async handler(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const lookupKey = isSourcedEditInput(input) ? input.sourceUrl : input.draftId;
    const latest = await findLatestDraft(context.conversationId, lookupKey, workspaceId);
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

    // A free draft's source.sourceUrl is absent — there is no sourced
    // margin basis to re-check for it (see generate_listing_draft's free
    // mode, which already returns marginPreview: null for the same
    // reason).
    const marginPreview =
      updated.source.kind === 'sourced' && updated.source.sourceUrl
        ? await (async () => {
            const sourced = await findSourcedResult(context.conversationId, updated.source.sourceUrl as string, workspaceId);
            return sourced ? computeMarginPreview(sourced, updated, workspaceId) : null;
          })()
        : null;
    return { ...buildValidationResult(updated), marginPreview, draftId: updated.source.sourceItemId };
  },
};
