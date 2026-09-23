import { describe, it, expect } from 'vitest';
import { extractListingDraftOutcomes } from '@/lib/ai/listingDraftResults';
import type { ListingDraft } from '@/lib/listing/listingDraft';

function validDraft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    source: {
      sourceItemId: 'https://ebay.example/item/1',
      sourceMarketplace: 'EBAY_GB',
      sourceUrl: 'https://ebay.example/item/1',
      title: 'Prada Cut Out Sneakers',
      brand: 'Prada',
      images: ['https://img.example/1.jpg'],
      price: 380,
      currency: 'GBP',
      authenticityStatus: 'claimed',
    },
    fields: {
      title: 'Prada Cut Out Sneakers',
      description: 'desc',
      price: 449,
      currency: 'EUR',
      quantity: 1,
    },
    generatedFieldKeys: ['title', 'description'],
    editedFieldKeys: [],
    originalValues: {},
    ...overrides,
  };
}

function toolCall(name: string, result: unknown) {
  return { name, category: 'write', input: {}, result };
}

describe('extractListingDraftOutcomes', () => {
  it('returns [] when toolCalls is undefined', () => {
    expect(extractListingDraftOutcomes(undefined)).toEqual([]);
  });

  it('ignores tool calls that are not generate/edit_listing_draft', () => {
    const outcomes = extractListingDraftOutcomes([toolCall('search_products', { results: [] })]);
    expect(outcomes).toEqual([]);
  });

  it('extracts a real "ok" draft with its marketplace validation', () => {
    const draft = validDraft();
    const marketplaceValidation = {
      ebay: { marketplace: 'ebay', ready: true, errors: [], warnings: [], missingFields: [] },
      etsy: { marketplace: 'etsy', ready: false, errors: ['x'], warnings: [], missingFields: ['etsyTaxonomyId'] },
    };
    const outcomes = extractListingDraftOutcomes([toolCall('generate_listing_draft', { draft, marketplaceValidation })]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('ok');
    expect(outcomes[0].draft).toEqual(draft);
    expect(outcomes[0].marketplaceValidation?.ebay.ready).toBe(true);
    expect(outcomes[0].marketplaceValidation?.etsy.ready).toBe(false);
  });

  it('extracts an "error" outcome (e.g. sourceUrl not found in this conversation) without a draft', () => {
    const outcomes = extractListingDraftOutcomes([
      toolCall('generate_listing_draft', { error: "This product was not found among this conversation's own search results." }),
    ]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('error');
    expect(outcomes[0].draft).toBeUndefined();
  });

  it('a malformed draft shape (missing required fields) is silently excluded, never fabricated into a fake draft', () => {
    const outcomes = extractListingDraftOutcomes([toolCall('generate_listing_draft', { draft: { totally: 'broken' } })]);
    expect(outcomes).toEqual([]);
  });

  it('recognizes edit_listing_draft the same way as generate_listing_draft', () => {
    const draft = validDraft();
    const marketplaceValidation = {
      ebay: { marketplace: 'ebay', ready: true, errors: [], warnings: [], missingFields: [] },
      etsy: { marketplace: 'etsy', ready: true, errors: [], warnings: [], missingFields: [] },
    };
    const outcomes = extractListingDraftOutcomes([toolCall('edit_listing_draft', { draft, marketplaceValidation })]);
    expect(outcomes).toHaveLength(1);
  });

  it('preserves toolCallIndex for correct ordering/association', () => {
    const draft = validDraft();
    const marketplaceValidation = {
      ebay: { marketplace: 'ebay', ready: true, errors: [], warnings: [], missingFields: [] },
      etsy: { marketplace: 'etsy', ready: true, errors: [], warnings: [], missingFields: [] },
    };
    const outcomes = extractListingDraftOutcomes([
      toolCall('search_products', { results: [] }),
      toolCall('generate_listing_draft', { draft, marketplaceValidation }),
    ]);
    expect(outcomes[0].toolCallIndex).toBe(1);
  });
});
