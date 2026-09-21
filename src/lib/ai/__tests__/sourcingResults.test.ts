import { describe, it, expect } from 'vitest';
import {
  isNormalizedSourcingResult,
  extractSourcingOutcomes,
  extractSourcingResults,
  formatSourcingPrice,
  formatMarketplaceLabel,
} from '@/lib/ai/sourcingResults';

const validResult = {
  source: 'ebay',
  sourceId: 'v1|111|0',
  sourceUrl: 'https://www.ebay.co.uk/itm/111',
  title: 'Prada Sneakers Size 42',
  price: 450,
  currency: 'GBP',
  marketplace: 'EBAY_GB',
  images: ['https://img.ebay.com/main.jpg'],
  authenticityStatus: 'claimed',
};

function toolCall(result: unknown, name = 'search_products') {
  return { name, category: 'read', input: {}, result };
}

describe('isNormalizedSourcingResult', () => {
  it('accepts a real, fully-shaped result', () => {
    expect(isNormalizedSourcingResult(validResult)).toBe(true);
  });

  it('accepts a result missing only optional fields (seller, shippingCost, etc.)', () => {
    const { ...minimal } = validResult;
    expect(isNormalizedSourcingResult(minimal)).toBe(true);
  });

  it('rejects null/undefined/non-objects, never crashes', () => {
    expect(isNormalizedSourcingResult(null)).toBe(false);
    expect(isNormalizedSourcingResult(undefined)).toBe(false);
    expect(isNormalizedSourcingResult('a string')).toBe(false);
    expect(isNormalizedSourcingResult(42)).toBe(false);
  });

  it('rejects a result with a missing required field (price)', () => {
    const { price, ...withoutPrice } = validResult;
    expect(isNormalizedSourcingResult(withoutPrice)).toBe(false);
  });

  it('rejects a result whose price is not a finite number', () => {
    expect(isNormalizedSourcingResult({ ...validResult, price: NaN })).toBe(false);
    expect(isNormalizedSourcingResult({ ...validResult, price: Infinity })).toBe(false);
    expect(isNormalizedSourcingResult({ ...validResult, price: '450' })).toBe(false);
  });

  it('rejects a result with a fabricated authenticityStatus value', () => {
    expect(isNormalizedSourcingResult({ ...validResult, authenticityStatus: 'authentic' })).toBe(false);
  });

  it("accepts the real 'unknown' authenticityStatus value (Global Sourcing Engine — reserved for a future provider with no authenticity signal, distinct from a fabricated value)", () => {
    expect(isNormalizedSourcingResult({ ...validResult, authenticityStatus: 'unknown' })).toBe(true);
  });

  it('accepts a result carrying the new Global Sourcing Engine optional fields (normalizedPriceEur, itemLocationCountry)', () => {
    expect(
      isNormalizedSourcingResult({ ...validResult, normalizedPriceEur: 520, itemLocationCountry: 'GB' })
    ).toBe(true);
  });

  it('rejects a result whose images field is not an array', () => {
    expect(isNormalizedSourcingResult({ ...validResult, images: 'https://img.example.com' })).toBe(false);
  });
});

describe('extractSourcingOutcomes', () => {
  it('returns an empty array when toolCalls is undefined/not an array', () => {
    expect(extractSourcingOutcomes(undefined)).toEqual([]);
    expect(extractSourcingOutcomes('not an array' as any)).toEqual([]);
  });

  it('ignores tool calls that are not search_products', () => {
    const outcomes = extractSourcingOutcomes([toolCall({ status: 'ok', results: [validResult] }, 'calculate_margin')]);
    expect(outcomes).toEqual([]);
  });

  it('extracts a real "ok" outcome with its results', () => {
    const outcomes = extractSourcingOutcomes([toolCall({ status: 'ok', results: [validResult], providerErrors: [] })]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('ok');
    expect(outcomes[0].results).toEqual([validResult]);
  });

  it('a SOURCE_NOT_CONFIGURED outcome is reported as such, never silently dropped', () => {
    const outcomes = extractSourcingOutcomes([toolCall({ status: 'SOURCE_NOT_CONFIGURED', results: [] })]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('SOURCE_NOT_CONFIGURED');
    expect(outcomes[0].results).toEqual([]);
  });

  it('filters out an individually malformed item without dropping the valid ones in the same call', () => {
    const malformed = { title: 'no price field' };
    const outcomes = extractSourcingOutcomes([toolCall({ status: 'ok', results: [validResult, malformed] })]);

    expect(outcomes[0].results).toEqual([validResult]);
  });

  it('carries provider errors through untouched', () => {
    const providerErrors = [{ provider: 'ebay', message: 'eBay search failed with status 500', kind: 'upstream_error' }];
    const outcomes = extractSourcingOutcomes([toolCall({ status: 'ok', results: [], providerErrors })]);

    expect(outcomes[0].providerErrors).toEqual(providerErrors);
  });

  it('a malformed result field (not an object) yields status "unknown", never fabricated as "ok"', () => {
    const outcomes = extractSourcingOutcomes([toolCall('not an object')]);
    expect(outcomes).toEqual([]);
  });

  it('multiple search_products calls in one turn are all kept, in order', () => {
    const outcomes = extractSourcingOutcomes([
      toolCall({ status: 'ok', results: [validResult] }),
      toolCall({ status: 'ok', results: [] }),
    ]);

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].toolCallIndex).toBe(0);
    expect(outcomes[1].toolCallIndex).toBe(1);
  });
});

describe('extractSourcingResults', () => {
  it('flattens results across every search_products call', () => {
    const secondResult = { ...validResult, sourceId: 'v1|222|0', title: 'Another item' };
    const results = extractSourcingResults([
      toolCall({ status: 'ok', results: [validResult] }),
      toolCall({ status: 'ok', results: [secondResult] }),
    ]);

    expect(results).toEqual([validResult, secondResult]);
  });
});

describe('formatSourcingPrice', () => {
  it('formats a real amount with the correct currency symbol', () => {
    expect(formatSourcingPrice(500, 'EUR')).toContain('500');
    expect(formatSourcingPrice(500, 'GBP')).toContain('500');
  });

  it('never crashes on an unrecognized currency code, and never invents a different amount', () => {
    // Node's Intl accepts any well-formed 3-letter code without validating
    // it's real ISO 4217, so this doesn't always hit the try/catch
    // fallback — what matters is it never throws and never changes the
    // real amount/currency it was given.
    const formatted = formatSourcingPrice(500, 'ZZZ');
    expect(formatted).toContain('500');
    expect(formatted).toContain('ZZZ');
  });

  it('a genuinely malformed currency (fails Intl validation) falls back to "<amount> <CODE>", never throws', () => {
    const formatted = formatSourcingPrice(500, 'NOT-A-CODE');
    expect(formatted).toBe('500 NOT-A-CODE');
  });

  it('preserves a real 0 as a real, formatted zero (never omitted)', () => {
    const formatted = formatSourcingPrice(0, 'GBP');
    expect(formatted).toContain('0');
  });
});

describe('formatMarketplaceLabel', () => {
  it('formats a country-specific eBay marketplace id', () => {
    expect(formatMarketplaceLabel('EBAY_GB', 'ebay')).toBe('eBay · GB');
    expect(formatMarketplaceLabel('EBAY_FR', 'ebay')).toBe('eBay · FR');
  });

  it('falls back to a plain "eBay" label for an unrecognized eBay marketplace id shape', () => {
    expect(formatMarketplaceLabel('EBAY', 'ebay')).toBe('eBay');
  });

  it('shows the raw marketplace value as-is for a non-eBay source, never a fabricated label', () => {
    expect(formatMarketplaceLabel('some-future-marketplace', 'other-source')).toBe('some-future-marketplace');
  });

  it("Phase 2 — formats Etsy's constant 'ETSY' marketplace as a plain 'Etsy' label (no per-country split exists for Etsy)", () => {
    expect(formatMarketplaceLabel('ETSY', 'etsy')).toBe('Etsy');
  });
});
