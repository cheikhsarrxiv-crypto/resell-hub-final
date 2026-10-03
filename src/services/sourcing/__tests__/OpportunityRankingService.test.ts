/**
 * Real behavioral tests for OpportunityRankingService — the transparent
 * matchReasons/warnings annotator and the deterministic 'match' sort
 * comparator. Pure functions, no mocking needed.
 */
import { describe, it, expect } from 'vitest';
import { annotateResult, compareByMatch, classifyResultQuality, computeOpportunityScore, detectPriceConflict } from '@/services/sourcing/OpportunityRankingService';
import { NormalizedSourcingResult, NormalizedSearchQuery } from '@/services/sourcing/types';

function makeResult(overrides: Partial<NormalizedSourcingResult> = {}): NormalizedSourcingResult {
  return {
    source: 'ebay',
    sourceUrl: 'https://x',
    title: 'Prada Cut Out Sneakers',
    price: 350,
    currency: 'EUR',
    marketplace: 'EBAY_FR',
    images: [],
    authenticityStatus: 'claimed',
    normalizedPriceEur: 350,
    ...overrides,
  };
}

const noBounds = { requested: false, unresolvable: false };

describe('annotateResult — matchReasons', () => {
  it('adds a price matchReason when within the requested [minPrice,maxPrice] EUR range', () => {
    const result = makeResult({ normalizedPriceEur: 300 });
    const { matchReasons, excludedByPrice } = annotateResult(result, { query: 'x' }, { requested: true, unresolvable: false, maxEur: 400 });
    expect(excludedByPrice).toBe(false);
    expect(matchReasons.some((r) => r.includes('Within the requested price range'))).toBe(true);
  });

  it('excludes (never warns) a result confidently outside the requested range', () => {
    const result = makeResult({ normalizedPriceEur: 500 });
    const { excludedByPrice } = annotateResult(result, { query: 'x' }, { requested: true, unresolvable: false, maxEur: 400 });
    expect(excludedByPrice).toBe(true);
  });

  it('respects both minEur and maxEur together', () => {
    const tooLow = makeResult({ normalizedPriceEur: 50 });
    const { excludedByPrice } = annotateResult(tooLow, { query: 'x' }, { requested: true, unresolvable: false, minEur: 100, maxEur: 400 });
    expect(excludedByPrice).toBe(true);
  });

  it('Deep Web Sourcing Engine fix: a result is EXCLUDED (never kept "just in case") when the price bound itself is unresolvable — an unreliable comparison is never presented as having passed the filter', () => {
    const result = makeResult({ normalizedPriceEur: 9999 }); // would be "outside" if compared, but bounds themselves are unresolvable
    const { excludedByPrice, warnings } = annotateResult(result, { query: 'x' }, { requested: true, unresolvable: true });
    expect(excludedByPrice).toBe(true);
    expect(warnings.some((w) => /uncertain/i.test(w))).toBe(true);
  });

  it("Deep Web Sourcing Engine fix: a result whose OWN normalizedPriceEur is undefined is EXCLUDED, even with resolvable bounds — never shown as if it were within a price cap it could not actually be compared against", () => {
    const result = makeResult({ normalizedPriceEur: undefined, currency: 'JPY' });
    const { excludedByPrice, warnings } = annotateResult(result, { query: 'x' }, { requested: true, unresolvable: false, maxEur: 400 });
    expect(excludedByPrice).toBe(true);
    expect(warnings.some((w) => /uncertain/i.test(w))).toBe(true);
  });

  it('no price bound requested -> no price-related matchReason/warning at all', () => {
    const result = makeResult();
    const { matchReasons, warnings, excludedByPrice } = annotateResult(result, { query: 'x' }, noBounds);
    expect(excludedByPrice).toBe(false);
    expect(matchReasons.some((r) => /price/i.test(r))).toBe(false);
    expect(warnings.some((w) => /price/i.test(w))).toBe(false);
  });

  it('adds a brand matchReason only when the brand literally appears in the title, never fabricated', () => {
    const result = makeResult({ title: 'Prada Cut Out Sneakers' });
    const { matchReasons } = annotateResult(result, { query: 'x', brand: 'Prada' }, noBounds);
    expect(matchReasons.some((r) => r.includes('Prada'))).toBe(true);

    const noMatch = annotateResult(makeResult({ title: 'Nike Dunk' }), { query: 'x', brand: 'Prada' }, noBounds);
    expect(noMatch.matchReasons.some((r) => r.includes('Prada'))).toBe(false);
  });

  it('adds a model matchReason only when the model literally appears in the title', () => {
    const { matchReasons } = annotateResult(makeResult({ title: 'Prada Cut Out Sneakers' }), { query: 'x', model: 'Cut' }, noBounds);
    expect(matchReasons.some((r) => r.includes('"Cut"'))).toBe(true);
  });

  it('adds a condition matchReason via a soft substring check, never an invented mapping', () => {
    const { matchReasons } = annotateResult(makeResult({ condition: 'USED_EXCELLENT' }), { query: 'x', condition: 'used' }, noBounds);
    expect(matchReasons.some((r) => r.includes('used'))).toBe(true);
  });

  it('worldwide requested -> matchReason present', () => {
    const { matchReasons } = annotateResult(makeResult(), { query: 'x', worldwide: true }, noBounds);
    expect(matchReasons.some((r) => /worldwide/i.test(r))).toBe(true);
  });

  it('worldwide not requested -> no such matchReason', () => {
    const { matchReasons } = annotateResult(makeResult(), { query: 'x' }, noBounds);
    expect(matchReasons.some((r) => /worldwide/i.test(r))).toBe(false);
  });
});

describe('annotateResult — authenticity warnings/matchReasons', () => {
  it("'verified' -> a positive matchReason, never a warning", () => {
    const { matchReasons, warnings } = annotateResult(makeResult({ authenticityStatus: 'verified', authenticitySource: 'eBay Authenticity Guarantee' }), { query: 'x' }, noBounds);
    expect(matchReasons.some((r) => /verified/i.test(r))).toBe(true);
    expect(warnings.some((w) => /authentic/i.test(w))).toBe(false);
  });

  it("'claimed' -> a warning that it is only the seller's claim, NEVER upgraded to a matchReason", () => {
    const { matchReasons, warnings } = annotateResult(makeResult({ authenticityStatus: 'claimed' }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /seller's own claim/i.test(w))).toBe(true);
    expect(matchReasons.some((r) => /authentic/i.test(r))).toBe(false);
  });

  it("'unverified' -> a warning that no usable authenticity info exists", () => {
    const { warnings } = annotateResult(makeResult({ authenticityStatus: 'unverified' }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /no usable authenticity/i.test(w))).toBe(true);
  });

  it("'unknown' -> a warning that the provider reports no authenticity signal at all", () => {
    const { warnings } = annotateResult(makeResult({ authenticityStatus: 'unknown' }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /does not report any authenticity signal/i.test(w))).toBe(true);
  });

  it('a seller claiming "100% authentic" in the title is STILL only "claimed" — the title text itself never changes the warning', () => {
    const { warnings } = annotateResult(makeResult({ title: '100% Authentic Prada Bag', authenticityStatus: 'claimed' }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /seller's own claim/i.test(w))).toBe(true);
  });
});

describe('annotateResult — Global Web Sourcing generic-web-result warning', () => {
  it('a result with source "web" always gets the generic web-result warning', () => {
    const { warnings } = annotateResult(makeResult({ source: 'web' }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /general web search/i.test(w))).toBe(true);
  });

  it('a result from a real structured provider (ebay/etsy) never gets the generic web-result warning', () => {
    const ebayWarnings = annotateResult(makeResult({ source: 'ebay' }), { query: 'x' }, noBounds).warnings;
    const etsyWarnings = annotateResult(makeResult({ source: 'etsy' }), { query: 'x' }, noBounds).warnings;
    expect(ebayWarnings.some((w) => /general web search/i.test(w))).toBe(false);
    expect(etsyWarnings.some((w) => /general web search/i.test(w))).toBe(false);
  });
});

describe('annotateResult — Global Web Sourcing multi-offer provenance warning (Option A)', () => {
  it("TEST L — a result from a shared, multi-offer source page (sharedSourcePage: true) gets an explicit warning that the source link may open the general page, not this specific offer", () => {
    const { warnings } = annotateResult(makeResult({ source: 'web', sharedSourcePage: true }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /listing several offers/i.test(w))).toBe(true);
  });

  it('TEST M — a result from an individual product page (sharedSourcePage not set) never gets the multi-offer provenance warning', () => {
    const { warnings } = annotateResult(makeResult({ source: 'web' }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /listing several offers/i.test(w))).toBe(false);
  });

  it('the multi-offer provenance warning is never attached to a non-web source, even if sharedSourcePage were somehow set on it', () => {
    const { warnings } = annotateResult(makeResult({ source: 'ebay', sharedSourcePage: true } as any), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /listing several offers/i.test(w))).toBe(false);
  });
});

describe('annotateResult — known-cost uncertainty warnings', () => {
  it('translates unknownCostFactors into real, human-readable warnings', () => {
    const { warnings } = annotateResult(makeResult({ unknownCostFactors: ['shipping_unknown'] }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /shipping cost is not reported/i.test(w))).toBe(true);
  });

  it('an unrecognized factor still gets a generic, non-fabricated explanation', () => {
    const { warnings } = annotateResult(makeResult({ unknownCostFactors: ['some_future_factor'] }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => w.includes('some_future_factor'))).toBe(true);
  });

  it('no unknownCostFactors -> no landed-cost warning', () => {
    const { warnings } = annotateResult(makeResult(), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /landed cost/i.test(w))).toBe(false);
  });
});

describe('annotateResult — Phase 6 factual risk signals', () => {
  it('condition_unknown: warns when the result has no condition at all', () => {
    const { warnings } = annotateResult(makeResult({ condition: undefined }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /condition is not reported/i.test(w))).toBe(true);
  });

  it('no condition_unknown warning when a real condition is reported', () => {
    const { warnings } = annotateResult(makeResult({ condition: 'USED_EXCELLENT' }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /condition is not reported/i.test(w))).toBe(false);
  });

  it('seller_rating_unknown: warns when there is no seller at all', () => {
    const { warnings } = annotateResult(makeResult({ seller: undefined }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /seller reputation is not reported/i.test(w))).toBe(true);
  });

  it('seller_rating_unknown: warns when a seller name exists but no rating evidence at all', () => {
    const { warnings } = annotateResult(makeResult({ seller: { name: 'shop1' } }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /seller reputation is not reported/i.test(w))).toBe(true);
  });

  it('no seller_rating_unknown warning when real feedback evidence exists', () => {
    const { warnings } = annotateResult(makeResult({ seller: { name: 'shop1', feedbackPercentage: 99.4 } }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /seller reputation is not reported/i.test(w))).toBe(false);
  });

  it('availability_unknown: warns when availability is not reported', () => {
    const { warnings } = annotateResult(makeResult({ availability: undefined }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /availability is not reported/i.test(w))).toBe(true);
  });

  it('no availability_unknown warning when a real availability status is reported', () => {
    const { warnings } = annotateResult(makeResult({ availability: 'IN_STOCK' }), { query: 'x' }, noBounds);
    expect(warnings.some((w) => /availability is not reported/i.test(w))).toBe(false);
  });

  it('a fully-complete result (condition + seller evidence + availability) gets none of the three Phase 6 risk warnings', () => {
    const { warnings } = annotateResult(
      makeResult({ condition: 'USED_EXCELLENT', seller: { name: 'shop1', feedbackPercentage: 99.4 }, availability: 'IN_STOCK' }),
      { query: 'x' },
      noBounds
    );
    expect(warnings.some((w) => /condition is not reported/i.test(w))).toBe(false);
    expect(warnings.some((w) => /seller reputation is not reported/i.test(w))).toBe(false);
    expect(warnings.some((w) => /availability is not reported/i.test(w))).toBe(false);
  });
});

describe('compareByMatch — deterministic, documented, multi-key', () => {
  it('1) more real matchReasons sorts first', () => {
    const a = makeResult({ matchReasons: ['a', 'b'] });
    const b = makeResult({ matchReasons: ['a'] });
    expect(compareByMatch(a, b)).toBeLessThan(0);
  });

  it('2) a known landed cost sorts before an unknown one, all else equal', () => {
    const a = makeResult({ estimatedKnownCostEur: 100 });
    const b = makeResult({ estimatedKnownCostEur: undefined });
    expect(compareByMatch(a, b)).toBeLessThan(0);
  });

  it('2b) among two known landed costs, ascending', () => {
    const cheaper = makeResult({ estimatedKnownCostEur: 50 });
    const pricier = makeResult({ estimatedKnownCostEur: 100 });
    expect(compareByMatch(cheaper, pricier)).toBeLessThan(0);
  });

  it('Phase 6 (3): a known shipping cost sorts before an unknown one, when matches/cost tie', () => {
    const withShipping = makeResult({ shippingCost: 5, shippingCostCurrency: 'EUR' });
    const withoutShipping = makeResult({ shippingCost: undefined });
    expect(compareByMatch(withShipping, withoutShipping)).toBeLessThan(0);
  });

  it('3) stronger authenticity evidence sorts first when matches/cost/shipping tie', () => {
    const verified = makeResult({ authenticityStatus: 'verified' });
    const claimed = makeResult({ authenticityStatus: 'claimed' });
    expect(compareByMatch(verified, claimed)).toBeLessThan(0);
  });

  it('4) a reported condition sorts before none, when everything else ties', () => {
    const withCondition = makeResult({ condition: 'used' });
    const withoutCondition = makeResult({ condition: undefined });
    expect(compareByMatch(withCondition, withoutCondition)).toBeLessThan(0);
  });

  it('Phase 6: real seller evidence (feedback score/percentage) sorts before none, when everything above ties', () => {
    const withSellerEvidence = makeResult({ seller: { name: 'shop1', feedbackPercentage: 99.4 } });
    const withoutSellerEvidence = makeResult({ seller: undefined });
    expect(compareByMatch(withSellerEvidence, withoutSellerEvidence)).toBeLessThan(0);
  });

  it('Phase 6: a seller with only a name (no rating evidence) is treated the same as no seller at all for this tie-break', () => {
    const nameOnly = makeResult({ seller: { name: 'shop1' } });
    const noSeller = makeResult({ seller: undefined });
    expect(compareByMatch(nameOnly, noSeller)).toBe(0);
  });

  it('Phase 6: a computed margin preview sorts before none, when everything above ties', () => {
    const withMargin = makeResult({ estimatedMargin: 50, estimatedMarginPercent: 15 });
    const withoutMargin = makeResult({ estimatedMargin: undefined });
    expect(compareByMatch(withMargin, withoutMargin)).toBeLessThan(0);
  });

  it('5) ascending normalizedPriceEur is the final tie-break', () => {
    const cheaper = makeResult({ normalizedPriceEur: 100 });
    const pricier = makeResult({ normalizedPriceEur: 200 });
    expect(compareByMatch(cheaper, pricier)).toBeLessThan(0);
  });

  it('a result with no normalizedPriceEur is never dropped, sorts last on that final key', () => {
    const withPrice = makeResult({ normalizedPriceEur: 100 });
    const withoutPrice = makeResult({ normalizedPriceEur: undefined });
    expect(compareByMatch(withPrice, withoutPrice)).toBeLessThan(0);
  });

  it('is a real comparator usable directly with Array.prototype.sort — full ordering example', () => {
    const results = [
      makeResult({ title: 'C', matchReasons: [], estimatedKnownCostEur: undefined, normalizedPriceEur: 50 }),
      makeResult({ title: 'A', matchReasons: ['x', 'y'], estimatedKnownCostEur: 100, normalizedPriceEur: 300 }),
      makeResult({ title: 'B', matchReasons: ['x'], estimatedKnownCostEur: 80, normalizedPriceEur: 200 }),
    ];
    const sorted = [...results].sort(compareByMatch);
    expect(sorted.map((r) => r.title)).toEqual(['A', 'B', 'C']);
  });
});

describe('classifyResultQuality (Deep Web Sourcing Engine)', () => {
  it('HIGH: availability known, condition known, and seller reputation known', () => {
    const result = makeResult({ availability: 'IN_STOCK', condition: 'used', seller: { name: 'shop', feedbackPercentage: 98 } });
    expect(classifyResultQuality(result)).toBe('HIGH');
  });

  it('HIGH: availability known, condition known, and authenticity institutionally verified (seller reputation not required when authenticity evidence exists)', () => {
    const result = makeResult({ availability: 'IN_STOCK', condition: 'new', authenticityStatus: 'verified', authenticitySource: 'eBay Authenticity Guarantee' });
    expect(classifyResultQuality(result)).toBe('HIGH');
  });

  it('MEDIUM: only availability known, no condition, no seller/authenticity evidence', () => {
    const result = makeResult({ availability: 'IN_STOCK', authenticityStatus: 'unverified' });
    expect(classifyResultQuality(result)).toBe('MEDIUM');
  });

  it('MEDIUM: only condition known, no availability', () => {
    const result = makeResult({ condition: 'used', authenticityStatus: 'unverified' });
    expect(classifyResultQuality(result)).toBe('MEDIUM');
  });

  it('LOW: neither availability nor condition known, no seller/authenticity evidence — a bare price', () => {
    const result = makeResult({ authenticityStatus: 'unverified' });
    expect(classifyResultQuality(result)).toBe('LOW');
  });

  it('never upgrades a result just because authenticityStatus is "claimed" without availability/condition also known', () => {
    const result = makeResult({ authenticityStatus: 'claimed', authenticitySource: '100% authentic' });
    expect(classifyResultQuality(result)).toBe('LOW');
  });

  it('Deep Web Sourcing Engine fix (mission section 5): a result that would otherwise be HIGH is capped to MEDIUM when it comes from a CATEGORY_PAGE with no direct productUrl', () => {
    const wouldBeHigh = makeResult({
      availability: 'IN_STOCK',
      condition: 'used',
      seller: { name: 'shop', feedbackPercentage: 98 },
      pageType: 'CATEGORY_PAGE',
      productUrl: undefined,
    });
    expect(classifyResultQuality(wouldBeHigh)).toBe('MEDIUM');
  });

  it('same CATEGORY_PAGE result IS allowed to stay HIGH once a real, distinct productUrl is present', () => {
    const result = makeResult({
      availability: 'IN_STOCK',
      condition: 'used',
      seller: { name: 'shop', feedbackPercentage: 98 },
      pageType: 'CATEGORY_PAGE',
      productUrl: 'https://example.com/exact-item',
    });
    expect(classifyResultQuality(result)).toBe('HIGH');
  });

  it('SEARCH_PAGE and COLLECTION_PAGE results with no productUrl are capped the same way as CATEGORY_PAGE', () => {
    const base = { availability: 'IN_STOCK' as const, condition: 'used', seller: { name: 'shop', feedbackPercentage: 98 }, productUrl: undefined };
    expect(classifyResultQuality(makeResult({ ...base, pageType: 'SEARCH_PAGE' }))).toBe('MEDIUM');
    expect(classifyResultQuality(makeResult({ ...base, pageType: 'COLLECTION_PAGE' }))).toBe('MEDIUM');
  });

  it('a PRODUCT_PAGE result with no productUrl is NOT capped — the page itself already IS the product page, sourceUrl is already direct', () => {
    const result = makeResult({
      availability: 'IN_STOCK',
      condition: 'used',
      seller: { name: 'shop', feedbackPercentage: 98 },
      pageType: 'PRODUCT_PAGE',
      productUrl: undefined,
    });
    expect(classifyResultQuality(result)).toBe('HIGH');
  });
});

describe('computeOpportunityScore (Deep Web Sourcing Engine)', () => {
  it('a bare result with none of the bonus signals scores 0, with no factors listed', () => {
    const result = makeResult({ authenticityStatus: 'unverified' });
    const { score, factors } = computeOpportunityScore(result);
    expect(score).toBe(0);
    expect(factors).toEqual([]);
  });

  it('every real, documented signal adds up transparently, each named in factors', () => {
    const result = makeResult({
      estimatedMargin: 50,
      estimatedMarginPercent: 20,
      estimatedKnownCostEur: 200,
      shippingCost: 5,
      shippingCostCurrency: 'EUR',
      availability: 'IN_STOCK',
      condition: 'used',
      authenticityStatus: 'verified',
      authenticitySource: 'eBay Authenticity Guarantee',
      seller: { name: 'shop', feedbackPercentage: 99 },
    });
    const { score, factors } = computeOpportunityScore(result);
    // 25 (margin) + 15 (landed cost) + 10 (shipping) + 10 (in stock) + 15 (verified) + 15 (HIGH quality) = 90
    expect(score).toBe(90);
    expect(factors.length).toBe(6);
    expect(factors.some((f) => f.includes('Margin preview available'))).toBe(true);
  });

  it('is never negative and never exceeds 100, even in extreme cases', () => {
    const lowResult = makeResult({ availability: 'OUT_OF_STOCK', authenticityStatus: 'unverified', unknownCostFactors: ['shipping_unknown', 'currency_conversion_unavailable'] });
    expect(computeOpportunityScore(lowResult).score).toBeGreaterThanOrEqual(0);

    const highResult = makeResult({
      estimatedMargin: 999,
      estimatedMarginPercent: 999,
      estimatedKnownCostEur: 1,
      shippingCost: 0,
      shippingCostCurrency: 'EUR',
      availability: 'IN_STOCK',
      condition: 'new',
      authenticityStatus: 'verified',
      seller: { name: 'shop', feedbackPercentage: 100 },
    });
    expect(computeOpportunityScore(highResult).score).toBeLessThanOrEqual(100);
  });

  it('reporting OUT_OF_STOCK is a real penalty, never scored the same as unknown availability', () => {
    // Both start from the same non-zero baseline (margin known) so the
    // penalty's effect is visible rather than clamped to the same 0 floor.
    const base = { estimatedMargin: 50, estimatedMarginPercent: 20, authenticityStatus: 'unverified' as const };
    const outOfStock = makeResult({ ...base, availability: 'OUT_OF_STOCK' });
    const unknown = makeResult(base);
    expect(computeOpportunityScore(outOfStock).score).toBeLessThan(computeOpportunityScore(unknown).score);
    expect(computeOpportunityScore(outOfStock).factors.some((f) => f.includes('Reported out of stock (-20)'))).toBe(true);
  });

  it('each unresolved cost factor is a real, named penalty', () => {
    const result = makeResult({ authenticityStatus: 'unverified', unknownCostFactors: ['shipping_unknown', 'currency_conversion_unavailable'] });
    const { factors } = computeOpportunityScore(result);
    expect(factors.some((f) => f.includes('2 unresolved cost factor'))).toBe(true);
  });
});

describe('detectPriceConflict (Deep Web Sourcing Engine)', () => {
  it('the same price and currency -> not conflicting', () => {
    const a = makeResult({ price: 220, currency: 'EUR' });
    const b = makeResult({ price: 220, currency: 'eur' }); // case-insensitive currency compare
    expect(detectPriceConflict(a, b)).toEqual({ conflicting: false });
  });

  it('different prices for what would otherwise dedup to the same offer -> conflicting, names both prices, never picks one arbitrarily', () => {
    const a = makeResult({ price: 34, currency: 'EUR' });
    const b = makeResult({ price: 41, currency: 'EUR' });
    expect(detectPriceConflict(a, b)).toEqual({ conflicting: true, priceA: '34 EUR', priceB: '41 EUR' });
  });

  it('the same numeric price in different currencies -> still conflicting (never assumed equivalent)', () => {
    const a = makeResult({ price: 50, currency: 'EUR' });
    const b = makeResult({ price: 50, currency: 'USD' });
    expect(detectPriceConflict(a, b)).toEqual({ conflicting: true, priceA: '50 EUR', priceB: '50 USD' });
  });
});
