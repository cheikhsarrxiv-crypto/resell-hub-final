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

    it('a successful search returns results plus a note that margin is not calculated', async () => {
      const fakeResult = {
        source: 'ebay', sourceUrl: 'https://x', title: 'Item', price: 10, currency: 'EUR',
        marketplace: 'EBAY_FR', images: [], authenticityStatus: 'claimed' as const,
      };
      searchMock.mockResolvedValue({ status: 'ok', results: [fakeResult], providerErrors: [] });

      const result: any = await searchProductsTool.handler('ws-1', { query: 'x' });

      expect(result.status).toBe('ok');
      expect(result.results).toEqual([fakeResult]);
      expect(result.note).toMatch(/no margin/i);
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
  });
});
