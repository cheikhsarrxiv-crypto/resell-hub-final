/**
 * Phase 12B — the ListingDraft abstraction: a preparation, never a
 * publication. Deliberately framework-free (no Prisma, no React) so it's
 * directly unit-testable and can be imported both server-side
 * (ListingGenerationService, the generate/edit_listing_draft tools) and
 * client-side (the draft editor, for instant re-validation without a
 * network round trip) — same reasoning as
 * src/lib/ai/agentActionStateMachine.ts.
 *
 * A draft is never persisted as its own DB row (see the Phase 12B report's
 * own "persistence" section for why): it lives exactly like a
 * search_products/calculate_margin result already does — as a tool call's
 * result, attached to the AgentMessage that produced it, and re-derived
 * from that same conversation history for any follow-up edit. No new
 * table, no new publication path — creating a real Listing row still only
 * ever happens through ListingService.createListing (untouched by this
 * phase), and this module has no way to call it.
 */

// Mirrors src/services/sourcing/types.ts's own AuthenticityStatus
// (deliberately a separate type, not imported — see this file's own
// architecture notes) — 'unknown' added for the same reason: reserved
// for a future source with no authenticity signal mechanism at all, not
// emitted by any provider today.
export type AuthenticityStatus = 'verified' | 'claimed' | 'unverified' | 'unknown';

/**
 * FACTUAL data — copied verbatim from a real NormalizedSourcingResult that
 * genuinely appeared in THIS conversation's own search_products results
 * (see tools/listingDraftTools.ts's revalidation guard). Never invented,
 * never edited in place — a seller who disagrees with a factual field
 * edits the corresponding entry in `fields` instead; `source` stays the
 * historical record of what was actually found.
 */
export interface ListingDraftSource {
  /** The stable identifier used to re-find/revalidate this exact item — always sourceUrl (every NormalizedSourcingResult has one; sourceId is optional). */
  sourceItemId: string;
  sourceProductId?: string;
  sourceMarketplace: string;
  sourceUrl: string;
  title: string;
  brand?: string;
  condition?: string;
  images: string[];
  price: number;
  currency: string;
  shippingCost?: number;
  shippingCostCurrency?: string;
  authenticityStatus: AuthenticityStatus;
  authenticitySource?: string;
  sellerName?: string;
  /**
   * Opportunity Classification fix (Web Sourcing audit) — read-only
   * traceability of what the source ACTUALLY reported, copied verbatim
   * from NormalizedSourcingResult whenever present, never a guess when
   * absent. `size`/`color`/`material` are ALSO pre-filled onto
   * ListingDraftFields when known (see buildDraftFromSourcingResult) —
   * these copies on `source` exist so the reseller can always see what
   * the source itself said, even after editing the field value.
   */
  size?: string;
  color?: string;
  material?: string;
  availability?: string;
  productUrl?: string;
  pageType?: 'PRODUCT_PAGE' | 'CATEGORY_PAGE' | 'SEARCH_PAGE' | 'COLLECTION_PAGE' | 'UNKNOWN';
  qualityTier?: 'HIGH' | 'MEDIUM' | 'LOW';
  /**
   * Opportunity Classification fix — echoes the search result's own
   * classification at the moment this draft was built (never
   * 'REJECTED' — a rejected candidate never becomes a sourcing result at
   * all, so it can never reach this point either). See
   * validateDraftForEbay/validateDraftForEtsy for how this gates an
   * explicit, non-blocking warning at publish-validation time.
   */
  classification?: 'VERIFIED_OPPORTUNITY' | 'WEB_LEAD';
}

/**
 * The editable draft fields a reseller can see and change. `price` is
 * deliberately optional — a proposed SELLING price must never be silently
 * defaulted to the source's cost (that would misrepresent a cost as a
 * revenue proposal) or to 0; until a real proposal exists, it's simply
 * absent, and the validator reports it as a genuine missing field.
 * `size`/`material`/`color`: for a declared (free-creation) draft, these
 * can ONLY ever come from an explicit user edit, never generation — the
 * reseller is the only source. For a SOURCED draft, these are now
 * pre-filled from the source's own real, reported value when one exists
 * (see buildDraftFromSourcingResult and ListingDraftSource's own matching
 * fields for traceability) — this was a stale limitation (the Deep Web
 * Sourcing Engine added `size`/`material`/`color` to
 * NormalizedSourcingResult, but this generation step was never updated to
 * use them); absent from the source, they remain editable-only exactly as
 * before.
 */
export interface ListingDraftFields {
  title: string;
  description: string;
  price?: number;
  currency: string;
  quantity: number;
  sku?: string;
  condition?: string;
  size?: string;
  /** No source equivalent, exactly like `size` — see that field's own comment. Only ever set by an explicit user edit, never generated. */
  color?: string;
  /** Same rule as `color`/`size`: no NormalizedSourcingResult field to copy from, so this can ONLY ever come from an explicit user edit. */
  material?: string;
  /** Same rule as `color`/`size`/`material`: no NormalizedSourcingResult field to copy from, so this can ONLY ever come from an explicit user edit. */
  model?: string;
  /** Etsy-only, optional — see validateEtsyDraft. Never inferred/guessed; only ever set by an explicit user edit. */
  etsyTaxonomyId?: number;
  etsyWhenMade?: string;
  /**
   * Etsy-only, optional — Etsy's who_made field (e.g. 'i_did', 'someone_else',
   * 'collective'). Required by EtsyAdapter.createListing (see that
   * adapter's own comment) exactly like etsyTaxonomyId/etsyWhenMade —
   * never guessed from the source item, which has no equivalent field of
   * its own. Only ever set by an explicit user edit.
   */
  etsyWhoMade?: string;
  /**
   * Phase 12C-Prep — eBay-only, optional. EbayAdapter.createListing now
   * requires both (see that adapter's validateListingInputForPublish) —
   * neither is ever inferred from the source item's own marketplace
   * (sourceMarketplace is where the item was FOUND, never assumed to be
   * where the reseller wants to SELL it — conflating the two is exactly
   * the "publishes to the wrong marketplace" risk this phase audited).
   * Only ever set by an explicit user edit.
   */
  ebayCategoryId?: number;
  ebayMarketplaceId?: string;
}

export type ListingDraftFieldKey = keyof ListingDraftFields;

/**
 * AI-first listing workflow — one real image an ImageGenerationProvider
 * actually produced (see src/services/imagegen/types.ts's own
 * GeneratedImageResult, which this mirrors exactly). Deliberately kept
 * OUT of `fields`/`source`: it is neither a source FACT (source.images
 * already covers those) nor a user-editable proposal — it's provider
 * output with its own real provenance, which must never be lost or
 * confused with a real product photo. `prompt` is always the exact text
 * actually sent to the provider — built ONLY from this draft's own known
 * facts (see generate_listing_draft_image's own handler), never shown to
 * imply it was invented freely.
 */
export interface GeneratedListingImage {
  url: string;
  provider: string;
  model: string;
  prompt: string;
  generatedAt: string;
}

export interface ListingDraft {
  source: ListingDraftSource;
  fields: ListingDraftFields;
  /** Which of `fields`' keys ListingGenerationService auto-populated at creation — never includes a field the user later overrides (see editedFieldKeys). */
  generatedFieldKeys: ListingDraftFieldKey[];
  /** Which of `fields`' keys the user has since edited, overriding whatever ListingGenerationService originally proposed. */
  editedFieldKeys: ListingDraftFieldKey[];
  /** The pre-edit value for every key in editedFieldKeys — so an edit is never a silent, unrecoverable overwrite of what was originally proposed. */
  originalValues: Partial<ListingDraftFields>;
  /**
   * AI-first listing workflow — real AI-generated images attached to
   * this draft, ONLY ever appended by generate_listing_draft_image after
   * a real ImageGenerationProvider call succeeded. Absent/empty is the
   * normal, honest state whenever no generation was requested or none
   * succeeded — never defaulted to a placeholder.
   */
  generatedImages?: GeneratedListingImage[];
  /**
   * AI-first listing workflow — image URLs (from source.images and/or
   * generatedImages) the reseller has chosen NOT to use for this listing.
   * Deliberately an exclusion list, never a deletion: source.images and
   * generatedImages themselves are never mutated/shortened by this, so a
   * real photo is never lost and can always be re-included later. Absent/
   * empty means every image is in use, the normal default.
   */
  excludedImageUrls?: string[];
}

/**
 * Toggles one image url in/out of excludedImageUrls. Pure — returns a new
 * draft, never mutates the one passed in, and never touches source.images
 * or generatedImages themselves — this only ever changes which of the
 * already-real images are used for this listing, never deletes or
 * overwrites a real photo.
 */
export function setImageExcluded(draft: ListingDraft, imageUrl: string, excluded: boolean): ListingDraft {
  const current = new Set(draft.excludedImageUrls ?? []);
  if (excluded) {
    current.add(imageUrl);
  } else {
    current.delete(imageUrl);
  }
  return { ...draft, excludedImageUrls: Array.from(current) };
}

/** The images actually usable for this listing right now — source + generated, minus anything excluded. Never mutates source.images/generatedImages. */
export function usableDraftImages(draft: ListingDraft): string[] {
  const excluded = new Set(draft.excludedImageUrls ?? []);
  return [...draft.source.images, ...(draft.generatedImages ?? []).map((img) => img.url)].filter((url) => !excluded.has(url));
}

/**
 * Applies a user's edit on top of an existing draft. Pure — returns a new
 * draft, never mutates the one passed in. Only fields that actually change
 * value get recorded in editedFieldKeys/originalValues; re-submitting the
 * same value is a no-op for tracking purposes (still safe to call
 * repeatedly, e.g. from a debounced form).
 */
export function applyDraftEdit(draft: ListingDraft, patch: Partial<ListingDraftFields>): ListingDraft {
  const nextFields: ListingDraftFields = { ...draft.fields };
  const editedFieldKeys = new Set(draft.editedFieldKeys);
  const originalValues: Partial<ListingDraftFields> = { ...draft.originalValues };

  for (const key of Object.keys(patch) as ListingDraftFieldKey[]) {
    const newValue = patch[key];
    if (newValue === undefined) continue;
    if (draft.fields[key] === newValue) continue;

    if (!editedFieldKeys.has(key)) {
      // First edit to this field — snapshot what it was before, so it's
      // never silently lost.
      (originalValues as any)[key] = draft.fields[key];
      editedFieldKeys.add(key);
    }
    (nextFields as any)[key] = newValue;
  }

  return {
    ...draft,
    fields: nextFields,
    editedFieldKeys: Array.from(editedFieldKeys),
    originalValues,
  };
}

/**
 * Appends one real, provider-produced image to the draft. Pure — returns
 * a new draft, never mutates the one passed in, and never touches
 * `source.images`/`fields` (a generated image is neither a source fact
 * nor an editable field — see GeneratedListingImage's own comment).
 */
export function addGeneratedImage(draft: ListingDraft, image: GeneratedListingImage): ListingDraft {
  return {
    ...draft,
    generatedImages: [...(draft.generatedImages ?? []), image],
  };
}

export interface MarketplaceListingValidation {
  marketplace: 'ebay' | 'etsy';
  ready: boolean;
  errors: string[];
  warnings: string[];
  missingFields: string[];
}

function authenticityWarning(source: ListingDraftSource): string | null {
  if (source.authenticityStatus === 'verified') return null;
  if (source.authenticityStatus === 'claimed') {
    return "Authenticité déclarée par le vendeur source uniquement — non vérifiée. Ne jamais présenter cette annonce comme authentifiée.";
  }
  return "Authenticité non vérifiée par la source. Ne jamais présenter cette annonce comme authentifiée.";
}

/**
 * Opportunity Classification fix (Web Sourcing audit, section 6) — a
 * NON-BLOCKING warning distinguishing "techniquement publiable" from
 * "source insuffisamment vérifiée". Never affects `ready`/`missingFields`
 * — a WEB_LEAD or non-HIGH-quality source is never, by itself, a reason
 * to block publication; only a genuinely missing REQUIRED field does
 * that (see the errors/missingFields checks elsewhere in each
 * validator). Absent entirely for a draft whose source was never
 * classified (e.g. built before this fix existed, or from a provider
 * that doesn't set it).
 */
function sourceVerificationWarning(source: ListingDraftSource | undefined): string | null {
  if (!source) return null;
  if (source.classification === 'WEB_LEAD') {
    return 'Cette annonce provient d\'une piste web (WEB_LEAD) — certaines informations (couleur, taille, qualité de la source) ne sont pas entièrement confirmées. L\'annonce reste techniquement publiable ; vérifiez ces points avant de la présenter comme fiable à 100%.';
  }
  if (source.qualityTier && source.qualityTier !== 'HIGH') {
    return `La source de cette annonce a un niveau de confiance "${source.qualityTier}" (pas "HIGH") — certaines informations peuvent être incomplètes. L'annonce reste techniquement publiable ; vérifiez les informations manquantes avant de la présenter comme fiable à 100%.`;
  }
  return null;
}

/**
 * Phase 12C-Prep — updated for EbayAdapter's real, now-fixed requirements
 * (see EbayAdapter.validateListingInputForPublish): title/price/quantity/
 * currency/condition/ebayCategoryId/ebayMarketplaceId are all genuinely
 * required now, none of them silently defaulted by the adapter anymore.
 * This validator's `ready` therefore now means what it says: if ready,
 * mapDraftToEbayInput(draft) below produces exactly the object
 * EbayAdapter.createListing would accept without throwing a pre-flight
 * validation error.
 */
export function validateEbayDraft(draft: ListingDraft): MarketplaceListingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingFields: string[] = [];

  if (!draft.fields.title || draft.fields.title.trim().length === 0) {
    errors.push('Missing title');
    missingFields.push('title');
  }
  if (draft.fields.price === undefined || draft.fields.price === null) {
    errors.push('Missing proposed selling price');
    missingFields.push('price');
  } else if (draft.fields.price <= 0) {
    errors.push('Proposed selling price must be greater than 0');
  }
  if (!draft.fields.currency) {
    errors.push('Missing currency for the proposed price');
    missingFields.push('currency');
  }
  if (!draft.fields.quantity || draft.fields.quantity <= 0) {
    errors.push('Missing or invalid quantity');
    missingFields.push('quantity');
  }
  if (!draft.fields.condition) {
    errors.push('Missing condition — eBay requires one, never defaulted automatically.');
    missingFields.push('condition');
  }
  if (draft.fields.ebayCategoryId == null) {
    errors.push('No eBay category (ebayCategoryId) set — required by eBay, never guessed. Set one manually before this draft can be ready for eBay.');
    missingFields.push('ebayCategoryId');
  }
  if (!draft.fields.ebayMarketplaceId) {
    errors.push('No target eBay marketplace (ebayMarketplaceId) set — never assumed from the source item\'s own marketplace. Set one manually before this draft can be ready for eBay.');
    missingFields.push('ebayMarketplaceId');
  }

  const authWarning = authenticityWarning(draft.source);
  if (authWarning) warnings.push(authWarning);
  const verificationWarning = sourceVerificationWarning(draft.source);
  if (verificationWarning) warnings.push(verificationWarning);

  if (!draft.fields.size) {
    warnings.push('No size set — the source did not report one; add it manually if relevant.');
  }
  if (draft.source.images.length === 0) {
    warnings.push('No source images available.');
  } else if (usableDraftImages(draft).length === 0) {
    warnings.push('All available images have been excluded for this listing — add at least one back before publishing.');
  } else {
    // Phase 7 — mapDraftToEbayInput forwards these URLs verbatim as
    // imageUrls on a real publish (see EbayAdapter.createListing): they are
    // the external source listing's own hotlinked photos, never re-hosted,
    // reviewed, or verified for usage rights by ADKSY. Flagged explicitly
    // rather than silently treated as ready-to-use — this project invents
    // no legal solution for image rights, it only ever surfaces the real
    // fact that these images are external and unreviewed.
    warnings.push('Images are copied directly from the external source listing — not reviewed or re-hosted by ADKSY. Verify you have the right to use them before publishing.');
  }
  warnings.push(
    'Payment/return/fulfillment policies are not yet managed by ADKSY — eBay may still require configured seller policies before a real publish succeeds. This draft cannot verify that.'
  );

  return { marketplace: 'ebay', ready: errors.length === 0, errors, warnings, missingFields };
}

/**
 * Phase 12C-Prep — the single source of truth for "what would actually be
 * sent to eBay": builds the real MarketplaceListingInput object
 * EbayAdapter.createListing expects, from this exact draft. Used both by
 * the Preview UI (so it can never show a field as ready/visible that
 * isn't really transmitted — see the Phase 12C-Prep report's own
 * "Preview" section) and would be the real payload for a future
 * publish_listing execution. Returns null when the draft isn't ready —
 * never returns a partially-fabricated payload with invented values for
 * the missing fields.
 */
export function mapDraftToEbayInput(draft: ListingDraft): Record<string, unknown> | null {
  const validation = validateEbayDraft(draft);
  if (!validation.ready) return null;

  return {
    title: draft.fields.title,
    description: draft.fields.description,
    price: draft.fields.price,
    currency: draft.fields.currency,
    quantity: draft.fields.quantity,
    sku: draft.fields.sku,
    condition: draft.fields.condition,
    // Real source photos first, AI-generated ones appended after — never
    // the reverse (see this project's own rule: prefer real images when
    // both exist). Generated image URLs are provider-hosted and
    // time-limited (see OpenAIImageGenerationProvider's own comment on
    // dall-e-3 URL expiry) — a real, documented limitation, not hidden.
    // Anything in excludedImageUrls is left out here — the reseller's own
    // choice not to use it — but source.images/generatedImages themselves
    // are never touched.
    images: usableDraftImages(draft),
    ebay: {
      categoryId: draft.fields.ebayCategoryId,
      marketplaceId: draft.fields.ebayMarketplaceId,
    },
  };
}

/**
 * Etsy's real createDraftListing requires who_made/when_made/taxonomy_id
 * on every listing (see EtsyListingMapper.ts, verified against Etsy's own
 * published API schema) — a product sourced from eBay has none of these,
 * and none is ever guessed here. A draft is realistically NOT_READY for
 * Etsy until a seller supplies them explicitly via an edit.
 */
export function validateEtsyDraft(draft: ListingDraft): MarketplaceListingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingFields: string[] = [];

  if (!draft.fields.title || draft.fields.title.trim().length === 0) {
    errors.push('Missing title');
    missingFields.push('title');
  }
  if (!draft.fields.description || draft.fields.description.trim().length === 0) {
    errors.push('Missing description');
    missingFields.push('description');
  }
  if (draft.fields.price === undefined || draft.fields.price === null) {
    errors.push('Missing proposed selling price');
    missingFields.push('price');
  }
  if (!draft.fields.quantity || draft.fields.quantity <= 0) {
    errors.push('Missing or invalid quantity');
    missingFields.push('quantity');
  }
  if (draft.fields.etsyTaxonomyId == null) {
    errors.push('No Etsy category (taxonomyId) set — required by Etsy, never guessed. Set one manually before this draft can be ready for Etsy.');
    missingFields.push('etsyTaxonomyId');
  }
  if (!draft.fields.etsyWhenMade) {
    errors.push('No Etsy "when made" era set — required by Etsy, never guessed. Select one manually before this draft can be ready for Etsy.');
    missingFields.push('etsyWhenMade');
  }
  if (!draft.fields.etsyWhoMade) {
    errors.push('No Etsy "who made" value set — required by Etsy, never guessed. Select one manually before this draft can be ready for Etsy.');
    missingFields.push('etsyWhoMade');
  }
  // AI-first listing workflow (Etsy images audit finding) — unlike eBay
  // (where missing images are only a warning, since eBay's own API never
  // required them for this draft's supported categories), Etsy's real
  // publish path now genuinely uploads images as a separate step after
  // creation (see publish_etsy_listing's handler) — a listing with zero
  // usable images would publish looking broken/unsellable. This is a hard
  // requirement, checked BEFORE any API call, exactly like every other
  // required Etsy field above — never guessed, never defaulted.
  if (usableDraftImages(draft).length === 0) {
    errors.push('No usable image available for Etsy — at least one real or generated, non-excluded image is required before this draft can be ready for Etsy.');
    missingFields.push('images');
  }

  const authWarning = authenticityWarning(draft.source);
  if (authWarning) warnings.push(authWarning);
  const verificationWarning = sourceVerificationWarning(draft.source);
  if (verificationWarning) warnings.push(verificationWarning);

  return { marketplace: 'etsy', ready: errors.length === 0, errors, warnings, missingFields };
}

/**
 * The Etsy equivalent of mapDraftToEbayInput above — the single source of
 * truth for "what would actually be sent to Etsy": builds the real
 * MarketplaceListingInput object EtsyAdapter.createListing expects, from
 * this exact draft. Deliberately a different shape than the eBay mapper —
 * EtsyAdapter.createListing never reads currency/condition/category at all
 * (see that adapter's own createListing body: only
 * quantity/title/description/price/who_made/when_made/taxonomy_id/sku), so
 * none of those are included here. Images are deliberately ALSO excluded
 * from this payload — not because Etsy doesn't support them, but because
 * Etsy's real API only accepts images via a SEPARATE call after the
 * listing already exists (POST .../listings/{listing_id}/images, one
 * multipart upload per image — see EtsyAdapter.uploadListingImage) —
 * there is no combined "create with images" request to build a payload
 * for. publish_etsy_listing's own handler calls usableDraftImages(draft)
 * directly and uploads them once createListing has returned a real
 * listing_id (see actionTools.ts). validateEtsyDraft above still requires
 * at least one usable image before `ready` is ever true. Returns null when
 * the draft isn't ready — never a partially-fabricated payload with
 * invented values for the missing fields.
 */
export function mapDraftToEtsyInput(draft: ListingDraft): Record<string, unknown> | null {
  const validation = validateEtsyDraft(draft);
  if (!validation.ready) return null;

  return {
    title: draft.fields.title,
    description: draft.fields.description,
    price: draft.fields.price,
    quantity: draft.fields.quantity,
    sku: draft.fields.sku,
    etsy: {
      whoMade: draft.fields.etsyWhoMade,
      whenMade: draft.fields.etsyWhenMade,
      taxonomyId: draft.fields.etsyTaxonomyId,
    },
  };
}
