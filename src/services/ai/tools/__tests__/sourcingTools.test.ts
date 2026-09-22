/**
 * Real behavioral tests for the search_products tool definition itself:
 * input validation, correct category/registration, delegation to
 * SourcingService (mocked — its own real behavior is covered in
 * SourcingService.test.ts), and that it stays workspace-safe (never
 * needs or leaks anything workspace-specific, unlike get_order).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/sourcing/SourcingService', () => ({
  SourcingService: { search: vi.fn() },
}));

import { searchProductsTool } from '@/services/ai/tools/sourcingTools';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { SourcingService } from '@/services/sourcing/SourcingService';

const searchMock = SourcingService.search as ReturnType<typeof vi.fn>;

describe('search_products tool definition', () => {
  it('is registered in AiToolRegistry as a read tool', () => {
    const tool = AiToolRegistry.get('search_products');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
  });

  describe('inputSchema', () => {
    it('accepts a minimal valid query', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: 'Prada sneakers' }).success).toBe(true);
    });

    it('rejects an empty query', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: '' }).success).toBe(false);
    });

    it('requires currency whenever minPrice or maxPrice is set', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', maxPrice: 600 }).success).toBe(false);
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', maxPrice: 600, currency: 'EUR' }).success).toBe(true);
    });

    it('rejects an unsupported marketplace value', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', marketplaces: ['EBAY_ZZ'] }).success).toBe(false);
    });

    it('accepts multiple supported marketplaces', () => {
      const result = searchProductsTool.inputSchema.safeParse({ query: 'x', marketplaces: ['EBAY_FR', 'EBAY_GB'] });
      expect(result.success).toBe(true);
    });

    it('rejects an unsupported condition value', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', condition: 'mint' }).success).toBe(false);
    });

    it('accepts an optional worldwide boolean', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', worldwide: true }).success).toBe(true);
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x' }).success).toBe(true);
    });

    it('accepts a valid providers allowlist (Phase 2)', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', providers: ['ebay'] }).success).toBe(true);
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', providers: ['ebay', 'etsy'] }).success).toBe(true);
    });

    it('rejects an unknown provider name', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', providers: ['stockx'] }).success).toBe(false);
    });

    it('accepts optional model/size/color (Phase 3)', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', model: 'Cut', size: '42', color: 'Black' }).success).toBe(true);
    });

    it('accepts a valid sort option and rejects an unknown one (Phase 3)', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', sort: 'match' }).success).toBe(true);
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', sort: 'price_asc' }).success).toBe(true);
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', sort: 'relevance' }).success).toBe(false);
    });

    it('accepts an optional targetResalePrice (Phase 3)', () => {
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', targetResalePrice: 600 }).success).toBe(true);
      expect(searchProductsTool.inputSchema.safeParse({ query: 'x', targetResalePrice: -10 }).success).toBe(false);
    });
  });

  describe('handler', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('is workspace-safe: never uses the workspaceId it is given (the search is global, not per-tenant data)', async () => {
      searchMock.mockResolvedValue({ status: 'ok', results: [], providerErrors: [] });

      await searchProductsTool.handler('some-workspace-id', { query: 'x' });

      // SourcingService.search is called with only the query — no
      // workspaceId is threaded into it, unlike get_order.
      expect(searchMock).toHaveBeenCalledWith({ query: 'x' });
    });

    it('SOURCE_NOT_CONFIGURED is passed through plainly, never replaced with a fabricated result', async () => {
      searchMock.mockResolvedValue({ status: 'SOURCE_NOT_CONFIGURED', results: [], providerErrors: [] });

      const result = await searchProductsTool.handler('ws-1', { query: 'x' });

      expect(result).toMatchObject({ status: 'SOURCE_NOT_CONFIGURED', results: [] });
    });

    it('a successful search returns results plus a note explaining margin is only a landed-cost preview, never invented', async () => {
      const fakeResult = {
        source: 'ebay', sourceUrl: 'https://x', title: 'Item', price: 10, currency: 'EUR',
        marketplace: 'EBAY_FR', images: [], authenticityStatus: 'claimed' as const,
      };
      searchMock.mockResolvedValue({ status: 'ok', results: [fakeResult], providerErrors: [] });

      const result: any = await searchProductsTool.handler('ws-1', { query: 'x' });

      expect(result.status).toBe('ok');
      expect(result.results).toEqual([fakeResult]);
      expect(result.note).toMatch(/never invented/i);
    });

    it('provider errors are passed through to the agent, never hidden', async () => {
      searchMock.mockResolvedValue({
        status: 'ok',
        results: [],
        providerErrors: [{ provider: 'ebay', message: 'eBay search failed', kind: 'upstream_error' }],
      });

      const result: any = await searchProductsTool.handler('ws-1', { query: 'x' });

      expect(result.providerErrors).toEqual([{ provider: 'ebay', message: 'eBay search failed', kind: 'upstream_error' }]);
    });

    it('worldwide is passed through unchanged to SourcingService.search, same as any other field', async () => {
      searchMock.mockResolvedValue({ status: 'ok', results: [], providerErrors: [] });

      await searchProductsTool.handler('ws-1', { query: 'x', worldwide: true });

      expect(searchMock).toHaveBeenCalledWith({ query: 'x', worldwide: true });
    });

    it('Global Sourcing Engine provenance fields (providersSearched/providersFailed/providersUnavailable/totalResults) are passed through unchanged', async () => {
      searchMock.mockResolvedValue({
        status: 'ok',
        results: [],
        providerErrors: [],
        providersSearched: ['ebay'],
        providersFailed: [],
        providersUnavailable: [],
        totalResults: 0,
      });

      const result: any = await searchProductsTool.handler('ws-1', { query: 'x' });

      expect(result.providersSearched).toEqual(['ebay']);
      expect(result.providersFailed).toEqual([]);
      expect(result.providersUnavailable).toEqual([]);
      expect(result.totalResults).toBe(0);
    });

    it('SOURCE_NOT_CONFIGURED still passes through providersUnavailable, so the agent knows exactly what is missing', async () => {
      searchMock.mockResolvedValue({
        status: 'SOURCE_NOT_CONFIGURED',
        results: [],
        providerErrors: [],
        providersSearched: [],
        providersFailed: [],
        providersUnavailable: ['ebay'],
        totalResults: 0,
      });

      const result: any = await searchProductsTool.handler('ws-1', { query: 'x' });

      expect(result.providersUnavailable).toEqual(['ebay']);
    });

    it('providers allowlist is passed through unchanged to SourcingService.search (Phase 2)', async () => {
      searchMock.mockResolvedValue({ status: 'ok', results: [], providerErrors: [] });

      await searchProductsTool.handler('ws-1', { query: 'x', providers: ['ebay'] });

      expect(searchMock).toHaveBeenCalledWith({ query: 'x', providers: ['ebay'] });
    });

    it('providersSkipped is passed through unchanged (Phase 2)', async () => {
      searchMock.mockResolvedValue({
        status: 'ok',
        results: [],
        providerErrors: [],
        providersSearched: ['ebay'],
        providersFailed: [],
        providersUnavailable: [],
        providersSkipped: ['etsy'],
        totalResults: 0,
      });

      const result: any = await searchProductsTool.handler('ws-1', { query: 'x', providers: ['ebay'] });

      expect(result.providersSkipped).toEqual(['etsy']);
    });

    it('Phase 3 — model/size/color/sort/targetResalePrice are passed through unchanged to SourcingService.search', async () => {
      searchMock.mockResolvedValue({ status: 'ok', results: [], providerErrors: [] });

      await searchProductsTool.handler('ws-1', { query: 'x', model: 'Cut', size: '42', color: 'Black', sort: 'match', targetResalePrice: 600 });

      expect(searchMock).toHaveBeenCalledWith({ query: 'x', model: 'Cut', size: '42', color: 'Black', sort: 'match', targetResalePrice: 600 });
    });

    it('Phase 3 — providerLatencyMs is passed through unchanged, for observability only', async () => {
      searchMock.mockResolvedValue({ status: 'ok', results: [], providerErrors: [], providerLatencyMs: { ebay: 123 } });

      const result: any = await searchProductsTool.handler('ws-1', { query: 'x' });

      expect(result.providerLatencyMs).toEqual({ ebay: 123 });
    });

    it('Phase 3 — matchReasons/warnings/estimatedMargin flow through untouched as part of each result', async () => {
      const fakeResult = {
        source: 'ebay', sourceUrl: 'https://x', title: 'Item', price: 10, currency: 'EUR',
        marketplace: 'EBAY_FR', images: [], authenticityStatus: 'claimed' as const,
        matchReasons: ['Within the requested price range (~€10.00)'],
        warnings: ["Authenticity is only the seller's own claim — not independently verified."],
        estimatedMargin: 10, estimatedMarginPercent: 50,
      };
      searchMock.mockResolvedValue({ status: 'ok', results: [fakeResult], providerErrors: [] });

      const result: any = await searchProductsTool.handler('ws-1', { query: 'x' });

      expect(result.results[0].matchReasons).toEqual(fakeResult.matchReasons);
      expect(result.results[0].warnings).toEqual(fakeResult.warnings);
      expect(result.results[0].estimatedMargin).toBe(10);
      expect(result.results[0].estimatedMarginPercent).toBe(50);
    });

    it('Phase 5 — knownUnavailableSources (real, researched access-gap documentation) is always included on a successful search', async () => {
      searchMock.mockResolvedValue({ status: 'ok', results: [], providerErrors: [] });

      const result: any = await searchProductsTool.handler('ws-1', { query: 'x' });

      expect(Array.isArray(result.knownUnavailableSources)).toBe(true);
      expect(result.knownUnavailableSources.length).toBeGreaterThan(0);
      expect(result.knownUnavailableSources.map((s: any) => s.name)).toContain('Mercari Japan');
    });

    it('Phase 5 — knownUnavailableSources is also included on SOURCE_NOT_CONFIGURED, so the agent can still explain real limitations', async () => {
      searchMock.mockResolvedValue({ status: 'SOURCE_NOT_CONFIGURED', results: [], providerErrors: [], providersUnavailable: ['ebay', 'etsy'] });

      const result: any = await searchProductsTool.handler('ws-1', { query: 'x' });

      expect(Array.isArray(result.knownUnavailableSources)).toBe(true);
      expect(result.knownUnavailableSources.length).toBeGreaterThan(0);
    });
  });
});
