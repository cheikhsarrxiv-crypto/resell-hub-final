/**
 * Real behavioral tests for get_listing — a read-only agent tool, same
 * shape and conventions as get_order (orderTools.ts): auto-executable,
 * no confirmation, workspace isolation is the real ListingService.getListing
 * `findFirst({ id, workspaceId })` boundary (never a bare findUnique by id
 * alone), and the agent-facing formatter never spreads the raw
 * MarketplaceConnection row (which carries apiKey/apiSecret/
 * encryptedOauthToken/encryptedRefreshToken).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getListingMock, inventoryFindUniqueMock, listingFindManyMock, listingCountMock, productFindFirstMock } = vi.hoisted(() => ({
  getListingMock: vi.fn(),
  inventoryFindUniqueMock: vi.fn(),
  listingFindManyMock: vi.fn(),
  listingCountMock: vi.fn(),
  productFindFirstMock: vi.fn(),
}));

vi.mock('@/services/ListingService', () => ({
  ListingService: { getListing: getListingMock },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    inventory: { findUnique: inventoryFindUniqueMock },
    listing: { findMany: listingFindManyMock, count: listingCountMock },
    product: { findFirst: productFindFirstMock },
  },
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getListingTool, getListingsTool } from '@/services/ai/tools/listingTools';

function makeListing(overrides: Record<string, any> = {}) {
  return {
    id: 'listing-1',
    productId: 'product-1',
    workspaceId: 'ws-1',
    marketplaceConnectionId: 'conn-1',
    externalId: 'EBAY-EXT-1',
    title: 'Prada Cut Out Sneakers',
    description: 'A real description.',
    price: 449,
    quantity: 1,
    status: 'active',
    syncStatus: 'synced',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    deletedAt: null,
    product: {
      id: 'product-1',
      sku: 'SKU-PRADA-1',
      brand: 'Prada',
      category: 'Sneakers',
      size: '42',
      color: 'White',
      condition: 'like-new',
      weightGrams: 900,
      lengthCm: 32,
      widthCm: 22,
      heightCm: 12,
      images: [
        { url: 'https://img.example/main.jpg', isMain: true, order: 0 },
        { url: 'https://img.example/second.jpg', isMain: false, order: 1 },
      ],
      ...overrides.product,
    },
    connection: {
      id: 'conn-1',
      // Deliberately included in the fake to prove the formatter never
      // leaks these — a real MarketplaceConnection row genuinely has them.
      apiKey: 'real-api-key',
      apiSecret: 'real-api-secret',
      encryptedOauthToken: 'real-encrypted-token',
      encryptedRefreshToken: 'real-encrypted-refresh',
      sellerId: 'real-seller-id',
      accountEmail: 'seller@example.com',
      marketplace: { name: 'ebay', displayName: 'eBay' },
      ...overrides.connection,
    },
    orders: [],
    ...overrides,
  };
}

describe('get_listing tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as a read tool — auto-executable, no confirmation', () => {
    const tool = AiToolRegistry.get('get_listing');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
  });

  it('rejects an input missing listingId', () => {
    expect(getListingTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a valid listingId input', () => {
    expect(getListingTool.inputSchema.safeParse({ listingId: 'listing-1' }).success).toBe(true);
  });

  it('1. existing listing in the SAME workspace -> success, found:true', async () => {
    getListingMock.mockResolvedValue(makeListing());
    inventoryFindUniqueMock.mockResolvedValue({ quantity: 2, reserved: 0, available: 2 });

    const result: any = await getListingTool.handler('ws-1', { listingId: 'listing-1' });

    expect(result.found).toBe(true);
    expect(result.listing.listingId).toBe('listing-1');
    expect(getListingMock).toHaveBeenCalledWith('listing-1', 'ws-1');
  });

  it('2. unknown listing -> controlled { found: false } response, never throws', async () => {
    getListingMock.mockResolvedValue(null);

    const result: any = await getListingTool.handler('ws-1', { listingId: 'does-not-exist' });

    expect(result).toEqual({ found: false });
  });

  it('3. a listing belonging to ANOTHER workspace -> refused, reveals nothing (relies on ListingService.getListing\'s own workspace-scoped query)', async () => {
    // ListingService.getListing's real query is `findFirst({ where: { id, workspaceId } })`
    // — a listingId that exists but belongs to a different workspace never
    // matches, so it legitimately resolves to null here, exactly like an
    // unknown id. This test proves get_listing passes workspaceId straight
    // through and treats a null result as { found: false }, never trying
    // a second, unscoped lookup.
    getListingMock.mockImplementation(async (listingId: string, workspaceId: string) => {
      if (workspaceId !== 'ws-A') return null; // simulates the listing being owned by ws-A only
      return makeListing({ workspaceId: 'ws-A' });
    });

    const result: any = await getListingTool.handler('ws-B', { listingId: 'listing-1' });

    expect(result).toEqual({ found: false });
    expect(getListingMock).toHaveBeenCalledWith('listing-1', 'ws-B');
  });

  it('4. a listing with complete product/inventory info -> full, correct mapping', async () => {
    getListingMock.mockResolvedValue(makeListing());
    inventoryFindUniqueMock.mockResolvedValue({ quantity: 3, reserved: 1, available: 2 });

    const result: any = await getListingTool.handler('ws-1', { listingId: 'listing-1' });

    expect(result.listing).toMatchObject({
      listingId: 'listing-1',
      productId: 'product-1',
      title: 'Prada Cut Out Sneakers',
      description: 'A real description.',
      price: 449,
      quantity: 1,
      status: 'active',
      syncStatus: 'synced',
      externalId: 'EBAY-EXT-1',
      sku: 'SKU-PRADA-1',
      brand: 'Prada',
      category: 'Sneakers',
      size: '42',
      color: 'White',
      condition: 'like-new',
    });
    expect(result.listing.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.listing.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('5. optional info absent -> no field is invented, everything comes back null/absent as appropriate', async () => {
    getListingMock.mockResolvedValue(
      makeListing({
        externalId: null,
        product: {
          sku: null,
          brand: null,
          category: null,
          size: null,
          color: null,
          condition: null,
          weightGrams: null,
          lengthCm: null,
          widthCm: null,
          heightCm: null,
          images: [],
        },
        connection: null,
      })
    );
    inventoryFindUniqueMock.mockResolvedValue(null);

    const result: any = await getListingTool.handler('ws-1', { listingId: 'listing-1' });

    expect(result.listing.externalId).toBeNull();
    expect(result.listing.sku).toBeNull();
    expect(result.listing.brand).toBeNull();
    expect(result.listing.category).toBeNull();
    expect(result.listing.size).toBeNull();
    expect(result.listing.color).toBeNull();
    expect(result.listing.condition).toBeNull();
    expect(result.listing.marketplace).toBeNull();
    expect(result.listing.shipping).toBeNull();
    expect(result.listing.inventory).toBeNull();
    expect(result.listing.images).toEqual([]);
    // Never fabricated at all — no stored authenticity concept on a real Listing.
    expect(result.listing).not.toHaveProperty('authenticityStatus');
    expect(result.listing).not.toHaveProperty('currency'); // no such column on Listing — never invented
  });

  it('6. marketplace is correctly returned from the listing\'s connection', async () => {
    getListingMock.mockResolvedValue(makeListing({ connection: { marketplace: { name: 'etsy', displayName: 'Etsy' } } }));
    inventoryFindUniqueMock.mockResolvedValue(null);

    const result: any = await getListingTool.handler('ws-1', { listingId: 'listing-1' });

    expect(result.listing.marketplace).toEqual({ name: 'etsy', displayName: 'Etsy' });
  });

  it('7. price is correctly returned (no currency invented — Listing has no currency column)', async () => {
    getListingMock.mockResolvedValue(makeListing({ price: 199.5 }));
    inventoryFindUniqueMock.mockResolvedValue(null);

    const result: any = await getListingTool.handler('ws-1', { listingId: 'listing-1' });

    expect(result.listing.price).toBe(199.5);
    expect(result.listing).not.toHaveProperty('currency');
  });

  it('8. quantity (listed) and inventory (live stock) are both returned, kept distinct — never one deduced from the other', async () => {
    getListingMock.mockResolvedValue(makeListing({ quantity: 5 }));
    inventoryFindUniqueMock.mockResolvedValue({ quantity: 10, reserved: 3, available: 7 });

    const result: any = await getListingTool.handler('ws-1', { listingId: 'listing-1' });

    expect(result.listing.quantity).toBe(5); // the listing's own published quantity
    expect(result.listing.inventory).toEqual({ quantity: 10, reserved: 3, available: 7 }); // the real live stock figure
    expect(inventoryFindUniqueMock).toHaveBeenCalledWith({
      where: { productId_workspaceId: { productId: 'product-1', workspaceId: 'ws-1' } },
      select: { quantity: true, reserved: true, available: true },
    });
  });

  it('9. SKU is correctly returned from the product', async () => {
    getListingMock.mockResolvedValue(makeListing({ product: { sku: 'SKU-XYZ' } }));
    inventoryFindUniqueMock.mockResolvedValue(null);

    const result: any = await getListingTool.handler('ws-1', { listingId: 'listing-1' });

    expect(result.listing.sku).toBe('SKU-XYZ');
  });

  it('10. size/condition/color are returned only when they actually exist on the product', async () => {
    getListingMock.mockResolvedValue(makeListing({ product: { size: '38', condition: 'new', color: 'Black' } }));
    inventoryFindUniqueMock.mockResolvedValue(null);

    const result: any = await getListingTool.handler('ws-1', { listingId: 'listing-1' });

    expect(result.listing.size).toBe('38');
    expect(result.listing.condition).toBe('new');
    expect(result.listing.color).toBe('Black');
  });

  it('11. shipping (package dimensions) is returned only when at least one dimension is stored — never carrier/tracking, which don\'t exist at listing level', async () => {
    getListingMock.mockResolvedValue(makeListing({ product: { weightGrams: 500, lengthCm: null, widthCm: null, heightCm: null } }));
    inventoryFindUniqueMock.mockResolvedValue(null);

    const result: any = await getListingTool.handler('ws-1', { listingId: 'listing-1' });

    expect(result.listing.shipping).toEqual({ weightGrams: 500, lengthCm: null, widthCm: null, heightCm: null });
    expect(result.listing.shipping).not.toHaveProperty('carrier');
    expect(result.listing.shipping).not.toHaveProperty('trackingNumber');
  });

  it('12. is a pure read — never calls anything beyond ListingService.getListing/prisma.inventory.findUnique (no action/adapter/marketplace call)', async () => {
    getListingMock.mockResolvedValue(makeListing());
    inventoryFindUniqueMock.mockResolvedValue(null);

    await getListingTool.handler('ws-1', { listingId: 'listing-1' });

    // No import of getAuthenticatedAdapter or any AiActionService call
    // exists anywhere in listingTools.ts (static source fact) — this test
    // documents the tool has no such dependency at all, structurally.
    expect(getListingMock).toHaveBeenCalledTimes(1);
    expect(inventoryFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('13. registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('get_listing')).toBe(getListingTool);
  });

  it('14. classified "read"', () => {
    expect(getListingTool.category).toBe('read');
  });

  it('15. auto-executable without confirmation (never routed through AiActionService)', () => {
    expect(AiToolRegistry.isAutoExecutable(getListingTool.category)).toBe(true);
  });

  it('16. no cross-workspace leak: the formatter never includes any MarketplaceConnection secret field even if present on the raw row', async () => {
    getListingMock.mockResolvedValue(makeListing());
    inventoryFindUniqueMock.mockResolvedValue(null);

    const result: any = await getListingTool.handler('ws-1', { listingId: 'listing-1' });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('real-api-key');
    expect(serialized).not.toContain('real-api-secret');
    expect(serialized).not.toContain('real-encrypted-token');
    expect(serialized).not.toContain('real-encrypted-refresh');
    expect(serialized).not.toContain('real-seller-id');
    expect(serialized).not.toContain('seller@example.com');
  });
});

/**
 * Real behavioral tests for get_listings — lists/searches multiple
 * listings (never a single-id lookup, that's get_listing above). Same
 * workspace-isolation and secret-non-leakage guarantees, via a `select`
 * (never a full `include`) that structurally cannot pull
 * MarketplaceConnection's apiKey/apiSecret/oauth token fields.
 */
function makeListingRow(overrides: Record<string, any> = {}) {
  return {
    id: 'listing-1',
    productId: 'product-1',
    title: 'Prada Cut Out Sneakers',
    price: 449,
    quantity: 1,
    status: 'active',
    syncStatus: 'synced',
    externalId: 'EBAY-EXT-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    product: { sku: 'SKU-PRADA-1' },
    connection: { marketplace: { name: 'ebay', displayName: 'eBay' } },
    ...overrides,
  };
}

describe('get_listings tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as a read tool — auto-executable, no confirmation', () => {
    const tool = AiToolRegistry.get('get_listings');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
  });

  it('1. workspace isolation — the where clause always includes the caller workspaceId', async () => {
    listingFindManyMock.mockResolvedValue([]);
    listingCountMock.mockResolvedValue(0);

    await getListingsTool.handler('ws-A', {});

    expect(listingFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'ws-A' }) }));
    expect(listingCountMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'ws-A' }) }));
  });

  it('2. no listing -> found: false, empty listings, zeroed counts', async () => {
    listingFindManyMock.mockResolvedValue([]);
    listingCountMock.mockResolvedValue(0);

    const result: any = await getListingsTool.handler('ws-1', {});

    expect(result).toEqual({ found: false, listings: [], totalListings: 0, returnedListings: 0 });
  });

  it('3. a single listing is returned', async () => {
    listingFindManyMock.mockResolvedValue([makeListingRow()]);
    listingCountMock.mockResolvedValue(1);

    const result: any = await getListingsTool.handler('ws-1', {});

    expect(result.found).toBe(true);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].listingId).toBe('listing-1');
  });

  it('4. multiple listings are all returned', async () => {
    listingFindManyMock.mockResolvedValue([makeListingRow({ id: 'listing-1' }), makeListingRow({ id: 'listing-2' })]);
    listingCountMock.mockResolvedValue(2);

    const result: any = await getListingsTool.handler('ws-1', {});

    expect(result.listings.map((l: any) => l.listingId)).toEqual(['listing-1', 'listing-2']);
  });

  it('5. listings are requested in descending createdAt order (same convention as ListingService.getListings)', async () => {
    listingFindManyMock.mockResolvedValue([makeListingRow()]);
    listingCountMock.mockResolvedValue(1);

    await getListingsTool.handler('ws-1', {});

    expect(listingFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));
  });

  it('6. default limit (20) is applied when limit is omitted', async () => {
    listingFindManyMock.mockResolvedValue([]);
    listingCountMock.mockResolvedValue(0);

    await getListingsTool.handler('ws-1', {});

    expect(listingFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
  });

  it('7. a custom limit is applied, and a value above the max of 50 is rejected at validation', async () => {
    listingFindManyMock.mockResolvedValue([]);
    listingCountMock.mockResolvedValue(0);

    await getListingsTool.handler('ws-1', { limit: 5 });
    expect(listingFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));

    expect(getListingsTool.inputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(getListingsTool.inputSchema.safeParse({ limit: 50 }).success).toBe(true);
  });

  it('8. marketplace filter is applied through the MarketplaceConnection relation', async () => {
    listingFindManyMock.mockResolvedValue([]);
    listingCountMock.mockResolvedValue(0);

    await getListingsTool.handler('ws-1', { marketplace: 'ebay' as any });

    const where = listingFindManyMock.mock.calls[0][0].where;
    expect(where.connection).toEqual({ marketplaceId: 'ebay' });
  });

  it('rejects an unknown marketplace value', () => {
    expect(getListingsTool.inputSchema.safeParse({ marketplace: 'amazon' }).success).toBe(false);
  });

  it('9. status filter is applied directly on Listing.status', async () => {
    listingFindManyMock.mockResolvedValue([]);
    listingCountMock.mockResolvedValue(0);

    await getListingsTool.handler('ws-1', { status: 'active' });

    const where = listingFindManyMock.mock.calls[0][0].where;
    expect(where.status).toBe('active');
  });

  it('rejects an unknown/invented status value', () => {
    expect(getListingsTool.inputSchema.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('10. syncStatus filter is applied directly on Listing.syncStatus, independently of status', async () => {
    listingFindManyMock.mockResolvedValue([]);
    listingCountMock.mockResolvedValue(0);

    await getListingsTool.handler('ws-1', { syncStatus: 'failed' });

    const where = listingFindManyMock.mock.calls[0][0].where;
    expect(where.syncStatus).toBe('failed');
    expect(where).not.toHaveProperty('status');
  });

  it('rejects an unknown/invented syncStatus value', () => {
    expect(getListingsTool.inputSchema.safeParse({ syncStatus: 'pending' }).success).toBe(false);
  });

  it('11. productId filter is applied directly, scoped by workspaceId in the same where', async () => {
    listingFindManyMock.mockResolvedValue([]);
    listingCountMock.mockResolvedValue(0);

    await getListingsTool.handler('ws-1', { productId: 'product-1' });

    const where = listingFindManyMock.mock.calls[0][0].where;
    expect(where.productId).toBe('product-1');
    expect(where.workspaceId).toBe('ws-1');
    expect(productFindFirstMock).not.toHaveBeenCalled();
  });

  it('12. sku filter resolves to a productId in the SAME workspace before querying listings', async () => {
    productFindFirstMock.mockResolvedValue({ id: 'product-1' });
    listingFindManyMock.mockResolvedValue([makeListingRow()]);
    listingCountMock.mockResolvedValue(1);

    await getListingsTool.handler('ws-1', { sku: 'SKU-PRADA-1' });

    expect(productFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1', sku: 'SKU-PRADA-1', deletedAt: null } })
    );
    const where = listingFindManyMock.mock.calls[0][0].where;
    expect(where.productId).toBe('product-1');
  });

  it('an unknown sku -> found: false, never a global/unscoped listing query', async () => {
    productFindFirstMock.mockResolvedValue(null);

    const result: any = await getListingsTool.handler('ws-1', { sku: 'DOES-NOT-EXIST' });

    expect(result).toEqual({ found: false, listings: [], totalListings: 0, returnedListings: 0 });
    expect(listingFindManyMock).not.toHaveBeenCalled();
  });

  it('13. combination of filters (status + syncStatus + marketplace) are all applied together', async () => {
    listingFindManyMock.mockResolvedValue([]);
    listingCountMock.mockResolvedValue(0);

    await getListingsTool.handler('ws-1', { status: 'active', syncStatus: 'synced', marketplace: 'etsy' as any });

    const where = listingFindManyMock.mock.calls[0][0].where;
    expect(where.status).toBe('active');
    expect(where.syncStatus).toBe('synced');
    expect(where.connection).toEqual({ marketplaceId: 'etsy' });
  });

  it('14. totalListings reports the REAL total count, even beyond the returned page size', async () => {
    listingFindManyMock.mockResolvedValue([makeListingRow()]);
    listingCountMock.mockResolvedValue(37);

    const result: any = await getListingsTool.handler('ws-1', {});

    expect(result.totalListings).toBe(37);
  });

  it('15. returnedListings reflects the actual number of listings in this page', async () => {
    listingFindManyMock.mockResolvedValue([makeListingRow({ id: 'listing-1' }), makeListingRow({ id: 'listing-2' })]);
    listingCountMock.mockResolvedValue(2);

    const result: any = await getListingsTool.handler('ws-1', {});

    expect(result.returnedListings).toBe(2);
  });

  it('16. found=false when no listing matches', async () => {
    listingFindManyMock.mockResolvedValue([]);
    listingCountMock.mockResolvedValue(0);

    const result: any = await getListingsTool.handler('ws-1', {});

    expect(result.found).toBe(false);
  });

  it('17. the Product relation is joined in the same query (no follow-up query)', async () => {
    listingFindManyMock.mockResolvedValue([makeListingRow()]);
    listingCountMock.mockResolvedValue(1);

    await getListingsTool.handler('ws-1', {});

    expect(listingFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ product: { select: { sku: true } } }) })
    );
  });

  it('18. SKU comes from the joined Product, never invented', async () => {
    listingFindManyMock.mockResolvedValue([makeListingRow({ product: { sku: 'SKU-XYZ' } })]);
    listingCountMock.mockResolvedValue(1);

    const result: any = await getListingsTool.handler('ws-1', {});

    expect(result.listings[0].sku).toBe('SKU-XYZ');
  });

  it('19. single query for listings+product+connection (no N+1), plus one separate count aggregate', async () => {
    listingFindManyMock.mockResolvedValue([makeListingRow(), makeListingRow({ id: 'listing-2' })]);
    listingCountMock.mockResolvedValue(2);

    await getListingsTool.handler('ws-1', {});

    expect(listingFindManyMock).toHaveBeenCalledTimes(1);
    expect(listingCountMock).toHaveBeenCalledTimes(1);
  });

  it('20. never selects/returns MarketplaceConnection secret fields (select is a hard structural boundary, not just a formatter allow-list)', async () => {
    listingFindManyMock.mockResolvedValue([makeListingRow()]);
    listingCountMock.mockResolvedValue(1);

    await getListingsTool.handler('ws-1', {});

    const args = listingFindManyMock.mock.calls[0][0];
    expect(JSON.stringify(args.select)).not.toMatch(/apiKey|apiSecret|oauth|refreshToken|sellerId|accountEmail/i);
  });

  it('21. no secret ever appears in the output, and no profit/margin is invented', async () => {
    listingFindManyMock.mockResolvedValue([makeListingRow()]);
    listingCountMock.mockResolvedValue(1);

    const result: any = await getListingsTool.handler('ws-1', {});
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/apiKey|apiSecret|token|secret|password/i);
    expect(serialized).not.toMatch(/profit|margin/i);
  });

  it('cross-workspace: a productId belonging to another workspace never leaks a listing (workspaceId stays in the same where)', async () => {
    listingFindManyMock.mockImplementation(async ({ where }: any) => (where.workspaceId === 'ws-A' ? [makeListingRow()] : []));
    listingCountMock.mockImplementation(async ({ where }: any) => (where.workspaceId === 'ws-A' ? 1 : 0));

    const result: any = await getListingsTool.handler('ws-B', { productId: 'product-1' });

    expect(result.found).toBe(false);
  });

  it('registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('get_listings')).toBe(getListingsTool);
  });

  it('classified "read"', () => {
    expect(getListingsTool.category).toBe('read');
  });

  it('auto-executable without confirmation', () => {
    expect(AiToolRegistry.isAutoExecutable(getListingsTool.category)).toBe(true);
  });
});
