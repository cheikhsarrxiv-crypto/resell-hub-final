/**
 * Real behavioral tests for OpportunityRankingService — the transparent
 * matchReasons/warnings annotator and the deterministic 'match' sort
 * comparator. Pure functions, no mocking needed.
 */
import { describe, it, expect } from 'vitest';
import {
  annotateResult,
  compareByMatch,
  classifyOpportunity,
  classifyResultQuality,
  compareColor,
  computeOpportunityScore,
  detectAttributeConflicts,
  detectPriceConflict,
  explainClassification,
  formatAttributeConflictWarning,
  isLikelyListingPageUrl,
  isUnresolvedListingPage,
  normalizeColorTokens,
  normalizeSizeForComparison,
} from '@/services/sourcing/OpportunityRankingService';
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

describe('isLikelyListingPageUrl (Deep Web Sourcing Engine fix)', () => {
  it('the exact real false positive observed: Etsy /market/nike_air_max_used', () => {
    expect(isLikelyListingPageUrl('https://www.etsy.com/market/nike_air_max_used')).toBe(true);
  });

  it('other real listing-page URL conventions', () => {
    expect(isLikelyListingPageUrl('https://commonhype.com/collections/used-shoes')).toBe(true);
    expect(isLikelyListingPageUrl('https://example.com/category/sneakers')).toBe(true);
    expect(isLikelyListingPageUrl('https://example.com/categories/sneakers')).toBe(true);
    expect(isLikelyListingPageUrl('https://example.com/search?q=nike+air+max')).toBe(true);
    expect(isLikelyListingPageUrl('https://example.com/browse/nike')).toBe(true);
  });

  it('a real single-product URL is never flagged as a listing page', () => {
    expect(isLikelyListingPageUrl('https://www.vinted.fr/items/123-nike-air-max-90')).toBe(false);
    expect(isLikelyListingPageUrl('https://example.com/product/nike-air-max-90')).toBe(false);
  });

  it('an unparseable URL -> false, never a guess', () => {
    expect(isLikelyListingPageUrl('not a url')).toBe(false);
  });
});

describe('isUnresolvedListingPage (Deep Web Sourcing Engine fix)', () => {
  it('the real production case: pageType UNKNOWN + an Etsy /market/... URL + no productUrl -> excluded', () => {
    const result = makeResult({
      sourceUrl: 'https://www.etsy.com/market/nike_air_max_used',
      pageType: 'UNKNOWN',
      productUrl: undefined,
    });
    expect(isUnresolvedListingPage(result)).toBe(true);
  });

  it('pageType explicitly CATEGORY_PAGE/SEARCH_PAGE/COLLECTION_PAGE with no productUrl -> excluded, regardless of URL shape', () => {
    expect(isUnresolvedListingPage(makeResult({ pageType: 'CATEGORY_PAGE', sourceUrl: 'https://example.com/anything', productUrl: undefined }))).toBe(true);
    expect(isUnresolvedListingPage(makeResult({ pageType: 'SEARCH_PAGE', sourceUrl: 'https://example.com/anything', productUrl: undefined }))).toBe(true);
    expect(isUnresolvedListingPage(makeResult({ pageType: 'COLLECTION_PAGE', sourceUrl: 'https://example.com/anything', productUrl: undefined }))).toBe(true);
  });

  it('a direct productUrl resolves the ambiguity regardless of pageType or URL shape — never excluded', () => {
    const result = makeResult({
      sourceUrl: 'https://www.etsy.com/market/nike_air_max_used',
      pageType: 'UNKNOWN',
      productUrl: 'https://www.etsy.com/listing/123456/nike-air-max-90',
    });
    expect(isUnresolvedListingPage(result)).toBe(false);
  });

  it('pageType explicitly PRODUCT_PAGE is never excluded on this basis, even with a listing-shaped URL and no productUrl — its own sourceUrl already is the direct link', () => {
    const result = makeResult({ sourceUrl: 'https://example.com/collections/anything', pageType: 'PRODUCT_PAGE', productUrl: undefined });
    expect(isUnresolvedListingPage(result)).toBe(false);
  });

  it('pageType UNKNOWN with a URL that does NOT look like a listing page -> kept (genuinely ambiguous, never dropped on a guess)', () => {
    const result = makeResult({ sourceUrl: 'https://www.vinted.fr/items/123-nike-air-max-90', pageType: 'UNKNOWN', productUrl: undefined });
    expect(isUnresolvedListingPage(result)).toBe(false);
  });
});

describe('normalizeColorTokens', () => {
  it('splits a compound color into lowercase tokens', () => {
    expect(normalizeColorTokens('Black/White')).toEqual(new Set(['black', 'white']));
  });

  it('splits on spaces, commas, "and", and hyphens', () => {
    expect(normalizeColorTokens('Multi/White')).toEqual(new Set(['multi', 'white']));
    expect(normalizeColorTokens('Red and Black')).toEqual(new Set(['red', 'black']));
    expect(normalizeColorTokens('Triple White')).toEqual(new Set(['triple', 'white']));
  });
});

describe('compareColor — Opportunity Classification fix', () => {
  it('match — identical single color', () => {
    expect(compareColor('white', 'white')).toBe('match');
  });

  it('match — case-insensitive', () => {
    expect(compareColor('White', 'WHITE')).toBe('match');
  });

  it('incompatible — no overlap at all (requested white, reported black)', () => {
    expect(compareColor('white', 'black')).toBe('incompatible');
  });

  it('ambiguous — requested color present but reported color also names another (Black/White searching white)', () => {
    expect(compareColor('white', 'Black/White')).toBe('ambiguous');
  });

  it('ambiguous — Multi/White searching white (the audit\'s own example)', () => {
    expect(compareColor('white', 'Multi/White')).toBe('ambiguous');
  });

  it('never treats White/Black and Black/White as automatically identical to a single-color request — both are ambiguous against "white"', () => {
    expect(compareColor('white', 'White/Black')).toBe('ambiguous');
    expect(compareColor('white', 'Black/White')).toBe('ambiguous');
  });

  it('match — a compound requested color matching a compound reported color exactly (order-independent, same token set)', () => {
    expect(compareColor('Black/White', 'White/Black')).toBe('match');
  });
});

describe('normalizeSizeForComparison', () => {
  it('strips a known region label word, not a real EU/US/UK conversion', () => {
    expect(normalizeSizeForComparison('43 EU')).toBe('43');
    expect(normalizeSizeForComparison('EU 43')).toBe('43');
    expect(normalizeSizeForComparison('43')).toBe('43');
  });

  it('different numbers never normalize to the same string, even with labels stripped (no real unit conversion is performed)', () => {
    expect(normalizeSizeForComparison('43 EU')).not.toBe(normalizeSizeForComparison('9 US'));
  });

  it('normalizes a comma decimal to a dot', () => {
    expect(normalizeSizeForComparison('43,5')).toBe('43.5');
  });
});

describe('annotateResult — color (Opportunity Classification fix)', () => {
  it('color not requested at all -> colorOutcome "not_requested", no color matchReason/warning', () => {
    const result = makeResult({ color: 'Black' });
    const { colorOutcome, excludedByColor, matchReasons, warnings } = annotateResult(result, { query: 'x' }, noBounds);
    expect(colorOutcome).toBe('not_requested');
    expect(excludedByColor).toBe(false);
    expect(matchReasons.some((r) => /color/i.test(r))).toBe(false);
    expect(warnings.some((w) => /color/i.test(w))).toBe(false);
  });

  it('requested color confirmed -> matchReason, never excluded', () => {
    const result = makeResult({ color: 'White' });
    const { colorOutcome, excludedByColor, matchReasons } = annotateResult(result, { query: 'x', color: 'white' }, noBounds);
    expect(colorOutcome).toBe('match');
    expect(excludedByColor).toBe(false);
    expect(matchReasons.some((r) => /Requested color "white" confirmed/.test(r))).toBe(true);
  });

  it('requested color incompatible -> excludedByColor true, never a silent keep', () => {
    const result = makeResult({ color: 'Black' });
    const { colorOutcome, excludedByColor } = annotateResult(result, { query: 'x', color: 'white' }, noBounds);
    expect(colorOutcome).toBe('incompatible');
    expect(excludedByColor).toBe(true);
  });

  it('requested color ambiguous (Black/White searching white) -> never excluded, warning instead, never a confirmed matchReason', () => {
    const result = makeResult({ color: 'Black/White' });
    const { colorOutcome, excludedByColor, matchReasons, warnings } = annotateResult(result, { query: 'x', color: 'white' }, noBounds);
    expect(colorOutcome).toBe('ambiguous');
    expect(excludedByColor).toBe(false);
    expect(matchReasons.some((r) => /color/i.test(r))).toBe(false);
    expect(warnings.some((w) => /only partially confirmed/i.test(w))).toBe(true);
  });

  it('requested color unknown (source does not report one) -> warning, never excluded, never a fabricated match', () => {
    const result = makeResult({ color: undefined });
    const { colorOutcome, excludedByColor, warnings } = annotateResult(result, { query: 'x', color: 'white' }, noBounds);
    expect(colorOutcome).toBe('unknown');
    expect(excludedByColor).toBe(false);
    expect(warnings.some((w) => /color was not confirmed/i.test(w))).toBe(true);
  });
});

describe('annotateResult — size (Opportunity Classification fix)', () => {
  it('size not requested -> sizeOutcome "not_requested", no size matchReason/warning', () => {
    const result = makeResult({ size: '43' });
    const { sizeOutcome, matchReasons, warnings } = annotateResult(result, { query: 'x' }, noBounds);
    expect(sizeOutcome).toBe('not_requested');
    expect(matchReasons.some((r) => /size/i.test(r))).toBe(false);
    expect(warnings.some((w) => /size/i.test(w))).toBe(false);
  });

  it('requested size confirmed -> matchReason, label stripped not a real unit conversion', () => {
    const result = makeResult({ size: '43 EU' });
    const { sizeOutcome, matchReasons } = annotateResult(result, { query: 'x', size: '43' }, noBounds);
    expect(sizeOutcome).toBe('match');
    expect(matchReasons.some((r) => /Requested size "43" confirmed/.test(r))).toBe(true);
  });

  it('requested size different -> warning, NEVER excluded (no verified EU/US/UK conversion)', () => {
    const result = makeResult({ size: '42' });
    const { sizeOutcome, warnings, excludedByColor } = annotateResult(result, { query: 'x', size: '43' }, noBounds);
    expect(sizeOutcome).toBe('different');
    expect(warnings.some((w) => /differs from the requested size/i.test(w))).toBe(true);
    expect(excludedByColor).toBe(false); // size never gates excludedByColor/any exclusion flag
  });

  it('requested size absent from the source -> "Size not confirmed by the source" warning', () => {
    const result = makeResult({ size: undefined });
    const { sizeOutcome, warnings } = annotateResult(result, { query: 'x', size: '43' }, noBounds);
    expect(sizeOutcome).toBe('absent');
    expect(warnings.some((w) => /Size not confirmed by the source/.test(w))).toBe(true);
  });

  it('never deduces a size from unrelated text — a result whose title mentions "women\'s"/"white" is never treated as size-confirmed', () => {
    const result = makeResult({ title: "Nike Air Force 1 White Women's", size: undefined, color: 'White' });
    const { sizeOutcome, matchReasons } = annotateResult(result, { query: 'Nike Air Force 1', color: 'white', size: '43' }, noBounds);
    expect(sizeOutcome).toBe('absent');
    expect(matchReasons.some((r) => /size/i.test(r))).toBe(false);
  });
});

describe('classifyOpportunity — Opportunity Classification fix (mission section 1)', () => {
  const notRequested = { colorOutcome: 'not_requested' as const, sizeOutcome: 'not_requested' as const };

  it('never an automatic VERIFIED_OPPORTUNITY just because source !== "web"', () => {
    const ebayResult = makeResult({ source: 'ebay' });
    expect(classifyOpportunity(ebayResult, notRequested, 'MEDIUM')).toBe('WEB_LEAD');
  });

  it('VERIFIED_OPPORTUNITY requires qualityTier HIGH and no unresolved critical attribute', () => {
    const result = makeResult({ source: 'web' });
    expect(classifyOpportunity(result, notRequested, 'HIGH')).toBe('VERIFIED_OPPORTUNITY');
  });

  it('qualityTier !== HIGH -> WEB_LEAD, even for an eBay/Etsy result', () => {
    const result = makeResult({ source: 'etsy' });
    expect(classifyOpportunity(result, notRequested, 'LOW')).toBe('WEB_LEAD');
  });

  it('a detected price conflict (verificationStatus conflicting) -> WEB_LEAD even at quality HIGH', () => {
    const result = makeResult({ verificationStatus: 'conflicting' });
    expect(classifyOpportunity(result, notRequested, 'HIGH')).toBe('WEB_LEAD');
  });

  it('ambiguous or unknown requested color -> WEB_LEAD even at quality HIGH', () => {
    const result = makeResult();
    expect(classifyOpportunity(result, { colorOutcome: 'ambiguous', sizeOutcome: 'not_requested' }, 'HIGH')).toBe('WEB_LEAD');
    expect(classifyOpportunity(result, { colorOutcome: 'unknown', sizeOutcome: 'not_requested' }, 'HIGH')).toBe('WEB_LEAD');
  });

  it('a confirmed color match never blocks VERIFIED_OPPORTUNITY on its own', () => {
    const result = makeResult();
    expect(classifyOpportunity(result, { colorOutcome: 'match', sizeOutcome: 'not_requested' }, 'HIGH')).toBe('VERIFIED_OPPORTUNITY');
  });

  it('requested size different or absent -> WEB_LEAD even at quality HIGH', () => {
    const result = makeResult();
    expect(classifyOpportunity(result, { colorOutcome: 'not_requested', sizeOutcome: 'different' }, 'HIGH')).toBe('WEB_LEAD');
    expect(classifyOpportunity(result, { colorOutcome: 'not_requested', sizeOutcome: 'absent' }, 'HIGH')).toBe('WEB_LEAD');
  });

  it('a confirmed size match never blocks VERIFIED_OPPORTUNITY on its own', () => {
    const result = makeResult();
    expect(classifyOpportunity(result, { colorOutcome: 'not_requested', sizeOutcome: 'match' }, 'HIGH')).toBe('VERIFIED_OPPORTUNITY');
  });
});

describe('explainClassification — Web Sourcing smoke-test fix (section 3)', () => {
  const notRequested = { colorOutcome: 'not_requested' as const, sizeOutcome: 'not_requested' as const };

  it('undefined when the result would classify as VERIFIED_OPPORTUNITY — nothing to explain', () => {
    const result = makeResult();
    expect(explainClassification(result, notRequested, 'HIGH')).toBeUndefined();
  });

  it('names the specific missing signal(s) behind a non-HIGH qualityTier', () => {
    // makeResult() defaults authenticityStatus to 'claimed' (real evidence
    // on its own) — overridden here so NONE of availability/condition/
    // seller/authenticity evidence is present, to exercise every clause.
    const result = makeResult({ authenticityStatus: 'unverified' });
    const reason = explainClassification(result, notRequested, 'LOW');
    expect(reason).toMatch(/listing quality is LOW/);
    expect(reason).toMatch(/availability not confirmed/);
    expect(reason).toMatch(/condition not confirmed/);
    expect(reason).toMatch(/seller\/authenticity not confirmed/);
  });

  it('a detected price conflict is named explicitly', () => {
    const result = makeResult({ verificationStatus: 'conflicting' });
    expect(explainClassification(result, notRequested, 'HIGH')).toMatch(/price conflict was detected/);
  });

  it('ambiguous color is named explicitly, distinct from unknown color', () => {
    const result = makeResult();
    expect(explainClassification(result, { colorOutcome: 'ambiguous', sizeOutcome: 'not_requested' }, 'HIGH')).toMatch(/color only partially confirmed/);
    expect(explainClassification(result, { colorOutcome: 'unknown', sizeOutcome: 'not_requested' }, 'HIGH')).toMatch(/color not confirmed by the source/);
  });

  it('different size vs. absent size are named with distinct reasons', () => {
    const result = makeResult();
    expect(explainClassification(result, { colorOutcome: 'not_requested', sizeOutcome: 'different' }, 'HIGH')).toMatch(/size differs/);
    expect(explainClassification(result, { colorOutcome: 'not_requested', sizeOutcome: 'absent' }, 'HIGH')).toMatch(/size not confirmed/);
  });

  it('combines multiple real factors in one reason when several apply at once', () => {
    const result = makeResult({ verificationStatus: 'conflicting' });
    const reason = explainClassification(result, { colorOutcome: 'ambiguous', sizeOutcome: 'absent' }, 'MEDIUM');
    expect(reason).toMatch(/listing quality is MEDIUM/);
    expect(reason).toMatch(/price conflict/);
    expect(reason).toMatch(/color only partially confirmed/);
    expect(reason).toMatch(/size not confirmed/);
  });

  it('never duplicates the full warning sentences — stays a concise label', () => {
    const result = makeResult();
    const reason = explainClassification(result, { colorOutcome: 'ambiguous', sizeOutcome: 'not_requested' }, 'HIGH');
    expect(reason!.length).toBeLessThan(80);
  });

  it('always agrees with classifyOpportunity: a reason is produced if and only if classification is WEB_LEAD', () => {
    const cases: Array<[any, 'HIGH' | 'MEDIUM' | 'LOW']> = [
      [notRequested, 'HIGH'],
      [notRequested, 'MEDIUM'],
      [{ colorOutcome: 'match', sizeOutcome: 'match' }, 'HIGH'],
      [{ colorOutcome: 'ambiguous', sizeOutcome: 'not_requested' }, 'HIGH'],
      [{ colorOutcome: 'not_requested', sizeOutcome: 'different' }, 'HIGH'],
    ];
    const result = makeResult();
    for (const [annotation, qualityTier] of cases) {
      const classification = classifyOpportunity(result, annotation, qualityTier);
      const reason = explainClassification(result, annotation, qualityTier);
      if (classification === 'WEB_LEAD') {
        expect(reason).toBeDefined();
      } else {
        expect(reason).toBeUndefined();
      }
    }
  });
});

/**
 * Phase 2 (reliability of claims) — detectAttributeConflicts. Mirrors
 * detectPriceConflict's own contract (never decide which value is
 * "correct", just report both real values) extended to condition/
 * availability/authenticity. Always exercised on two `makeResult()`
 * results sharing the SAME identity in spirit (SourcingService.deduplicate
 * is the only real caller, and it only ever calls this on two results it
 * already identified as the exact same offer) — this file tests the pure
 * comparison logic itself, never the identity decision (that belongs to
 * SourcingService.test.ts's own dedup-key tests).
 */
describe('detectAttributeConflicts (Phase 2 — reliability of claims)', () => {
  it('same article, CONTRADICTORY condition -> one real conflict, both values preserved, neither declared correct', () => {
    const a = makeResult({ condition: 'used' });
    const b = makeResult({ condition: 'new' });

    const conflicts = detectAttributeConflicts(a, b);

    expect(conflicts).toEqual([{ attribute: 'condition', valueA: 'used', valueB: 'new' }]);
  });

  it('same article, CONTRADICTORY authenticity claim text -> a real authenticitySource conflict', () => {
    const a = makeResult({ authenticitySource: '100% authentic, with receipt' });
    const b = makeResult({ authenticitySource: 'no proof of authenticity provided' });

    const conflicts = detectAttributeConflicts(a, b);

    expect(conflicts).toEqual([
      { attribute: 'authenticitySource', valueA: '100% authentic, with receipt', valueB: 'no proof of authenticity provided' },
    ]);
  });

  it('same article, CONTRADICTORY authenticityStatus (both carry a real signal) -> a real conflict', () => {
    const a = makeResult({ authenticityStatus: 'verified', authenticitySource: 'eBay Authenticity Guarantee' });
    const b = makeResult({ authenticityStatus: 'claimed', authenticitySource: 'eBay Authenticity Guarantee' });

    const conflicts = detectAttributeConflicts(a, b);

    expect(conflicts.some((c) => c.attribute === 'authenticityStatus')).toBe(true);
  });

  it('same offer, CONTRADICTORY availability -> a real availability conflict', () => {
    const a = makeResult({ availability: 'IN_STOCK' });
    const b = makeResult({ availability: 'OUT_OF_STOCK' });

    const conflicts = detectAttributeConflicts(a, b);

    expect(conflicts).toEqual([{ attribute: 'availability', valueA: 'IN_STOCK', valueB: 'OUT_OF_STOCK' }]);
  });

  it('identical results on every comparable attribute -> NO artificial conflict at all', () => {
    const a = makeResult({ condition: 'used', availability: 'IN_STOCK', authenticitySource: 'seller claim' });
    const b = makeResult({ condition: 'used', availability: 'IN_STOCK', authenticitySource: 'seller claim' });

    expect(detectAttributeConflicts(a, b)).toEqual([]);
  });

  it('case/whitespace-only differences are NOT a conflict (never a false positive on formatting alone)', () => {
    const a = makeResult({ condition: 'Used' });
    const b = makeResult({ condition: '  used  ' });

    expect(detectAttributeConflicts(a, b)).toEqual([]);
  });

  it('missing data on ONE side is never treated as a contradiction — absence is not disagreement', () => {
    const withCondition = makeResult({ condition: 'used' });
    const withoutCondition = makeResult({ condition: undefined });
    const withAvailability = makeResult({ availability: 'IN_STOCK' });
    const withoutAvailability = makeResult({ availability: undefined });
    const withClaim = makeResult({ authenticitySource: 'seller claim' });
    const withoutClaim = makeResult({ authenticitySource: undefined });

    expect(detectAttributeConflicts(withCondition, withoutCondition)).toEqual([]);
    expect(detectAttributeConflicts(withAvailability, withoutAvailability)).toEqual([]);
    expect(detectAttributeConflicts(withClaim, withoutClaim)).toEqual([]);
  });

  it('authenticityStatus "unverified"/"unknown" (no real signal) is never a conflict with a real "verified"/"claimed" signal on the other side', () => {
    const verified = makeResult({ authenticityStatus: 'verified', authenticitySource: 'eBay Authenticity Guarantee' });
    const unverified = makeResult({ authenticityStatus: 'unverified' });
    const claimed = makeResult({ authenticityStatus: 'claimed', authenticitySource: 'seller says authentic' });
    const unknown = makeResult({ authenticityStatus: 'unknown' });

    expect(detectAttributeConflicts(verified, unverified).some((c) => c.attribute === 'authenticityStatus')).toBe(false);
    expect(detectAttributeConflicts(claimed, unknown).some((c) => c.attribute === 'authenticityStatus')).toBe(false);
  });

  it('several real conflicts on the same pair are ALL reported, never just the first one found', () => {
    const a = makeResult({ condition: 'used', availability: 'IN_STOCK' });
    const b = makeResult({ condition: 'new', availability: 'OUT_OF_STOCK' });

    const conflicts = detectAttributeConflicts(a, b);

    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((c) => c.attribute).sort()).toEqual(['availability', 'condition']);
  });

  it('formatAttributeConflictWarning names the exact attribute and both real values, never asserting which is correct', () => {
    const warning = formatAttributeConflictWarning({ attribute: 'condition', valueA: 'used', valueB: 'new' });

    expect(warning).toContain('Condition conflict');
    expect(warning).toContain('"used"');
    expect(warning).toContain('"new"');
    expect(warning.toLowerCase()).not.toContain('is wrong');
    expect(warning.toLowerCase()).not.toContain('is correct');
  });
});
