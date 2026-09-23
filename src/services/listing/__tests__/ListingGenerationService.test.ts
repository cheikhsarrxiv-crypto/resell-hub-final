import { describe, it, expect } from 'vitest';
import { ListingGenerationService } from '@/services/listing/ListingGenerationService';
import type { NormalizedSourcingResult } from '@/services/sourcing/types';

function baseResult(overrides: Partial<NormalizedSourcingResult> = {}): NormalizedSourcingResult {
  return {
    source: 'ebay',
    sourceId: 'v1|111|0',
    sourceUrl: 'https://www.ebay.co.uk/itm/111',
    title: 'Cut Out Sneakers Black',
    brand: 'Prada',
    price: 380,
    currency: 'GBP',
    marketplace: 'EBAY_GB',
    images: ['https://img.ebay.com/main.jpg'],
    condition: 'USED_EXCELLENT',
    authenticityStatus: 'claimed',
    ...overrides,
  };
}

describe('ListingGenerationService.buildDraftFromSourcingResult — factual data is copied verbatim', () => {
  it('copies every real factual field from the sourcing result unchanged', () => {
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult());

    expect(draft.source.sourceUrl).toBe('https://www.ebay.co.uk/itm/111');
    expect(draft.source.sourceItemId).toBe('https://www.ebay.co.uk/itm/111');
    expect(draft.source.brand).toBe('Prada');
    expect(draft.source.price).toBe(380);
    expect(draft.source.currency).toBe('GBP');
    expect(draft.source.authenticityStatus).toBe('claimed');
    expect(draft.source.images).toEqual(['https://img.ebay.com/main.jpg']);
  });

  it('never invents size/material/color — NormalizedSourcingResult has none, and the draft has no such factual field', () => {
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult());
    expect(draft.fields.size).toBeUndefined();
    expect('material' in draft.fields).toBe(false);
    expect('color' in draft.fields).toBe(false);
  });

  it('condition is copied from the source, never invented when absent', () => {
    const withCondition = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ condition: 'USED_EXCELLENT' }));
    expect(withCondition.fields.condition).toBe('USED_EXCELLENT');

    const withoutCondition = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ condition: undefined }));
    expect(withoutCondition.fields.condition).toBeUndefined();
  });
});

describe('ListingGenerationService — title generation', () => {
  it('reuses the real source title verbatim when the brand is already in it', () => {
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ title: 'Prada Cut Out Sneakers Black', brand: 'Prada' }));
    expect(draft.fields.title).toBe('Prada Cut Out Sneakers Black');
  });

  it('prefixes the brand only when it is not already present in the title', () => {
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ title: 'Cut Out Sneakers Black', brand: 'Prada' }));
    expect(draft.fields.title).toBe('Prada — Cut Out Sneakers Black');
  });

  it('never invents a brand in the title when none is known', () => {
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ brand: undefined }));
    expect(draft.fields.title).not.toContain('undefined');
    expect(draft.fields.title).toBe('Cut Out Sneakers Black');
  });

  it('clamps an overly long title to a safe length, never truncates silently past a sane bound', () => {
    const longTitle = 'x'.repeat(200);
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ title: longTitle, brand: undefined }));
    expect(draft.fields.title.length).toBeLessThanOrEqual(80);
  });
});

describe('ListingGenerationService — description generation', () => {
  it('never mentions defects, certificate, invoice, provenance, materials, purchase date, original store, or accessories — no such data exists to mention', () => {
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult());
    const description = draft.fields.description.toLowerCase();

    for (const forbidden of ['défaut', 'certificat', 'facture', 'provenance', 'matière', "date d'achat", 'boutique', 'accessoire']) {
      expect(description).not.toContain(forbidden);
    }
  });

  it('states authenticity honestly per status — "claimed" is never upgraded to a certainty claim', () => {
    const claimed = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ authenticityStatus: 'claimed' }));
    expect(claimed.fields.description).toContain('vendeur source');
    expect(claimed.fields.description.toLowerCase()).not.toContain('100%');
    expect(claimed.fields.description.toLowerCase()).not.toContain('garanti');

    const unverified = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ authenticityStatus: 'unverified' }));
    expect(unverified.fields.description).toContain('non renseignée');
  });

  it('mentions shipping cost only when the source actually reported one', () => {
    const withShipping = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ shippingCost: 15, shippingCostCurrency: 'GBP' }));
    expect(withShipping.fields.description).toContain('15');

    const withoutShipping = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ shippingCost: undefined }));
    expect(withoutShipping.fields.description).not.toContain('Frais de port');
  });
});

describe('ListingGenerationService — price is a proposal, never invented', () => {
  it('leaves price undefined when no proposedPrice is given — never seeded from the source cost', () => {
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ price: 380 }));
    expect(draft.fields.price).toBeUndefined();
    expect(draft.generatedFieldKeys).not.toContain('price');
  });

  it('sets price only when explicitly proposed, and marks it as generated', () => {
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult(), { proposedPrice: 449, proposedCurrency: 'EUR' });
    expect(draft.fields.price).toBe(449);
    expect(draft.fields.currency).toBe('EUR');
    expect(draft.generatedFieldKeys).toContain('price');
  });

  it('defaults currency to the source currency when no proposedCurrency is given', () => {
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult({ currency: 'GBP' }), { proposedPrice: 449 });
    expect(draft.fields.currency).toBe('GBP');
  });

  it('quantity defaults to 1 (a documented business default for a single sourced item), never invented data', () => {
    const draft = ListingGenerationService.buildDraftFromSourcingResult(baseResult());
    expect(draft.fields.quantity).toBe(1);
  });
});
