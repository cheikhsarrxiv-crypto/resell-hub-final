import { describe, it, expect } from 'vitest';
import {
  applyDraftEdit,
  setImageExcluded,
  usableDraftImages,
  validateEbayDraft,
  validateEtsyDraft,
  mapDraftToEbayInput,
  mapDraftToEtsyInput,
  type ListingDraft,
} from '@/lib/listing/listingDraft';

function baseDraft(overrides: Partial<ListingDraft['fields']> = {}, sourceOverrides: Partial<ListingDraft['source']> = {}): ListingDraft {
  return {
    source: {
      kind: 'sourced',
      sourceItemId: 'https://ebay.example/item/1',
      sourceProductId: 'v1|1|0',
      sourceMarketplace: 'EBAY_GB',
      sourceUrl: 'https://ebay.example/item/1',
      title: 'Prada Cut Out Sneakers Size 42',
      brand: 'Prada',
      condition: 'USED_EXCELLENT',
      images: ['https://img.example/1.jpg'],
      price: 380,
      currency: 'GBP',
      authenticityStatus: 'claimed',
      ...sourceOverrides,
    },
    fields: {
      title: 'Prada Cut Out Sneakers Size 42',
      description: 'A description.',
      price: 449,
      currency: 'EUR',
      quantity: 1,
      condition: 'USED_EXCELLENT',
      ebayCategoryId: 15709,
      ebayMarketplaceId: 'EBAY_FR',
      ...overrides,
    },
    generatedFieldKeys: ['title', 'description', 'currency', 'quantity', 'condition'],
    editedFieldKeys: [],
    originalValues: {},
  };
}

describe('applyDraftEdit', () => {
  it('records the edited field and its original value', () => {
    const draft = baseDraft();
    const edited = applyDraftEdit(draft, { price: 399 });

    expect(edited.fields.price).toBe(399);
    expect(edited.editedFieldKeys).toContain('price');
    expect(edited.originalValues.price).toBe(449);
  });

  it('a second edit to the same field keeps the ORIGINAL value, not the intermediate one', () => {
    const draft = baseDraft();
    const first = applyDraftEdit(draft, { price: 399 });
    const second = applyDraftEdit(first, { price: 350 });

    expect(second.fields.price).toBe(350);
    expect(second.originalValues.price).toBe(449); // still the very first generated value
    expect(second.editedFieldKeys.filter((k) => k === 'price')).toHaveLength(1);
  });

  it('setting a field to its current value is a no-op — never recorded as an edit', () => {
    const draft = baseDraft();
    const edited = applyDraftEdit(draft, { price: 449 });

    expect(edited.editedFieldKeys).toEqual([]);
    expect(edited.originalValues).toEqual({});
  });

  it('undefined values in the patch are ignored, never overwrite the field with undefined', () => {
    const draft = baseDraft();
    const edited = applyDraftEdit(draft, { price: undefined, title: 'New title' });

    expect(edited.fields.price).toBe(449);
    expect(edited.fields.title).toBe('New title');
  });

  it('fields not in the patch stay completely untouched', () => {
    const draft = baseDraft();
    const edited = applyDraftEdit(draft, { price: 399 });

    expect(edited.fields.description).toBe(draft.fields.description);
    expect(edited.fields.condition).toBe(draft.fields.condition);
  });

  it('never mutates the original draft object', () => {
    const draft = baseDraft();
    applyDraftEdit(draft, { price: 399 });

    expect(draft.fields.price).toBe(449);
    expect(draft.editedFieldKeys).toEqual([]);
  });

  it('color/material (AI-first listing workflow) have no source equivalent — absent until an explicit edit sets them', () => {
    const draft = baseDraft();
    expect(draft.fields.color).toBeUndefined();
    expect(draft.fields.material).toBeUndefined();

    const edited = applyDraftEdit(draft, { color: 'Noir', material: 'Coton' });
    expect(edited.fields.color).toBe('Noir');
    expect(edited.fields.material).toBe('Coton');
    expect(edited.editedFieldKeys).toEqual(expect.arrayContaining(['color', 'material']));
  });

  it('model (AI-first listing workflow) has no source equivalent — absent until an explicit edit sets it', () => {
    const draft = baseDraft();
    expect(draft.fields.model).toBeUndefined();

    const edited = applyDraftEdit(draft, { model: 'Air Force 1' });
    expect(edited.fields.model).toBe('Air Force 1');
    expect(edited.editedFieldKeys).toContain('model');
  });
});

describe('setImageExcluded / usableDraftImages (AI-first listing workflow — image exclusion, never deletion)', () => {
  it('excluding an image removes it from usableDraftImages but never from source.images', () => {
    const draft = baseDraft({}, { images: ['https://img.example/1.jpg', 'https://img.example/2.jpg'] });
    const excluded = setImageExcluded(draft, 'https://img.example/1.jpg', true);

    expect(excluded.source.images).toEqual(['https://img.example/1.jpg', 'https://img.example/2.jpg']); // untouched
    expect(usableDraftImages(excluded)).toEqual(['https://img.example/2.jpg']);
  });

  it('re-including a previously excluded image restores it to usableDraftImages', () => {
    const draft = baseDraft({}, { images: ['https://img.example/1.jpg'] });
    const excluded = setImageExcluded(draft, 'https://img.example/1.jpg', true);
    const restored = setImageExcluded(excluded, 'https://img.example/1.jpg', false);

    expect(usableDraftImages(restored)).toEqual(['https://img.example/1.jpg']);
  });

  it('never mutates the original draft object', () => {
    const draft = baseDraft({}, { images: ['https://img.example/1.jpg'] });
    setImageExcluded(draft, 'https://img.example/1.jpg', true);

    expect(draft.excludedImageUrls).toBeUndefined();
  });

  it('usableDraftImages includes generated images not excluded, in source-then-generated order', () => {
    const generatedImage = { url: 'https://x.example/gen.png', provider: 'openai', model: 'dall-e-3', prompt: 'p', generatedAt: 't' };
    const draft = { ...baseDraft({}, { images: ['https://img.example/1.jpg'] }), generatedImages: [generatedImage] };

    expect(usableDraftImages(draft)).toEqual(['https://img.example/1.jpg', generatedImage.url]);
  });
});

describe('validateEbayDraft', () => {
  it('ready=true when title/price/quantity are all present and valid', () => {
    const result = validateEbayDraft(baseDraft());
    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('missing title is a real error, never silently accepted', () => {
    const result = validateEbayDraft(baseDraft({ title: '' }));
    expect(result.ready).toBe(false);
    expect(result.errors.some((e) => /title/i.test(e))).toBe(true);
    expect(result.missingFields).toContain('title');
  });

  it('missing price is a real error — never defaulted to 0 or the source price', () => {
    const result = validateEbayDraft(baseDraft({ price: undefined }));
    expect(result.ready).toBe(false);
    expect(result.errors.some((e) => /proposed selling price/i.test(e))).toBe(true);
    expect(result.missingFields).toContain('price');
  });

  it('a price of 0 or less is a real error', () => {
    const result = validateEbayDraft(baseDraft({ price: 0 }));
    expect(result.ready).toBe(false);
  });

  it('missing/zero quantity is a real error', () => {
    const result = validateEbayDraft(baseDraft({ quantity: 0 }));
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain('quantity');
  });

  it('an "unverified" source produces a distinct warning from "claimed" — never silently upgraded', () => {
    const claimed = validateEbayDraft(baseDraft({}, { authenticityStatus: 'claimed' }));
    const unverified = validateEbayDraft(baseDraft({}, { authenticityStatus: 'unverified' }));
    const verified = validateEbayDraft(baseDraft({}, { authenticityStatus: 'verified' }));

    expect(claimed.warnings.some((w) => /déclarée par le vendeur/i.test(w))).toBe(true);
    expect(unverified.warnings.some((w) => /non vérifiée/i.test(w))).toBe(true);
    expect(verified.warnings.some((w) => /déclarée|non vérifiée/i.test(w))).toBe(false);
  });

  it('missing size is a warning, never a fabricated value', () => {
    const result = validateEbayDraft(baseDraft({ size: undefined }));
    expect(result.warnings.some((w) => /size/i.test(w))).toBe(true);
  });

  it('12C-Prep: missing currency is a real error, never silently defaulted to EUR', () => {
    const result = validateEbayDraft(baseDraft({ currency: undefined as any }));
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain('currency');
  });

  it('12C-Prep: missing condition is a real error, never silently defaulted', () => {
    const result = validateEbayDraft(baseDraft({ condition: undefined }));
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain('condition');
  });

  it('12C-Prep: missing ebayCategoryId is a real error, never guessed', () => {
    const result = validateEbayDraft(baseDraft({ ebayCategoryId: undefined }));
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain('ebayCategoryId');
  });

  it('12C-Prep: missing ebayMarketplaceId is a real error, never assumed from the source item\'s own marketplace', () => {
    const result = validateEbayDraft(baseDraft({ ebayMarketplaceId: undefined }));
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain('ebayMarketplaceId');
  });

  it('12C-Prep: honestly warns that payment/return/fulfillment policies are not managed yet, never silently omitted', () => {
    const result = validateEbayDraft(baseDraft());
    expect(result.warnings.some((w) => /polic/i.test(w))).toBe(true);
  });

  it('Phase 7: warns that source images are external/unreviewed when present — never silently treated as ready-to-use', () => {
    const result = validateEbayDraft(baseDraft());
    expect(result.warnings.some((w) => /external source listing/i.test(w))).toBe(true);
  });

  it('Phase 7: the "no source images" warning and the "external/unreviewed" warning are mutually exclusive', () => {
    const withImages = validateEbayDraft(baseDraft());
    const withoutImages = validateEbayDraft(baseDraft({}, { images: [] }));

    expect(withImages.warnings.some((w) => /no source images available/i.test(w))).toBe(false);
    expect(withoutImages.warnings.some((w) => /external source listing/i.test(w))).toBe(false);
    expect(withoutImages.warnings.some((w) => /no source images available/i.test(w))).toBe(true);
  });

  it('AI-first listing workflow: warns distinctly when every available image has been excluded', () => {
    const draft = setImageExcluded(baseDraft({}, { images: ['https://img.example/1.jpg'] }), 'https://img.example/1.jpg', true);
    const result = validateEbayDraft(draft);

    expect(result.warnings.some((w) => /all available images have been excluded/i.test(w))).toBe(true);
    expect(result.warnings.some((w) => /external source listing/i.test(w))).toBe(false);
  });
});

describe('mapDraftToEbayInput (Phase 12C-Prep — preview must match reality)', () => {
  it('returns null (never a partial/fabricated payload) when the draft is not ready', () => {
    const draft = baseDraft({ ebayCategoryId: undefined });
    expect(mapDraftToEbayInput(draft)).toBeNull();
  });

  it('when ready, returns exactly the fields EbayAdapter.createListing needs, with no invented values', () => {
    const draft = baseDraft();
    const input = mapDraftToEbayInput(draft) as any;

    expect(input).not.toBeNull();
    expect(input.title).toBe(draft.fields.title);
    expect(input.price).toBe(draft.fields.price);
    expect(input.currency).toBe(draft.fields.currency);
    expect(input.condition).toBe(draft.fields.condition);
    expect(input.images).toEqual(draft.source.images);
    expect(input.ebay).toEqual({ categoryId: draft.fields.ebayCategoryId, marketplaceId: draft.fields.ebayMarketplaceId });
  });

  it('AI-first listing workflow: appends AI-generated images after real source images, never before/instead', () => {
    const generatedImage = { url: 'https://oaidalleapi.example/img1.png', provider: 'openai', model: 'dall-e-3', prompt: 'x', generatedAt: '2026-01-01T00:00:00.000Z' };
    const draft = { ...baseDraft(), generatedImages: [generatedImage] };
    const input = mapDraftToEbayInput(draft) as any;

    expect(input.images).toEqual([...draft.source.images, generatedImage.url]);
  });

  it('AI-first listing workflow: an excluded image is left out of the real eBay payload, and source.images stays untouched', () => {
    const draft = baseDraft({}, { images: ['https://img.example/1.jpg', 'https://img.example/2.jpg'] });
    const withExclusion = setImageExcluded(draft, 'https://img.example/1.jpg', true);
    const input = mapDraftToEbayInput(withExclusion) as any;

    expect(input.images).toEqual(['https://img.example/2.jpg']);
    expect(withExclusion.source.images).toEqual(['https://img.example/1.jpg', 'https://img.example/2.jpg']);
  });
});

describe('validateEtsyDraft', () => {
  it('is NEVER ready without an explicit etsyTaxonomyId, etsyWhenMade and etsyWhoMade — never guessed', () => {
    const result = validateEtsyDraft(baseDraft());
    expect(result.ready).toBe(false);
    expect(result.errors.some((e) => /taxonomy/i.test(e))).toBe(true);
    expect(result.errors.some((e) => /when made/i.test(e))).toBe(true);
    expect(result.errors.some((e) => /who made/i.test(e))).toBe(true);
    expect(result.missingFields).toEqual(expect.arrayContaining(['etsyTaxonomyId', 'etsyWhenMade', 'etsyWhoMade']));
  });

  it('is ready once title/description/price/quantity/taxonomyId/whenMade/whoMade are all present', () => {
    const draft = baseDraft({ etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' });
    const result = validateEtsyDraft(draft);
    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('missing description is a real error for Etsy (unlike eBay, which does not require it)', () => {
    const draft = baseDraft({ description: '', etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' });
    const result = validateEtsyDraft(draft);
    expect(result.ready).toBe(false);
    expect(result.errors.some((e) => /description/i.test(e))).toBe(true);
  });

  it('missing etsyTaxonomyId alone is a real error, even when whoMade/whenMade are present', () => {
    const draft = baseDraft({ etsyTaxonomyId: undefined, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' });
    const result = validateEtsyDraft(draft);
    expect(result.ready).toBe(false);
    expect(result.missingFields).toEqual(['etsyTaxonomyId']);
  });

  it('missing etsyWhoMade alone is a real error, even when taxonomyId/whenMade are present', () => {
    const draft = baseDraft({ etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: undefined });
    const result = validateEtsyDraft(draft);
    expect(result.ready).toBe(false);
    expect(result.missingFields).toEqual(['etsyWhoMade']);
  });

  it('missing etsyWhenMade alone is a real error, even when taxonomyId/whoMade are present', () => {
    const draft = baseDraft({ etsyTaxonomyId: 1234, etsyWhenMade: undefined, etsyWhoMade: 'i_did' });
    const result = validateEtsyDraft(draft);
    expect(result.ready).toBe(false);
    expect(result.missingFields).toEqual(['etsyWhenMade']);
  });

  it('Etsy images fix: zero usable images is a real, blocking error — never allowed to publish photo-less', () => {
    const draft = baseDraft({ etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' }, { images: [] });
    const result = validateEtsyDraft(draft);
    expect(result.ready).toBe(false);
    expect(result.errors.some((e) => /image/i.test(e))).toBe(true);
    expect(result.missingFields).toContain('images');
  });

  it('Etsy images fix: every source image excluded also blocks readiness, even though source.images is non-empty', () => {
    const draft = setImageExcluded(
      baseDraft({ etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' }, { images: ['https://img.example/1.jpg'] }),
      'https://img.example/1.jpg',
      true
    );
    const result = validateEtsyDraft(draft);
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain('images');
  });

  it('Etsy images fix: a generated image alone (no source image) satisfies the requirement', () => {
    const generatedImage = { url: 'https://x.example/gen.png', provider: 'openai', model: 'dall-e-3', prompt: 'p', generatedAt: 't' };
    const draft = {
      ...baseDraft({ etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' }, { images: [] }),
      generatedImages: [generatedImage],
    };
    const result = validateEtsyDraft(draft);
    expect(result.ready).toBe(true);
    expect(result.missingFields).not.toContain('images');
  });
});

describe('mapDraftToEtsyInput', () => {
  it('returns null (never a partial/fabricated payload) when the draft is not ready', () => {
    const draft = baseDraft({ etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025' }); // whoMade still missing
    expect(mapDraftToEtsyInput(draft)).toBeNull();
  });

  it('when ready, returns exactly the fields EtsyAdapter.createListing needs, with no invented values and no eBay-only/unused fields', () => {
    const draft = baseDraft({ etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' });
    const input = mapDraftToEtsyInput(draft) as any;

    expect(input).not.toBeNull();
    expect(input.title).toBe(draft.fields.title);
    expect(input.description).toBe(draft.fields.description);
    expect(input.price).toBe(draft.fields.price);
    expect(input.quantity).toBe(draft.fields.quantity);
    expect(input.etsy).toEqual({ whoMade: 'i_did', whenMade: '2020_2025', taxonomyId: 1234 });
    // EtsyAdapter.createListing never reads currency/condition/images/category — never included here.
    expect(input).not.toHaveProperty('currency');
    expect(input).not.toHaveProperty('condition');
    expect(input).not.toHaveProperty('images');
    expect(input).not.toHaveProperty('ebay');
  });
});

/**
 * Free listing creation (real photo analysis) — a 'free' draft has no
 * external source at all (no sourceUrl/price/currency/authenticityStatus
 * — see ListingDraftSource's own `kind` field). These prove the
 * validators/mappers behave sensibly for that shape too, never crashing
 * or emitting a confusing "unverified by the source" warning for an item
 * that was never sourced anywhere.
 */
function freeDraft(overrides: Partial<ListingDraft['fields']> = {}, sourceOverrides: Partial<ListingDraft['source']> = {}): ListingDraft {
  return {
    source: {
      kind: 'free',
      sourceItemId: 'free-test-draft-1',
      title: 'Sac à main vintage',
      images: [],
      ...sourceOverrides,
    },
    fields: {
      title: 'Sac à main vintage',
      description: 'A description.',
      currency: 'EUR',
      quantity: 1,
      ebayCategoryId: 15709,
      ebayMarketplaceId: 'EBAY_FR',
      ...overrides,
    },
    generatedFieldKeys: ['title', 'description', 'currency', 'quantity'],
    editedFieldKeys: [],
    originalValues: {},
  };
}

describe('free-mode drafts (kind: "free") — no external source at all', () => {
  it('validateEbayDraft never emits an authenticity/source-verification warning for a free draft', () => {
    const result = validateEbayDraft(freeDraft({ price: 89 }));
    expect(result.warnings.join(' ')).not.toMatch(/authenticité|vérifiée par la source|WEB_LEAD/i);
  });

  it('validateEtsyDraft never emits an authenticity/source-verification warning for a free draft either', () => {
    const result = validateEtsyDraft(freeDraft({ price: 89, etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' }));
    expect(result.warnings.join(' ')).not.toMatch(/authenticité|vérifiée par la source|WEB_LEAD/i);
  });

  it('a free draft missing price/quantity/category is still reported NOT ready, with the same real missingFields as a sourced draft', () => {
    const result = validateEbayDraft(freeDraft({ price: undefined, ebayCategoryId: undefined }));
    expect(result.ready).toBe(false);
    expect(result.missingFields).toContain('price');
    expect(result.missingFields).toContain('ebayCategoryId');
  });

  it('a fully-filled free draft is ready for eBay, exactly like a sourced one', () => {
    const result = validateEbayDraft(freeDraft({ price: 89, condition: 'bon état' }));
    expect(result.ready).toBe(true);
  });

  it('mapDraftToEbayInput works identically for a free draft once ready — same shape, no sourceUrl needed anywhere in it', () => {
    const draft = freeDraft({ price: 89, condition: 'bon état' });
    const input = mapDraftToEbayInput(draft) as any;
    expect(input).not.toBeNull();
    expect(input.title).toBe(draft.fields.title);
    expect(input.ebay).toEqual({ categoryId: 15709, marketplaceId: 'EBAY_FR' });
  });

  it('applyDraftEdit works identically on a free draft (no sourceUrl dependency anywhere in the pure edit logic)', () => {
    const edited = applyDraftEdit(freeDraft(), { price: 120, color: 'Noir' });
    expect(edited.fields.price).toBe(120);
    expect(edited.fields.color).toBe('Noir');
    expect(edited.source.kind).toBe('free');
  });

  /**
   * P1-2 fix (final review finding) — a free draft's photos are the
   * reseller's OWN uploads, hosted by ADKSY (StorageService.
   * uploadConversationImage), never "copied from an external source
   * listing". The pre-fix code emitted the SOURCED warning unconditionally
   * for any draft with usable images, which was factually false for a free
   * draft. These assertions check the EXACT warning string each mode gets
   * — not just "no mention of X" — so a regression that reintroduces the
   * wrong string for the wrong mode cannot silently pass.
   */
  it('P1-2: a free draft with real uploaded photos gets the "uploaded by the seller, hosted by ADKSY" warning, NEVER the sourced "external source listing" one', () => {
    const result = validateEbayDraft(freeDraft({ price: 89, condition: 'bon état' }, { images: ['https://supabase.example/ws-1/_draft-uploads/conv-1/photo1.jpg'] }));
    expect(result.warnings).toContain('Photos uploaded by the seller, hosted by ADKSY. Confirm the seller holds the rights to use these photos before publishing.');
    expect(result.warnings).not.toContain('Images are copied directly from the external source listing — not reviewed or re-hosted by ADKSY. Verify you have the right to use them before publishing.');
  });

  it('P1-2: a SOURCED draft with real images still gets the EXACT pre-existing "external source listing" warning, unchanged — no regression', () => {
    const result = validateEbayDraft(baseDraft());
    expect(result.warnings).toContain('Images are copied directly from the external source listing — not reviewed or re-hosted by ADKSY. Verify you have the right to use them before publishing.');
    expect(result.warnings).not.toContain('Photos uploaded by the seller, hosted by ADKSY. Confirm the seller holds the rights to use these photos before publishing.');
  });

  it('P1-2: a free draft with NO photo at all gets a free-mode-worded "no photo" warning, never "No source images available"', () => {
    const result = validateEbayDraft(freeDraft({ price: 89, condition: 'bon état' }, { images: [] }));
    expect(result.warnings).toContain('No photo available for this listing.');
    expect(result.warnings).not.toContain('No source images available.');
  });

  it('P1-2: a SOURCED draft with no images still gets the exact pre-existing "No source images available." warning, unchanged', () => {
    const result = validateEbayDraft(baseDraft({}, { images: [] }));
    expect(result.warnings).toContain('No source images available.');
  });

  it('P2-1: a free draft with no size gets free-mode wording, never "the source did not report one"', () => {
    const result = validateEbayDraft(freeDraft({ price: 89, condition: 'bon état', size: undefined }));
    expect(result.warnings).toContain('No size set — add it manually if relevant.');
    expect(result.warnings).not.toContain('No size set — the source did not report one; add it manually if relevant.');
  });

  it('P2-1: a SOURCED draft with no size still gets the exact pre-existing wording, unchanged', () => {
    const result = validateEbayDraft(baseDraft({ size: undefined }));
    expect(result.warnings).toContain('No size set — the source did not report one; add it manually if relevant.');
  });
});
