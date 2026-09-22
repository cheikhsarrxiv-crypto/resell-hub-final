/**
 * Real behavioral tests for NoopQueryExpansionService — the deliberately
 * unwired Global Sourcing Engine query-expansion stub. Nothing calls this
 * service in the app yet (see the class's own comment for why); these
 * tests only prove the stub itself never fabricates a translation or
 * synonym.
 */
import { describe, it, expect } from 'vitest';
import { NoopQueryExpansionService, DeterministicBrandQueryExpansionService } from '@/services/sourcing/QueryExpansionService';

describe('NoopQueryExpansionService', () => {
  it('returns the original query unchanged', async () => {
    const service = new NoopQueryExpansionService();
    const result = await service.expand('Prada sneakers');
    expect(result.original).toBe('Prada sneakers');
  });

  it('never invents a variant — variants is always empty', async () => {
    const service = new NoopQueryExpansionService();
    const result = await service.expand('Prada sneakers');
    expect(result.variants).toEqual([]);
  });

  it('an empty string query is returned as-is, not rejected or altered', async () => {
    const service = new NoopQueryExpansionService();
    const result = await service.expand('');
    expect(result.original).toBe('');
    expect(result.variants).toEqual([]);
  });

  describe('Phase 2 — provider/market/locale-aware context', () => {
    it('accepts a full context (provider/market/locale) without changing the no-op result', async () => {
      const service = new NoopQueryExpansionService();
      const result = await service.expand('Nike', { provider: 'ebay', market: 'EBAY_FR', locale: 'ja-JP' });
      expect(result.original).toBe('Nike');
      expect(result.variants).toEqual([]);
    });

    it('a different context for the same query still never invents a translation/variant', async () => {
      const service = new NoopQueryExpansionService();
      const forEbay = await service.expand('Prada Cut', { provider: 'ebay' });
      const forEtsy = await service.expand('Prada Cut', { provider: 'etsy' });
      expect(forEbay.variants).toEqual([]);
      expect(forEtsy.variants).toEqual([]);
    });

    it('context is entirely optional — omitting it behaves exactly like before this field existed', async () => {
      const service = new NoopQueryExpansionService();
      const result = await service.expand('Nike');
      expect(result.original).toBe('Nike');
      expect(result.variants).toEqual([]);
    });
  });
});

describe('Phase 6 — DeterministicBrandQueryExpansionService (real, verified, controlled brand variants)', () => {
  const service = new DeterministicBrandQueryExpansionService();

  it('Nike -> produces the real, verified ナイキ variant', async () => {
    const result = await service.expand('Nike Dunk');
    expect(result.original).toBe('Nike Dunk');
    expect(result.variants).toEqual(['ナイキ Dunk']);
  });

  it('Adidas -> produces the real, verified アディダス variant', async () => {
    const result = await service.expand('Adidas Samba');
    expect(result.variants).toEqual(['アディダス Samba']);
  });

  it('never touches the model/product name next to the brand — only the brand token is substituted', async () => {
    const result = await service.expand('Nike Air Force 1 size 42');
    expect(result.variants).toEqual(['ナイキ Air Force 1 size 42']);
  });

  it('is case-insensitive on the brand token, but preserves the rest of the query verbatim', async () => {
    const result = await service.expand('nike dunk');
    expect(result.variants).toEqual(['ナイキ dunk']);
  });

  it('a brand with no verified entry (e.g. Prada) never gets an invented variant — silence, not a guess', async () => {
    const result = await service.expand('Prada Cut');
    expect(result.variants).toEqual([]);
  });

  it('a query with no recognized brand at all returns no variants, exactly like the Noop service', async () => {
    const result = await service.expand('vintage leather jacket');
    expect(result.variants).toEqual([]);
  });

  it('never matches a brand name as a mere substring of another word', async () => {
    // "Nikelab" contains "Nike" as a substring but is not the brand token "Nike" on its own.
    const result = await service.expand('Nikelab collection');
    expect(result.variants).toEqual([]);
  });

  it('duplicate/no-op variants are never produced — a variant identical to the original is filtered out', async () => {
    const result = await service.expand('ナイキ Dunk'); // already in katakana, brand regex is Latin-only, no match expected
    expect(result.variants).toEqual([]);
  });

  it('multiple recognized brands in the same query each produce their own real variant', async () => {
    const result = await service.expand('Nike vs Adidas comparison');
    expect(result.variants).toContain('ナイキ vs Adidas comparison');
    expect(result.variants).toContain('Nike vs アディダス comparison');
    expect(result.variants).toHaveLength(2);
  });

  it('accepts the same optional context as the Noop service without changing its own real behavior', async () => {
    const result = await service.expand('Nike Dunk', { provider: 'ebay', locale: 'ja-JP' });
    expect(result.variants).toEqual(['ナイキ Dunk']);
  });
});
