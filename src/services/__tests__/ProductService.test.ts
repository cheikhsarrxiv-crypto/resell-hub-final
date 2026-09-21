/**
 * Product-creation hardening fix — tests for ProductService.createProduct's
 * two CRITICAL corrections identified by the read-only Product-workflow
 * audit:
 *   1. Product + Inventory are no longer two separate, non-atomic writes —
 *      they now commit or roll back together inside one Prisma
 *      interactive transaction.
 *   2. A (workspaceId, sku) collision (Prisma P2002 on the existing
 *      @@unique([workspaceId, sku]) constraint) is turned into a clean,
 *      dedicated business error (PRODUCT_SKU_CONFLICT_MESSAGE) — never the
 *      raw Prisma message, never a second Product, never an automatic
 *      SKU substitution or retry.
 *
 * prisma.$transaction is mocked with REAL rollback semantics (a staging
 * Map merged into the real store only if the callback resolves, discarded
 * if it throws) — not a mock of createProduct itself — so Test B below
 * genuinely exercises the transaction's rollback behavior, not just an
 * assertion about which mocks were called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { productStore, inventoryStore } = vi.hoisted(() => ({
  productStore: new Map<string, any>(),
  inventoryStore: new Map<string, any>(), // key: `${productId}:${workspaceId}`
}));

let productIdCounter = 0;
// Toggled per-test to simulate Inventory.create failing INSIDE the
// transaction, after Product.create already ran — the exact crash
// scenario Test B reproduces.
let simulateInventoryCreateFailure = false;

function findExistingProductBySku(workspaceId: string, sku: string, extraCandidates: Map<string, any>) {
  for (const existing of [...productStore.values(), ...extraCandidates.values()]) {
    if (existing.workspaceId === workspaceId && existing.sku === sku) return existing;
  }
  return undefined;
}

/** A faithful in-memory stand-in for a real Prisma interactive transaction: writes made through `tx` land in a staging area, merged into the real store only on successful completion, discarded entirely if the callback throws. */
function makeTransactionalPrismaMock() {
  return vi.fn(async (callback: (tx: any) => Promise<any>) => {
    const stagingProducts = new Map<string, any>();
    const stagingInventories = new Map<string, any>();

    const tx = {
      product: {
        create: vi.fn(async ({ data }: any) => {
          if (findExistingProductBySku(data.workspaceId, data.sku, stagingProducts)) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`workspaceId`,`sku`)', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          const id = `product-${++productIdCounter}`;
          const row = { id, deletedAt: null, ...data };
          stagingProducts.set(id, row);
          return { ...row };
        }),
      },
      inventory: {
        create: vi.fn(async ({ data }: any) => {
          if (simulateInventoryCreateFailure) {
            throw new Error('Simulated Inventory.create failure (DB unavailable)');
          }
          const key = `${data.productId}:${data.workspaceId}`;
          const row = { ...data };
          stagingInventories.set(key, row);
          return { ...row };
        }),
      },
    };

    // No try/catch here: a throw from the callback must propagate
    // unmodified to the caller (exactly like a real Prisma transaction
    // rejecting with the original error) — and, critically, must never
    // reach the merge-into-real-store step below. This IS the rollback:
    // staging is simply discarded by never being merged.
    const result = await callback(tx);

    for (const [k, v] of stagingProducts) productStore.set(k, v);
    for (const [k, v] of stagingInventories) inventoryStore.set(k, v);

    return result;
  });
}

const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workspace: { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id })) },
    $transaction: transactionMock,
  },
}));

vi.mock('@/services/SubscriptionService', () => ({
  SubscriptionService: { isLimitReached: vi.fn(async () => false) },
}));

import { ProductService, PRODUCT_SKU_CONFLICT_MESSAGE } from '@/services/ProductService';
import type { CreateProductInput } from '@/lib/validations';

function baseInput(overrides: Partial<CreateProductInput> = {}): CreateProductInput {
  return {
    title: 'Prada Cut Out Sneakers',
    description: 'A real description of the item, at least twenty characters long.',
    condition: 'used',
    purchasePrice: 200,
    sellingPrice: 449,
    fulfillmentCost: 0,
    quantity: 1,
    ...overrides,
  } as CreateProductInput;
}

beforeEach(() => {
  productStore.clear();
  inventoryStore.clear();
  productIdCounter = 0;
  simulateInventoryCreateFailure = false;
  transactionMock.mockReset();
  transactionMock.mockImplementation(makeTransactionalPrismaMock());
});

describe('ProductService.createProduct — atomicity (Product + Inventory)', () => {
  it('TEST A — a successful call commits both Product and Inventory together, values unchanged from prior behavior', async () => {
    const product = await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-A', quantity: 3 }));

    expect(productStore.size).toBe(1);
    expect(inventoryStore.size).toBe(1);

    const storedProduct = productStore.get(product.id);
    expect(storedProduct.workspaceId).toBe('ws-1');
    expect(storedProduct.sku).toBe('SKU-A');
    expect(storedProduct.title).toBe('Prada Cut Out Sneakers');

    const storedInventory = inventoryStore.get(`${product.id}:ws-1`);
    expect(storedInventory).toBeDefined();
    expect(storedInventory.productId).toBe(product.id);
    expect(storedInventory.workspaceId).toBe('ws-1');
    expect(storedInventory.quantity).toBe(3);
    expect(storedInventory.available).toBe(3);
    expect(storedInventory.reserved).toBe(0);
    expect(storedInventory.syncStatus).toBe('synced');
  });

  it('TEST B — Inventory.create failing inside the transaction rolls back the Product too: no partial row of either kind remains', async () => {
    simulateInventoryCreateFailure = true;

    await expect(ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-B' }))).rejects.toThrow(
      'Simulated Inventory.create failure'
    );

    // The real assertion this fix exists for: genuinely nothing committed,
    // not "createProduct was mocked to look like it failed cleanly".
    expect(productStore.size).toBe(0);
    expect(inventoryStore.size).toBe(0);
  });

  it('a workspace-limit refusal (thrown before the transaction) still leaves nothing committed, unchanged from before', async () => {
    const { SubscriptionService } = await import('@/services/SubscriptionService');
    (SubscriptionService.isLimitReached as any).mockResolvedValueOnce(true);

    await expect(ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-LIMIT' }))).rejects.toThrow(
      'Product limit reached for your plan'
    );

    expect(productStore.size).toBe(0);
    expect(inventoryStore.size).toBe(0);
    expect(transactionMock).not.toHaveBeenCalled(); // never even reaches the transaction
  });
});

describe('ProductService.createProduct — SKU conflict (P2002)', () => {
  it('TEST C — a second create with the same (workspace, sku) is refused with the clean business error, never the raw Prisma message, no second Product created', async () => {
    await ProductService.createProduct('ws-A', baseInput({ sku: 'TEST-SKU' }));
    expect(productStore.size).toBe(1);

    await expect(ProductService.createProduct('ws-A', baseInput({ sku: 'TEST-SKU', title: 'A different title' }))).rejects.toThrow(
      PRODUCT_SKU_CONFLICT_MESSAGE
    );

    // Never the raw Prisma wording.
    await ProductService.createProduct('ws-A', baseInput({ sku: 'TEST-SKU-2' })).catch(() => {});
    try {
      await ProductService.createProduct('ws-A', baseInput({ sku: 'TEST-SKU' }));
      throw new Error('expected createProduct to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(PRODUCT_SKU_CONFLICT_MESSAGE);
      expect((error as Error).message).not.toMatch(/unique constraint/i);
      expect((error as Error).message).not.toMatch(/prisma/i);
    }

    // Still exactly the two legitimately-created products (TEST-SKU, TEST-SKU-2) — the conflicting attempts never created anything.
    expect(productStore.size).toBe(2);
  });

  it('TEST D — the same SKU in two DIFFERENT workspaces both succeed (the constraint is workspace-scoped)', async () => {
    const productA = await ProductService.createProduct('ws-A', baseInput({ sku: 'SHARED-SKU' }));
    const productB = await ProductService.createProduct('ws-B', baseInput({ sku: 'SHARED-SKU' }));

    expect(productA.id).not.toBe(productB.id);
    expect(productStore.size).toBe(2);
    expect(productStore.get(productA.id).workspaceId).toBe('ws-A');
    expect(productStore.get(productB.id).workspaceId).toBe('ws-B');
    expect(inventoryStore.size).toBe(2);
  });

  it('a conflict never modifies the SKU that was supplied, and the surviving product keeps its original SKU', async () => {
    const first = await ProductService.createProduct('ws-A', baseInput({ sku: 'STABLE-SKU' }));

    await expect(ProductService.createProduct('ws-A', baseInput({ sku: 'STABLE-SKU' }))).rejects.toThrow(PRODUCT_SKU_CONFLICT_MESSAGE);

    expect(productStore.get(first.id).sku).toBe('STABLE-SKU');
    expect(productStore.size).toBe(1);
  });
});

describe('ProductService.createProduct — unchanged behavior (TEST E)', () => {
  it('auto-generates a SKU (SKU-<timestamp>) when none is supplied, exactly like before', async () => {
    const product = await ProductService.createProduct('ws-1', baseInput({ sku: undefined }));
    expect(product.sku).toMatch(/^SKU-\d+$/);
  });

  it('defaults description to an empty string when omitted, exactly like before', async () => {
    const input = baseInput();
    delete (input as any).description;
    const product = await ProductService.createProduct('ws-1', input);
    expect(productStore.get(product.id).description).toBe('');
  });

  it('Inventory is created with the same quantity/available/reserved/syncStatus shape as before for a representative input', async () => {
    const product = await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-SHAPE', quantity: 5 }));
    const inventory = inventoryStore.get(`${product.id}:ws-1`);
    expect(inventory).toEqual({
      productId: product.id,
      workspaceId: 'ws-1',
      quantity: 5,
      available: 5,
      reserved: 0,
      syncStatus: 'synced',
    });
  });

  it('condition/purchasePrice/sellingPrice/fulfillmentCost pass through to Product unchanged', async () => {
    const product = await ProductService.createProduct(
      'ws-1',
      baseInput({ sku: 'SKU-FIELDS', condition: 'new', purchasePrice: 100, sellingPrice: 250, fulfillmentCost: 12 })
    );
    const stored = productStore.get(product.id);
    expect(stored.condition).toBe('new');
    expect(stored.purchasePrice).toBe(100);
    expect(stored.sellingPrice).toBe(250);
    expect(stored.fulfillmentCost).toBe(12);
  });
});
