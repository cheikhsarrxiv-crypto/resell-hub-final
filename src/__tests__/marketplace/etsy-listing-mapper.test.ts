/**
 * EtsyListingMapper — derives who_made/when_made/taxonomy_id from real
 * Product data instead of the hardcoded placeholders EtsyAdapter used to
 * ship (taxonomy_id: 1, when_made: 'made_to_order'). See
 * EtsyListingMapper.ts for the verified source of the when_made enum and
 * why it's a direct seller-chosen bucket rather than a year the mapper
 * would have to convert.
 */
import { describe, it, expect } from 'vitest';
import {
  ETSY_WHO_MADE,
  ETSY_WHEN_MADE_OPTIONS,
  isValidEtsyWhenMade,
  buildEtsyListingRequirements,
} from '@/services/marketplace/EtsyListingMapper';

describe('ETSY_WHO_MADE', () => {
  it('is the fixed, documented reseller value (never i_did or collective)', () => {
    expect(ETSY_WHO_MADE).toBe('someone_else');
  });
});

describe('ETSY_WHEN_MADE_OPTIONS', () => {
  it('matches the exact enum verified against Etsy\'s real createDraftListing request schema', () => {
    const values = ETSY_WHEN_MADE_OPTIONS.map((o) => o.value);
    expect(values).toEqual([
      'made_to_order',
      '2020_2025',
      '2010_2019',
      '2006_2009',
      '2000_2005',
      'before_2006',
      '1990s',
      '1980s',
      '1970s',
      '1960s',
      '1950s',
      '1940s',
      '1930s',
      '1920s',
      '1910s',
      '1900s',
      '1800s',
      '1700s',
      'before_1700',
    ]);
  });

  it('every option has a non-empty human-readable label', () => {
    for (const option of ETSY_WHEN_MADE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});

describe('isValidEtsyWhenMade', () => {
  it('accepts every value from the verified enum', () => {
    for (const option of ETSY_WHEN_MADE_OPTIONS) {
      expect(isValidEtsyWhenMade(option.value)).toBe(true);
    }
  });

  it('rejects a value not in the verified enum (e.g. a guessed future bucket)', () => {
    expect(isValidEtsyWhenMade('2026_2030')).toBe(false);
    expect(isValidEtsyWhenMade('')).toBe(false);
    expect(isValidEtsyWhenMade('unknown')).toBe(false);
  });
});

describe('buildEtsyListingRequirements', () => {
  it('builds the full requirements object when both fields are present', () => {
    const result = buildEtsyListingRequirements({ etsyTaxonomyId: 1429, etsyWhenMade: '2020_2025' });
    expect(result).toEqual({
      taxonomyId: 1429,
      whenMade: '2020_2025',
      whoMade: 'someone_else',
    });
  });

  it('throws a specific error when etsyTaxonomyId is missing (never falls back to a generic ID)', () => {
    expect(() => buildEtsyListingRequirements({ etsyTaxonomyId: null, etsyWhenMade: '2020_2025' })).toThrow(
      /no Etsy category/i
    );
    expect(() => buildEtsyListingRequirements({ etsyTaxonomyId: undefined, etsyWhenMade: '2020_2025' })).toThrow(
      /no Etsy category/i
    );
  });

  it('never returns taxonomyId: 1 as an implicit default', () => {
    // Regression guard for the exact bug this change fixes.
    expect(() => buildEtsyListingRequirements({ etsyTaxonomyId: null, etsyWhenMade: '2020_2025' })).toThrow();
  });

  it('throws a specific error when etsyWhenMade is missing — never invents a value', () => {
    expect(() => buildEtsyListingRequirements({ etsyTaxonomyId: 1429, etsyWhenMade: null })).toThrow(
      /no Etsy "when made" era/i
    );
    expect(() => buildEtsyListingRequirements({ etsyTaxonomyId: 1429, etsyWhenMade: undefined })).toThrow(
      /no Etsy "when made" era/i
    );
  });

  it('never defaults to made_to_order when etsyWhenMade is missing', () => {
    // Regression guard for the exact bug this change fixes.
    expect(() => buildEtsyListingRequirements({ etsyTaxonomyId: 1429, etsyWhenMade: null })).toThrow();
  });

  it('throws when etsyWhenMade holds a value outside the verified enum', () => {
    expect(() =>
      buildEtsyListingRequirements({ etsyTaxonomyId: 1429, etsyWhenMade: '2026_2030' })
    ).toThrow(/not a value Etsy's when_made currently accepts/i);
  });

  it('accepts every value from the verified enum without modification', () => {
    for (const option of ETSY_WHEN_MADE_OPTIONS) {
      const result = buildEtsyListingRequirements({ etsyTaxonomyId: 1, etsyWhenMade: option.value });
      expect(result.whenMade).toBe(option.value);
    }
  });
});
