import { describe, it, expect } from 'vitest';
import { applyDraftEdit, validateEbayDraft, validateEtsyDraft, mapDraftToEbayInput, mapDraftToEtsyInput, type ListingDraft } from '@/lib/listing/listingDraft';

function baseDraft(overrides: Partial<ListingDraft['fields']> = {}, sourceOverrides: Partial<ListingDraft['source']> = {}): ListingDraft {
  return {
    source: {
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
