/**
 * Real behavioral tests for get_inventory — a read-only agent tool, same
 * conventions as get_order/get_listing/get_shipment/get_customer/get_product:
 * auto-executable, no confirmation, workspace isolation is the real
 * ProductService.getProduct `findFirst({ id, workspaceId })` boundary (or,
 * for a SKU lookup, an equally workspace-scoped `findFirst({ sku,
 * workspaceId })`) followed by the exact (productId, workspaceId)
 * compound key for Inventory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProductMock, productFindFirstMock, inventoryFindUniqueMock } = vi.hoisted(() => ({
  getProductMock: vi.fn(),
  productFindFirstMock: vi.fn(),
  inventoryFindUniqueMock: vi.fn(),
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
    product: { findFirst: productFindFirstMock },
    inventory: { findUnique: inventoryFindUniqueMock },
  },
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getInventoryTool } from '@/services/ai/tools/inventoryTools';

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    id: 'product-1',
    workspaceId: 'ws-1',
    sku: 'SKU-PRADA-1',
    title: 'Prada Cut Out Sneakers',
    quantity: 10,
    ...overrides,
  };
}

function makeInventory(overrides: Record<string, any> = {}) {
  return {
    quantity: 8,
    reserved: 2,
    available: 6,
    syncStatus: 'synced',
    syncError: null,
    lastSyncedAt: new Date('2026-02-01T00:00:00Z'),
    ...overrides,
  };
}

describe('get_inventory tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as a read tool — auto-executable, no confirmation', () => {
    const tool = AiToolRegistry.get('get_inventory');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
  });

  it('rejects an input with neither productId nor sku', () => {
    expect(getInventoryTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a valid productId input', () => {
    expect(getInventoryTool.inputSchema.safeParse({ productId: 'product-1' }).success).toBe(true);
  });

  it('accepts a valid sku input', () => {
    expect(getInventoryTool.inputSchema.safeParse({ sku: 'SKU-1' }).success).toBe(true);
  });

  it('1. correct retrieval of an inventory by productId', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(makeInventory());

    const result: any = await getInventoryTool.handler('ws-1', { productId: 'product-1' });

    expect(result.found).toBe(true);
    expect(getProductMock).toHaveBeenCalledWith('product-1', 'ws-1');
  });

  it('2. productId is correctly returned', async () => {
    getProductMock.mockResolvedValue(makeProduct({ id: 'product-42' }));
    inventoryFindUniqueMock.mockResolvedValue(makeInventory());

    const result: any = await getInventoryTool.handler('ws-1', { productId: 'product-42' });

    expect(result.inventory.productId).toBe('product-42');
  });

  it('3. quantity is correctly returned from the real Inventory row', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(makeInventory({ quantity: 15 }));

    const result: any = await getInventoryTool.handler('ws-1', { productId: 'product-1' });

    expect(result.inventory.quantity).toBe(15);
  });

  it('4. reserved is correctly returned', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(makeInventory({ reserved: 4 }));

    const result: any = await getInventoryTool.handler('ws-1', { productId: 'product-1' });

    expect(result.inventory.reserved).toBe(4);
  });

  it('5. available is correctly returned', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(makeInventory({ available: 11 }));

    const result: any = await getInventoryTool.handler('ws-1', { productId: 'product-1' });

    expect(result.inventory.available).toBe(11);
  });

  it('6. declaredQuantity (Product.quantity) is kept clearly distinct from real inventory numbers — never merged', async () => {
    getProductMock.mockResolvedValue(makeProduct({ quantity: 99 }));
    inventoryFindUniqueMock.mockResolvedValue(makeInventory({ quantity: 8, reserved: 2, available: 6 }));

    const result: any = await getInventoryTool.handler('ws-1', { productId: 'product-1' });

    expect(result.inventory.declaredQuantity).toBe(99);
    expect(result.inventory.quantity).toBe(8);
    expect(result.inventory.available).toBe(6);
    expect(result.inventory.declaredQuantity).not.toBe(result.inventory.quantity);
  });

  it('7. workspace isolation: workspace B looking up the SAME productId as workspace A gets nothing (relies on ProductService.getProduct\'s own workspace-scoped query)', async () => {
    getProductMock.mockImplementation(async (productId: string, workspaceId: string) => {
      if (workspaceId !== 'ws-A') return null; // simulates the product being owned by ws-A only
      return makeProduct({ workspaceId: 'ws-A' });
    });

    const result: any = await getInventoryTool.handler('ws-B', { productId: 'product-1' });

    expect(result).toEqual({ found: false });
    expect(getProductMock).toHaveBeenCalledWith('product-1', 'ws-B');
    expect(inventoryFindUniqueMock).not.toHaveBeenCalled();
  });

  it('8. non-existent product -> controlled { found: false }, never throws', async () => {
    getProductMock.mockResolvedValue(null);

    const result: any = await getInventoryTool.handler('ws-1', { productId: 'does-not-exist' });

    expect(result).toEqual({ found: false });
  });

  it('9. product exists but has no Inventory row -> { found: false }, never fabricated stock numbers', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(null);

    const result: any = await getInventoryTool.handler('ws-1', { productId: 'product-1' });

    expect(result).toEqual({ found: false });
  });

  it('10. no secret/technical noise ever appears in the output', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(makeInventory());

    const result: any = await getInventoryTool.handler('ws-1', { productId: 'product-1' });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/apiKey|apiSecret|token|secret|password/i);
  });

  it('11. syncError/lastSyncedAt come back null when absent, never invented', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(makeInventory({ syncError: null, lastSyncedAt: null }));

    const result: any = await getInventoryTool.handler('ws-1', { productId: 'product-1' });

    expect(result.inventory.syncError).toBeNull();
    expect(result.inventory.lastSyncedAt).toBeNull();
  });

  it('12. registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('get_inventory')).toBe(getInventoryTool);
  });

  it('13. classified "read"', () => {
    expect(getInventoryTool.category).toBe('read');
  });

  it('14. auto-executable without confirmation', () => {
    expect(AiToolRegistry.isAutoExecutable(getInventoryTool.category)).toBe(true);
  });

  it('15. the same productId string looked up from two different workspaces resolves independently — never a global, unscoped lookup', async () => {
    getProductMock.mockImplementation(async (productId: string, workspaceId: string) => {
      if (workspaceId === 'ws-A') return makeProduct({ id: 'product-shared', workspaceId: 'ws-A', sku: 'SKU-A' });
      if (workspaceId === 'ws-B') return makeProduct({ id: 'product-shared', workspaceId: 'ws-B', sku: 'SKU-B' });
      return null;
    });
    inventoryFindUniqueMock.mockImplementation(async ({ where }: any) => {
      if (where.productId_workspaceId.workspaceId === 'ws-A') return makeInventory({ available: 6 });
      return makeInventory({ available: 99 });
    });

    const resultA: any = await getInventoryTool.handler('ws-A', { productId: 'product-shared' });
    const resultB: any = await getInventoryTool.handler('ws-B', { productId: 'product-shared' });

    expect(resultA.inventory.sku).toBe('SKU-A');
    expect(resultA.inventory.available).toBe(6);
    expect(resultB.inventory.sku).toBe('SKU-B');
    expect(resultB.inventory.available).toBe(99);
  });

  describe('SKU lookup', () => {
    it('resolves a product by SKU, scoped by BOTH sku and workspaceId, never sku alone', async () => {
      productFindFirstMock.mockResolvedValue(makeProduct());
      inventoryFindUniqueMock.mockResolvedValue(makeInventory());

      const result: any = await getInventoryTool.handler('ws-1', { sku: 'SKU-PRADA-1' });

      expect(result.found).toBe(true);
      expect(productFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sku: 'SKU-PRADA-1', workspaceId: 'ws-1', deletedAt: null } })
      );
      expect(getProductMock).not.toHaveBeenCalled();
    });

    it('unknown SKU -> controlled { found: false }', async () => {
      productFindFirstMock.mockResolvedValue(null);

      const result: any = await getInventoryTool.handler('ws-1', { sku: 'DOES-NOT-EXIST' });

      expect(result).toEqual({ found: false });
    });
  });

  it('is a pure read — calls only ProductService.getProduct and prisma.inventory.findUnique, nothing else', async () => {
    getProductMock.mockResolvedValue(makeProduct());
    inventoryFindUniqueMock.mockResolvedValue(makeInventory());

    await getInventoryTool.handler('ws-1', { productId: 'product-1' });

    expect(getProductMock).toHaveBeenCalledTimes(1);
    expect(inventoryFindUniqueMock).toHaveBeenCalledTimes(1);
  });
});
