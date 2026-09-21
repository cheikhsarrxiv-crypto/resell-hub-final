/**
 * Product-creation hardening fix + source provenance (Option A) — tests
 * for ProductService.createProduct's corrections:
 *   1. Product + Inventory are no longer two separate, non-atomic writes —
 *      they now commit or roll back together inside one Prisma
 *      interactive transaction.
 *   2. A (workspaceId, sku) collision (Prisma P2002 on the existing
 *      @@unique([workspaceId, sku]) constraint) is turned into a clean,
 *      dedicated business error (PRODUCT_SKU_CONFLICT_MESSAGE) — never the
 *      raw Prisma message, never a second Product, never an automatic
 *      SKU substitution or retry.
 *   3. A (workspaceId, sourceMarketplace, sourceId) collision (P2002 on
 *      the new @@unique constraint) is turned into a separate, correctly
 *      attributed business error (PRODUCT_SOURCE_CONFLICT_MESSAGE), never
 *      confused with a SKU conflict.
 *
 * prisma.$transaction is mocked with REAL rollback semantics (a staging
 * Map merged into the real store only if the callback resolves, discarded
 * if it throws) — not a mock of createProduct itself — so Test B/J below
 * genuinely exercise the transaction's rollback behavior, not just an
 * assertion about which mocks were called.
 *
 * The mocked tx.product.create's uniqueness checks faithfully reproduce
 * real Postgres multi-column UNIQUE semantics: two rows only conflict on
 * (workspaceId, sourceMarketplace, sourceId) when ALL THREE are non-null
 * and equal — NULL is never equal to NULL, or to anything else, so a
 * Product with no provenance (either field null) never conflicts with
 * another on this constraint, exactly like a real Postgres UNIQUE index
 * over nullable columns.
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
// scenario Test B/J reproduces.
let simulateInventoryCreateFailure = false;

function findConflictingProduct(candidates: Iterable<any>, predicate: (existing: any) => boolean) {
  for (const existing of candidates) {
    if (predicate(existing)) return existing;
  }
  return undefined;
}

function p2002(message: string, target: string[]) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

/**
 * A faithful in-memory stand-in for a real Prisma interactive transaction:
 * writes made through `tx` land in a staging area, merged into the real
 * store only on successful completion, discarded entirely if the callback
 * throws (rollback — see Test B/J).
 *
 * CONCURRENCY MODELING, STATED EXPLICITLY (Étape 7/K's own honesty
 * requirement): this mock does NOT simulate real Postgres row-locking —
 * there is no real database in this sandbox to test against (network
 * egress to the configured DB is blocked here). What it DOES faithfully
 * reproduce is the real, externally-observable OUTCOME a UNIQUE
 * constraint guarantees: the uniqueness check is deliberately NOT
 * performed inside tx.product.create (against a snapshot each concurrent
 * "transaction" would take independently, which would let two racing
 * transactions both pass and both commit — a false pass this mock
 * specifically avoids) but at the commit/merge step, evaluated
 * synchronously against the single shared, canonical productStore right
 * before merging into it. Because this merge step itself has no `await`
 * inside it, two concurrent callers of makeTransactionalPrismaMock can
 * genuinely interleave up to this point (exactly like two real concurrent
 * requests would), but exactly one of them wins the synchronous
 * check-then-merge — never both. Test K exercises this specifically and
 * documents this same limitation again at the point of use.
 */
function makeTransactionalPrismaMock() {
  return vi.fn(async (callback: (tx: any) => Promise<any>) => {
    const stagingProducts = new Map<string, any>();
    const stagingInventories = new Map<string, any>();

    const tx = {
      product: {
        create: vi.fn(async ({ data }: any) => {
          const id = `product-${++productIdCounter}`;
          const row = { id, deletedAt: null, sourceMarketplace: null, sourceId: null, sourceUrl: null, ...data };
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

    // The real uniqueness enforcement point (see this function's own
    // header comment): checked synchronously against the shared,
    // canonical productStore — never against a per-transaction snapshot —
    // right before merging, so a conflict against a row committed by a
    // DIFFERENT, already-finished transaction is always caught here.
    for (const row of stagingProducts.values()) {
      const skuConflict = findConflictingProduct(
        productStore.values(),
        (existing) => existing.workspaceId === row.workspaceId && existing.sku === row.sku
      );
      if (skuConflict) {
        throw p2002('Unique constraint failed on the fields: (`workspaceId`,`sku`)', ['workspaceId', 'sku']);
      }

      // Real Postgres UNIQUE semantics: only conflicts when BOTH
      // sourceMarketplace AND sourceId are non-null on the new row — NULL
      // never equals NULL, so a Product with no provenance never trips
      // this check, matching a real nullable multi-column index.
      if (row.sourceMarketplace != null && row.sourceId != null) {
        const sourceConflict = findConflictingProduct(
          productStore.values(),
          (existing) =>
            existing.workspaceId === row.workspaceId &&
            existing.sourceMarketplace === row.sourceMarketplace &&
            existing.sourceId === row.sourceId
        );
        if (sourceConflict) {
          throw p2002('Unique constraint failed on the fields: (`workspaceId`,`sourceMarketplace`,`sourceId`)', [
            'workspaceId',
            'sourceMarketplace',
            'sourceId',
          ]);
        }
      }
    }

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

import { ProductService, PRODUCT_SKU_CONFLICT_MESSAGE, PRODUCT_SOURCE_CONFLICT_MESSAGE } from '@/services/ProductService';
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

describe('ProductService.createProduct — source provenance (Option A)', () => {
  it('TEST A — a manually-created product (no provenance given) succeeds, with all three provenance fields NULL', async () => {
    const product = await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-MANUAL' }));

    expect(productStore.get(product.id).sourceMarketplace).toBeNull();
    expect(productStore.get(product.id).sourceId).toBeNull();
    expect(productStore.get(product.id).sourceUrl).toBeNull();
  });

  it('TEST B — a product created with eBay provenance persists all three fields exactly as given, never transformed', async () => {
    const product = await ProductService.createProduct(
      'ws-1',
      baseInput({ sku: 'SKU-EBAY-1', sourceMarketplace: 'ebay', sourceId: 'v1|111111111|0', sourceUrl: 'https://www.ebay.co.uk/itm/111111111' })
    );

    const stored = productStore.get(product.id);
    expect(stored.sourceMarketplace).toBe('ebay');
    expect(stored.sourceId).toBe('v1|111111111|0');
    expect(stored.sourceUrl).toBe('https://www.ebay.co.uk/itm/111111111');
  });

  it('TEST C — the same provenance twice in the same workspace: the second create is refused, no second Product exists', async () => {
    await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-DUP-1', sourceMarketplace: 'ebay', sourceId: 'ITEM-X' }));
    expect(productStore.size).toBe(1);

    await expect(
      ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-DUP-2', sourceMarketplace: 'ebay', sourceId: 'ITEM-X' }))
    ).rejects.toThrow(PRODUCT_SOURCE_CONFLICT_MESSAGE);

    expect(productStore.size).toBe(1); // still exactly one — the conflicting attempt created nothing
  });

  it('TEST D — the same provenance in two DIFFERENT workspaces both succeed (workspace-scoped, no global key)', async () => {
    const productA = await ProductService.createProduct('ws-A', baseInput({ sku: 'SKU-A', sourceMarketplace: 'ebay', sourceId: 'ITEM-SHARED' }));
    const productB = await ProductService.createProduct('ws-B', baseInput({ sku: 'SKU-B', sourceMarketplace: 'ebay', sourceId: 'ITEM-SHARED' }));

    expect(productA.id).not.toBe(productB.id);
    expect(productStore.size).toBe(2);
  });

  it('TEST E — two products with no provenance at all both succeed (NULL is never equal to NULL)', async () => {
    const productA = await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-NONE-1' }));
    const productB = await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-NONE-2' }));

    expect(productA.id).not.toBe(productB.id);
    expect(productStore.size).toBe(2);
  });

  it('TEST F — the same sourceId under a DIFFERENT marketplace/provider is allowed (ebay/123 and etsy/123 are not the same provenance)', async () => {
    const productEbay = await ProductService.createProduct('ws-A', baseInput({ sku: 'SKU-EBAY-123', sourceMarketplace: 'ebay', sourceId: '123' }));
    const productEtsy = await ProductService.createProduct('ws-A', baseInput({ sku: 'SKU-ETSY-123', sourceMarketplace: 'etsy', sourceId: '123' }));

    expect(productEbay.id).not.toBe(productEtsy.id);
    expect(productStore.size).toBe(2);
  });

  it('TEST G — same provenance, different SKU: refused as a SOURCE conflict, never mislabeled as a SKU conflict', async () => {
    await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-ORIGINAL', sourceMarketplace: 'ebay', sourceId: 'ITEM-G' }));

    try {
      await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-COMPLETELY-DIFFERENT', sourceMarketplace: 'ebay', sourceId: 'ITEM-G' }));
      throw new Error('expected createProduct to reject');
    } catch (error) {
      expect((error as Error).message).toBe(PRODUCT_SOURCE_CONFLICT_MESSAGE);
      expect((error as Error).message).not.toBe(PRODUCT_SKU_CONFLICT_MESSAGE);
    }
  });

  it('TEST H — same SKU, different provenance: refused as a SKU conflict, never mislabeled as a SOURCE conflict', async () => {
    await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-SHARED-H', sourceMarketplace: 'ebay', sourceId: 'ITEM-H1' }));

    try {
      await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-SHARED-H', sourceMarketplace: 'ebay', sourceId: 'ITEM-H2' }));
      throw new Error('expected createProduct to reject');
    } catch (error) {
      expect((error as Error).message).toBe(PRODUCT_SKU_CONFLICT_MESSAGE);
      expect((error as Error).message).not.toBe(PRODUCT_SOURCE_CONFLICT_MESSAGE);
    }
  });

  it('TEST I — a source conflict leaves no orphaned Inventory row: the whole attempt commits nothing', async () => {
    await ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-I-1', sourceMarketplace: 'ebay', sourceId: 'ITEM-I' }));
    expect(inventoryStore.size).toBe(1);

    await expect(
      ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-I-2', sourceMarketplace: 'ebay', sourceId: 'ITEM-I' }))
    ).rejects.toThrow(PRODUCT_SOURCE_CONFLICT_MESSAGE);

    expect(productStore.size).toBe(1);
    expect(inventoryStore.size).toBe(1); // still exactly one — no orphaned Inventory from the refused attempt
  });

  it('TEST J — Inventory.create failing rolls back a Product created WITH provenance too, exactly like the plain case', async () => {
    simulateInventoryCreateFailure = true;

    await expect(
      ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-J', sourceMarketplace: 'ebay', sourceId: 'ITEM-J' }))
    ).rejects.toThrow('Simulated Inventory.create failure');

    expect(productStore.size).toBe(0);
    expect(inventoryStore.size).toBe(0);
  });

  it(
    'TEST K — two concurrent creates with exactly the same provenance: exactly one succeeds, the other is refused, never two Products. ' +
      'LIMITATION (documented per Étape 7/K): this exercises the mocked transaction\'s commit-time uniqueness check (see makeTransactionalPrismaMock\'s ' +
      'own header comment) — it proves the expected OUTCOME of the real DB constraint under a race, not real Postgres row-locking, which cannot be ' +
      'exercised without a live database (unreachable in this sandbox — network egress to the configured DB is blocked here).',
    async () => {
      const attempt1 = ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-RACE-1', sourceMarketplace: 'ebay', sourceId: 'ITEM-RACE' }));
      const attempt2 = ProductService.createProduct('ws-1', baseInput({ sku: 'SKU-RACE-2', sourceMarketplace: 'ebay', sourceId: 'ITEM-RACE' }));

      const results = await Promise.allSettled([attempt1, attempt2]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toBe(PRODUCT_SOURCE_CONFLICT_MESSAGE);
      expect(productStore.size).toBe(1); // never two Products for the same race
    }
  );
});
