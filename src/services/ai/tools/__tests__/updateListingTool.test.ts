/**
 * Real behavioral tests for update_listing — an 'engage' agent action
 * (never auto-executed, always goes through AiActionService's
 * propose -> preview -> confirm -> execute pipeline, see
 * update-listing-pipeline-integration.test.ts for the full end-to-end
 * version). These tests exercise the tool's preview()/handler() directly,
 * mocking ListingService.getListing/updateListing — the SAME real methods
 * the human-facing dashboard edit already uses, never reimplemented here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getListingMock, updateListingMock, getAuthenticatedAdapterMock } = vi.hoisted(() => ({
  getListingMock: vi.fn(),
  updateListingMock: vi.fn(),
  getAuthenticatedAdapterMock: vi.fn(),
}));

vi.mock('@/services/ListingService', () => ({
  ListingService: { getListing: getListingMock, updateListing: updateListingMock },
  getAuthenticatedAdapter: getAuthenticatedAdapterMock,
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { updateListingTool } from '@/services/ai/tools/actionTools';

function makeListing(overrides: Record<string, any> = {}) {
  return {
    id: 'listing-1',
    productId: 'product-1',
    workspaceId: 'ws-1',
    marketplaceConnectionId: 'conn-1',
    externalId: 'EBAY-EXT-1',
    title: 'Old title, five plus chars',
    description: 'An old description that is at least twenty characters long.',
    price: 39.99,
    quantity: 2,
    status: 'active',
    syncStatus: 'synced',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    connection: {
      id: 'conn-1',
      marketplace: { name: 'ebay', displayName: 'eBay' },
    },
    ...overrides,
  };
}

describe('update_listing tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as an engage tool — never auto-executed', () => {
    const tool = AiToolRegistry.get('update_listing');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('engage');
    expect(AiToolRegistry.isAutoExecutable('engage')).toBe(false);
  });

  describe('preview() — no mutation ever happens here', () => {
    it('1. builds a before/after diff for the requested fields only', async () => {
      getListingMock.mockResolvedValue(makeListing());

      const result: any = await updateListingTool.preview!('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      expect(result.changes).toEqual({ title: { before: 'Old title, five plus chars', after: 'New title, plenty long' } });
      expect(result.changes).not.toHaveProperty('price');
      expect(updateListingMock).not.toHaveBeenCalled();
    });

    it('2. never calls ListingService.updateListing (no mutation during proposal)', async () => {
      getListingMock.mockResolvedValue(makeListing());

      await updateListingTool.preview!('ws-1', { listingId: 'listing-1', changes: { quantity: 5 } });

      expect(updateListingMock).not.toHaveBeenCalled();
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('3. unknown listing -> controlled error, never throws', async () => {
      getListingMock.mockResolvedValue(null);

      const result: any = await updateListingTool.preview!('ws-1', { listingId: 'does-not-exist', changes: { title: 'New title, plenty long' } });

      expect(result.error).toMatch(/not found/i);
    });

    it('4. a deleted listing is refused', async () => {
      getListingMock.mockResolvedValue(makeListing({ deletedAt: new Date() }));

      const result: any = await updateListingTool.preview!('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      expect(result.error).toMatch(/deleted/i);
    });

    it('5. a listing belonging to another workspace is refused (relies on ListingService.getListing\'s own workspace-scoped query)', async () => {
      getListingMock.mockImplementation(async (listingId: string, workspaceId: string) => (workspaceId === 'ws-A' ? makeListing() : null));

      const result: any = await updateListingTool.preview!('ws-B', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      expect(result.error).toMatch(/not found/i);
      expect(getListingMock).toHaveBeenCalledWith('listing-1', 'ws-B');
    });

    it('6. price on an eBay listing is refused with an honest, specific reason (no stored currency)', async () => {
      getListingMock.mockResolvedValue(makeListing());

      const result: any = await updateListingTool.preview!('ws-1', { listingId: 'listing-1', changes: { price: 49 } });

      expect(result.error).toMatch(/currency/i);
    });

    it('title/description/quantity ARE supported on an eBay listing', async () => {
      getListingMock.mockResolvedValue(makeListing());

      const result: any = await updateListingTool.preview!('ws-1', {
        listingId: 'listing-1',
        changes: { title: 'New title, plenty long', quantity: 5 },
      });

      expect(result.error).toBeUndefined();
      expect(result.changes.title).toBeDefined();
      expect(result.changes.quantity).toBeDefined();
    });

    it('7. every field is supported on an Etsy listing, including price', async () => {
      getListingMock.mockResolvedValue(makeListing({ connection: { marketplace: { name: 'etsy', displayName: 'Etsy' } } }));

      const result: any = await updateListingTool.preview!('ws-1', { listingId: 'listing-1', changes: { price: 49 } });

      expect(result.error).toBeUndefined();
      expect(result.changes.price).toEqual({ before: 39.99, after: 49 });
    });

    it('8. a Depop-connected listing refuses any field', async () => {
      getListingMock.mockResolvedValue(makeListing({ connection: { marketplace: { name: 'depop', displayName: 'Depop' } } }));

      const result: any = await updateListingTool.preview!('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      expect(result.error).toMatch(/depop/i);
    });

    it('a Vinted-connected listing refuses any field', async () => {
      getListingMock.mockResolvedValue(makeListing({ connection: { marketplace: { name: 'vinted', displayName: 'Vinted' } } }));

      const result: any = await updateListingTool.preview!('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      expect(result.error).toMatch(/vinted/i);
    });

    it('9. a listing with no marketplace connection is local-only — every field allowed', async () => {
      getListingMock.mockResolvedValue(makeListing({ connection: null, externalId: null }));

      const result: any = await updateListingTool.preview!('ws-1', { listingId: 'listing-1', changes: { price: 49 } });

      expect(result.error).toBeUndefined();
      expect(result.willSyncToMarketplace).toBe(false);
      expect(result.marketplace).toBeNull();
    });

    it('10. a listing with a connection but never actually published (no externalId) is treated as local-only too', async () => {
      getListingMock.mockResolvedValue(makeListing({ externalId: null }));

      const result: any = await updateListingTool.preview!('ws-1', { listingId: 'listing-1', changes: { price: 49 } });

      expect(result.error).toBeUndefined();
      expect(result.willSyncToMarketplace).toBe(false);
    });

    it('shows the marketplace and willSyncToMarketplace:true for a really-connected, really-published listing', async () => {
      getListingMock.mockResolvedValue(makeListing());

      const result: any = await updateListingTool.preview!('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      expect(result.willSyncToMarketplace).toBe(true);
      expect(result.marketplace).toEqual({ name: 'ebay', displayName: 'eBay' });
    });
  });

  describe('handler() — the real execution, only ever reached after confirmation', () => {
    it('11. calls ListingService.updateListing with exactly the requested changes', async () => {
      getListingMock.mockResolvedValue(makeListing());
      updateListingMock.mockResolvedValue(makeListing({ title: 'New title, plenty long' }));

      await updateListingTool.handler('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      expect(updateListingMock).toHaveBeenCalledWith('listing-1', 'ws-1', { title: 'New title, plenty long' });
    });

    it('12. returns a structured success result reflecting the updated listing', async () => {
      getListingMock.mockResolvedValue(makeListing());
      updateListingMock.mockResolvedValue(makeListing({ quantity: 9 }));

      const result: any = await updateListingTool.handler('ws-1', { listingId: 'listing-1', changes: { quantity: 9 } });

      expect(result.success).toBe(true);
      expect(result.updated.quantity).toBe(9);
      expect(result.syncedToMarketplace).toBe(true);
      expect(result.marketplace).toBe('ebay');
    });

    it('13. unsupported field (price on eBay) is refused BEFORE calling ListingService.updateListing', async () => {
      getListingMock.mockResolvedValue(makeListing());

      const result: any = await updateListingTool.handler('ws-1', { listingId: 'listing-1', changes: { price: 49 } });

      expect(result.error).toMatch(/currency/i);
      expect(updateListingMock).not.toHaveBeenCalled();
    });

    it('14. unknown listing -> controlled error, never calls updateListing', async () => {
      getListingMock.mockResolvedValue(null);

      const result: any = await updateListingTool.handler('ws-1', { listingId: 'does-not-exist', changes: { title: 'New title, plenty long' } });

      expect(result.error).toMatch(/not found/i);
      expect(updateListingMock).not.toHaveBeenCalled();
    });

    it('a deleted listing is refused before calling updateListing', async () => {
      getListingMock.mockResolvedValue(makeListing({ deletedAt: new Date() }));

      const result: any = await updateListingTool.handler('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      expect(result.error).toMatch(/deleted/i);
      expect(updateListingMock).not.toHaveBeenCalled();
    });

    it('15. a marketplace adapter error propagates unmodified (caught by AiActionService, not swallowed here)', async () => {
      getListingMock.mockResolvedValue(makeListing());
      updateListingMock.mockRejectedValue(new Error("eBay isn't connected. Reconnect it in Settings and try again."));

      await expect(updateListingTool.handler('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } })).rejects.toThrow(
        "eBay isn't connected. Reconnect it in Settings and try again."
      );
    });

    it('16. local-only listing update never calls getAuthenticatedAdapter (no marketplace call attempted)', async () => {
      getListingMock.mockResolvedValue(makeListing({ connection: null, externalId: null }));
      updateListingMock.mockResolvedValue(makeListing({ connection: null, externalId: null, price: 49 }));

      await updateListingTool.handler('ws-1', { listingId: 'listing-1', changes: { price: 49 } });

      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('17. no OAuth token/secret ever appears in the result', async () => {
      getListingMock.mockResolvedValue(makeListing());
      updateListingMock.mockResolvedValue(makeListing({ title: 'New title, plenty long' }));

      const result: any = await updateListingTool.handler('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });
      const serialized = JSON.stringify(result);

      expect(serialized).not.toMatch(/apiKey|apiSecret|token|secret|password/i);
    });
  });

  describe('input validation', () => {
    it('rejects a request with no fields to change', () => {
      expect(updateListingTool.inputSchema.safeParse({ listingId: 'listing-1', changes: {} }).success).toBe(false);
    });

    it('rejects a negative price', () => {
      expect(updateListingTool.inputSchema.safeParse({ listingId: 'listing-1', changes: { price: -5 } }).success).toBe(false);
    });

    it('rejects a negative quantity', () => {
      expect(updateListingTool.inputSchema.safeParse({ listingId: 'listing-1', changes: { quantity: -1 } }).success).toBe(false);
    });

    it('rejects a title shorter than the app-wide minimum (5 chars)', () => {
      expect(updateListingTool.inputSchema.safeParse({ listingId: 'listing-1', changes: { title: 'Hi' } }).success).toBe(false);
    });

    it('rejects a description shorter than the app-wide minimum (20 chars)', () => {
      expect(updateListingTool.inputSchema.safeParse({ listingId: 'listing-1', changes: { description: 'Too short' } }).success).toBe(false);
    });
  });

  it('18. registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('update_listing')).toBe(updateListingTool);
  });

  it('19. classified "engage"', () => {
    expect(updateListingTool.category).toBe('engage');
  });

  it('20. never auto-executable — always requires confirmation', () => {
    expect(AiToolRegistry.isAutoExecutable(updateListingTool.category)).toBe(false);
  });
});
