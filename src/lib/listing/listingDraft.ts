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

export type AuthenticityStatus = 'verified' | 'claimed' | 'unverified';

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
}

/**
 * The editable draft fields a reseller can see and change. `price` is
 * deliberately optional — a proposed SELLING price must never be silently
 * defaulted to the source's cost (that would misrepresent a cost as a
 * revenue proposal) or to 0; until a real proposal exists, it's simply
 * absent, and the validator reports it as a genuine missing field.
 * `size`/`material`/`color` have no source equivalent at all today (see
 * NormalizedSourcingResult — the sourcing layer doesn't provide them), so
 * they can ONLY ever come from an explicit user edit, never generation.
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

export interface ListingDraft {
  source: ListingDraftSource;
  fields: ListingDraftFields;
  /** Which of `fields`' keys ListingGenerationService auto-populated at creation — never includes a field the user later overrides (see editedFieldKeys). */
  generatedFieldKeys: ListingDraftFieldKey[];
  /** Which of `fields`' keys the user has since edited, overriding whatever ListingGenerationService originally proposed. */
  editedFieldKeys: ListingDraftFieldKey[];
  /** The pre-edit value for every key in editedFieldKeys — so an edit is never a silent, unrecoverable overwrite of what was originally proposed. */
  originalValues: Partial<ListingDraftFields>;
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

  if (!draft.fields.size) {
    warnings.push('No size set — the source did not report one; add it manually if relevant.');
  }
  if (draft.source.images.length === 0) {
    warnings.push('No source images available.');
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
    images: draft.source.images,
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

  const authWarning = authenticityWarning(draft.source);
  if (authWarning) warnings.push(authWarning);

  return { marketplace: 'etsy', ready: errors.length === 0, errors, warnings, missingFields };
}

/**
 * The Etsy equivalent of mapDraftToEbayInput above — the single source of
 * truth for "what would actually be sent to Etsy": builds the real
 * MarketplaceListingInput object EtsyAdapter.createListing expects, from
 * this exact draft. Deliberately a different shape than the eBay mapper —
 * EtsyAdapter.createListing never reads currency/condition/images/category
 * at all (see that adapter's own createListing body: only
 * quantity/title/description/price/who_made/when_made/taxonomy_id/sku),
 * so none of those are included here. Returns null when the draft isn't
 * ready — never a partially-fabricated payload with invented values for
 * the missing fields.
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
