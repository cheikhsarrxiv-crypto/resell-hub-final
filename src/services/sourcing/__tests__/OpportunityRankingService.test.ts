/**
 * Real behavioral tests for OpportunityRankingService — the transparent
 * matchReasons/warnings annotator and the deterministic 'match' sort
 * comparator. Pure functions, no mocking needed.
 */
import { describe, it, expect } from 'vitest';
import { annotateResult, compareByMatch } from '@/services/sourcing/OpportunityRankingService';
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

  it('never excludes when price comparison is unresolvable — only a warning is added', () => {
    const result = makeResult({ normalizedPriceEur: 9999 }); // would be "outside" if compared, but bounds themselves are unresolvable
    const { excludedByPrice, warnings } = annotateResult(result, { query: 'x' }, { requested: true, unresolvable: true });
    expect(excludedByPrice).toBe(false);
    expect(warnings.some((w) => /uncertain/i.test(w))).toBe(true);
  });

  it("never excludes a result whose OWN normalizedPriceEur is undefined, even with resolvable bounds — flags it 'uncertain' instead", () => {
    const result = makeResult({ normalizedPriceEur: undefined, currency: 'JPY' });
    const { excludedByPrice, warnings } = annotateResult(result, { query: 'x' }, { requested: true, unresolvable: false, maxEur: 400 });
    expect(excludedByPrice).toBe(false);
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

  it('3) stronger authenticity evidence sorts first when matches/cost tie', () => {
    const verified = makeResult({ authenticityStatus: 'verified' });
    const claimed = makeResult({ authenticityStatus: 'claimed' });
    expect(compareByMatch(verified, claimed)).toBeLessThan(0);
  });

  it('4) a reported condition sorts before none, when everything else ties', () => {
    const withCondition = makeResult({ condition: 'used' });
    const withoutCondition = makeResult({ condition: undefined });
    expect(compareByMatch(withCondition, withoutCondition)).toBeLessThan(0);
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
