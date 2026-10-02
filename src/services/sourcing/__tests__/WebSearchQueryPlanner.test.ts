/**
 * Deep Web Sourcing Engine — WebSearchQueryPlanner. Pure, deterministic,
 * no network/AI call involved — every test here is a plain function call.
 */
import { describe, it, expect } from 'vitest';
import { buildBaseQueryText, buildPasses, MAX_WEB_SEARCH_PASSES } from '@/services/sourcing/WebSearchQueryPlanner';
import { NormalizedSearchQuery } from '@/services/sourcing/types';

describe('buildBaseQueryText', () => {
  it('folds query/brand/model/size/color/category into one free-text string, in order', () => {
    const query: NormalizedSearchQuery = {
      query: 'sneakers',
      brand: 'Nike',
      model: 'Air Max 95',
      size: '42',
      color: 'white',
      category: 'shoes',
    };
    expect(buildBaseQueryText(query)).toBe('sneakers Nike Air Max 95 42 white shoes');
  });

  it('folds in a maxPrice/currency hint', () => {
    expect(buildBaseQueryText({ query: 'Nike Air Max', maxPrice: 50, currency: 'EUR' })).toBe('Nike Air Max under 50 EUR');
  });

  it('never fabricates a field that was not provided — omits blanks entirely, no extra whitespace artifacts', () => {
    expect(buildBaseQueryText({ query: 'bag' })).toBe('bag');
  });

  it('folds in "used" only when condition is explicitly "used" — never for "new"/"refurbished"/omitted', () => {
    expect(buildBaseQueryText({ query: 'bag', condition: 'used' })).toBe('bag used');
    expect(buildBaseQueryText({ query: 'bag', condition: 'new' })).toBe('bag');
    expect(buildBaseQueryText({ query: 'bag', condition: 'refurbished' })).toBe('bag');
  });
});

describe('buildPasses', () => {
  it('deepSearch=false (default): returns exactly one "exact" pass, basic depth — byte-identical to the pre-Deep-Web-Sourcing single-query behavior', () => {
    const passes = buildPasses({ query: 'Nike Air Max' }, false);
    expect(passes).toEqual([{ pass: 'exact', queryText: 'Nike Air Max', searchDepth: 'basic' }]);
  });

  it('deepSearch=true: returns exact, secondhand, outlet, recovery, in that order, never more than MAX_WEB_SEARCH_PASSES', () => {
    const passes = buildPasses({ query: 'Nike Air Max' }, true);
    expect(passes.map((p) => p.pass)).toEqual(['exact', 'secondhand', 'outlet', 'recovery']);
    expect(passes.length).toBeLessThanOrEqual(MAX_WEB_SEARCH_PASSES);
  });

  it('secondhand/outlet passes fold in generic, non-product-specific keywords on top of the same base query', () => {
    const passes = buildPasses({ query: 'Nike Air Max' }, true);
    const secondhand = passes.find((p) => p.pass === 'secondhand')!;
    const outlet = passes.find((p) => p.pass === 'outlet')!;
    expect(secondhand.queryText).toContain('Nike Air Max');
    expect(secondhand.queryText).toMatch(/used|second hand|pre-owned/);
    expect(outlet.queryText).toContain('Nike Air Max');
    expect(outlet.queryText).toMatch(/outlet|clearance|discounted|resale/);
  });

  it('only the recovery pass uses "advanced" search depth — every earlier pass stays "basic" (cost control)', () => {
    const passes = buildPasses({ query: 'Nike Air Max' }, true);
    expect(passes.find((p) => p.pass === 'exact')!.searchDepth).toBe('basic');
    expect(passes.find((p) => p.pass === 'secondhand')!.searchDepth).toBe('basic');
    expect(passes.find((p) => p.pass === 'outlet')!.searchDepth).toBe('basic');
    expect(passes.find((p) => p.pass === 'recovery')!.searchDepth).toBe('advanced');
  });

  it('is deterministic — calling it twice with the same input produces the exact same plan', () => {
    const query: NormalizedSearchQuery = { query: 'vintage Burberry jacket', brand: 'Burberry', size: 'M', maxPrice: 100, currency: 'EUR' };
    expect(buildPasses(query, true)).toEqual(buildPasses(query, true));
  });
});
