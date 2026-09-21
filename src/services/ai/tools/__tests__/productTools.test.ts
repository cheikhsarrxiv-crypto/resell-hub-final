/**
 * Real behavioral tests for get_product — a read-only agent tool, same
 * conventions as get_order/get_listing/get_shipment/get_customer:
 * auto-executable, no confirmation, workspace isolation is the real
 * ProductService.getProduct `findFirst({ id, workspaceId })` boundary,
 * plus two additional queries (Inventory, Listing[]) that are ALSO
 * explicitly scoped by workspaceId, never productId alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProductMock, inventoryFindUniqueMock, listingFindManyMock } = vi.hoisted(() => ({
  getProductMock: vi.fn(),
  inventoryFindUniqueMock: vi.fn(),
  listingFindManyMock: vi.fn(),
}));

// create_product (actionTools.ts, itself imported transitively via
// AiToolRegistry) now also imports PRODUCT_SKU_CONFLICT_MESSAGE/
// PRODUCT_SOURCE_CONFLICT_MESSAGE from this module — importActual keeps
// those real (never duplicated/hardcoded here), only ProductService
// itself is replaced, exactly like actionTools.test.ts's own mock.
vi.mock('@/services/ProductService', async () => {
  const actual = await vi.importActual<typeof import('@/services/ProductService')>('@/services/ProductService');
  return { ...actual, ProductService: { getProduct: getProductMock } };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    inventory: { findUnique: inventoryFindUniqueMock },
    listing: { findMany: listingFindManyMock },
  },
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getProductTool } from '@/services/ai/tools/productTools';

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    id: 'product-1',
    workspaceId: 'ws-1',
    sku: 'SKU-PRADA-1',
    supplierSku: 'SUP-999',
    title: 'Prada Cut Out Sneakers',
    description: 'A real description.',
    brand: 'Prada',
    category: 'Sneakers',
    size: '42',
    color: 'White',
    condition: 'like-new',
    purchasePrice: 200,
    sellingPrice: 449,
    fulfillmentCost: 5,
    fees: 15,
    quantity: 3,
    location: 'Shelf A1',
    weightGrams: 900,
    lengthCm: 32,
    widthCm: 22,
    heightCm: 12,
    images: [
      { url: 'https://img.example/main.jpg', isMain: true, order: 0 },
      { url: 'https://img.example/second.jpg', isMain: false, order: 1 },
    ],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeListingRow(overrides: Record<string, any> = {}) {
  return {
    id: 'listing-1',
    title: 'Prada Cut Out Sneakers',
    price: 449,
    quantity: 1,
    status: 'active',
    connection: { marketplace: { name: 'ebay', displayName: 'eBay' } },
    ...overrides,
  };
}

describe('get_product tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as a read tool — auto-executable, no confirmation', () => {
    const tool = AiToolRegistry.get('get_product');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
  });

  it('rejects an input missing productId', () => {
    expect(getProductTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a valid productId input', () => {
    expect(getProductTool.inputSchema.safeParse({ productId: 'product-1' }).success).toBe(true);
  });

  it('existing product in the SAME workspace -> success, full correct mapping', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue({ quantity: 5, reserved: 1, available: 4 });
    listingFindManyMock.mockResolvedValue([makeListingRow()]);

    const result: any = await getProductTool.handler('ws-1', { productId: 'product-1' });

    expect(result.found).toBe(true);
    expect(result.product).toMatchObject({
      productId: 'product-1',
      sku: 'SKU-PRADA-1',
      supplierSku: 'SUP-999',
      title: 'Prada Cut Out Sneakers',
      brand: 'Prada',
      category: 'Sneakers',
      size: '42',
      color: 'White',
      condition: 'like-new',
      purchasePrice: 200,
      sellingPrice: 449,
      fulfillmentCost: 5,
      fees: 15,
      location: 'Shelf A1',
      declaredQuantity: 3,
    });
    expect(result.product.inventory).toEqual({ quantity: 5, reserved: 1, available: 4 });
    expect(result.product.listings).toEqual([
      { listingId: 'listing-1', title: 'Prada Cut Out Sneakers', price: 449, quantity: 1, status: 'active', marketplace: { name: 'ebay', displayName: 'eBay' } },
    ]);
    expect(getProductMock).toHaveBeenCalledWith('product-1', 'ws-1');
  });

  it('unknown product -> controlled { found: false } response, never throws', async () => {
    getProductMock.mockResolvedValue(null);

    const result: any = await getProductTool.handler('ws-1', { productId: 'does-not-exist' });

    expect(result).toEqual({ found: false });
  });

  it('a product belonging to ANOTHER workspace -> refused, reveals nothing (relies on ProductService.getProduct\'s own workspace-scoped query)', async () => {
    getProductMock.mockImplementation(async (productId: string, workspaceId: string) => {
      if (workspaceId !== 'ws-A') return null; // simulates the product being owned by ws-A only
      return makeProduct({ workspaceId: 'ws-A' });
    });

    const result: any = await getProductTool.handler('ws-B', { productId: 'product-1' });

    expect(result).toEqual({ found: false });
    expect(getProductMock).toHaveBeenCalledWith('product-1', 'ws-B');
  });

  it('the listings lookup is scoped by BOTH productId and workspaceId, never productId alone', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(null);
    listingFindManyMock.mockResolvedValue([]);

    await getProductTool.handler('ws-1', { productId: 'product-1' });

    expect(listingFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { productId: 'product-1', workspaceId: 'ws-1', deletedAt: null } })
    );
  });

  it('optional fields absent -> come back null, never invented', async () => {
    getProductMock.mockResolvedValue(
      makeProduct({
        supplierSku: null,
        brand: null,
        category: null,
        size: null,
        color: null,
        location: null,
        weightGrams: null,
        lengthCm: null,
        widthCm: null,
        heightCm: null,
        images: [],
      })
    );
    inventoryFindUniqueMock.mockResolvedValue(null);
    listingFindManyMock.mockResolvedValue([]);

    const result: any = await getProductTool.handler('ws-1', { productId: 'product-1' });

    expect(result.product.supplierSku).toBeNull();
    expect(result.product.brand).toBeNull();
    expect(result.product.category).toBeNull();
    expect(result.product.size).toBeNull();
    expect(result.product.color).toBeNull();
    expect(result.product.location).toBeNull();
    expect(result.product.shipping).toBeNull();
    expect(result.product.inventory).toBeNull();
    expect(result.product.images).toEqual([]);
    expect(result.product.listings).toEqual([]);
  });

  it('declaredQuantity (Product.quantity) and inventory (live stock) are both returned, kept distinct — never one deduced from the other', async () => {
    getProductMock.mockResolvedValue(makeProduct({ quantity: 10 }));
    inventoryFindUniqueMock.mockResolvedValue({ quantity: 8, reserved: 2, available: 6 });
    listingFindManyMock.mockResolvedValue([]);

    const result: any = await getProductTool.handler('ws-1', { productId: 'product-1' });

    expect(result.product.declaredQuantity).toBe(10);
    expect(result.product.inventory).toEqual({ quantity: 8, reserved: 2, available: 6 });
    expect(inventoryFindUniqueMock).toHaveBeenCalledWith({
      where: { productId_workspaceId: { productId: 'product-1', workspaceId: 'ws-1' } },
      select: { quantity: true, reserved: true, available: true },
    });
  });

  it('a product listed on several marketplaces returns ALL of its listings, never assumes exactly one', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(null);
    listingFindManyMock.mockResolvedValue([
      makeListingRow({ id: 'listing-ebay', connection: { marketplace: { name: 'ebay', displayName: 'eBay' } } }),
      makeListingRow({ id: 'listing-etsy', connection: { marketplace: { name: 'etsy', displayName: 'Etsy' } } }),
    ]);

    const result: any = await getProductTool.handler('ws-1', { productId: 'product-1' });

    expect(result.product.listings).toHaveLength(2);
    expect(result.product.listings.map((l: any) => l.marketplace.name)).toEqual(['ebay', 'etsy']);
  });

  it('shipping (package dimensions) is returned only when at least one dimension is stored', async () => {
    getProductMock.mockResolvedValue(makeProduct({ weightGrams: 500, lengthCm: null, widthCm: null, heightCm: null }));
    inventoryFindUniqueMock.mockResolvedValue(null);
    listingFindManyMock.mockResolvedValue([]);

    const result: any = await getProductTool.handler('ws-1', { productId: 'product-1' });

    expect(result.product.shipping).toEqual({ weightGrams: 500, lengthCm: null, widthCm: null, heightCm: null });
  });

  it('is a pure read — calls ProductService.getProduct exactly once, no marketplace/adapter call', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(null);
    listingFindManyMock.mockResolvedValue([]);

    await getProductTool.handler('ws-1', { productId: 'product-1' });

    expect(getProductMock).toHaveBeenCalledTimes(1);
    expect(inventoryFindUniqueMock).toHaveBeenCalledTimes(1);
    expect(listingFindManyMock).toHaveBeenCalledTimes(1);
  });

  it('registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('get_product')).toBe(getProductTool);
  });

  it('classified "read" and auto-executable without confirmation', () => {
    expect(getProductTool.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable(getProductTool.category)).toBe(true);
  });
});
