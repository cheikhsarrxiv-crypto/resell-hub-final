/**
 * End-to-end integration tests for the real create_product tool driven
 * through the REAL AiActionService (propose -> confirm -> execute) AND
 * the REAL ProductService (atomic Product+Inventory transaction, SKU/
 * source P2002 -> clean-error mapping) — mirrors
 * publish-listing-pipeline-integration.test.ts's own structure exactly,
 * adapted for create_product's own collaborator (ProductService instead
 * of getAuthenticatedAdapter/EbayAdapter).
 *
 * prisma.$transaction is mocked with REAL rollback/commit-time-uniqueness
 * semantics (the same technique already used in ProductService.test.ts —
 * see that file's own header comment for exactly what is and isn't
 * faithfully simulated, in particular around concurrency: this proves the
 * expected OUTCOME of the real DB constraints under a race, not real
 * Postgres row-locking, which cannot be exercised without a live database
 * — unreachable in this sandbox, confirmed directly during this task).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

interface FakeMessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
}

const { messageRows, actionStore, conversationOwners, productStore, transactionMock } = vi.hoisted(() => ({
  messageRows: [] as FakeMessageRow[],
  actionStore: new Map<string, any>(),
  conversationOwners: new Map<string, string>(), // conversationId -> workspaceId
  productStore: new Map<string, any>(),
  // Placeholder here (referenced directly by vi.mock('@/lib/prisma', ...)
  // below, so it must itself be hoisted) — its real implementation is
  // assigned via mockImplementation after this module finishes loading
  // (see setTransactionMockImplementation), the same two-step pattern
  // ProductService.test.ts already uses for the identical TDZ reason.
  transactionMock: vi.fn(),
}));

let rowIdCounter = 0;
let clock = 0;
let actionIdCounter = 0;
let productIdCounter = 0;
// Toggled per-test to simulate Inventory.create failing INSIDE
// ProductService's own transaction, after Product.create already ran.
let simulateInventoryCreateFailure = false;

function matchesAction(row: any, where: any): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.workspaceId !== undefined && row.workspaceId !== where.workspaceId) return false;
  if (where.idempotencyKey !== undefined && row.idempotencyKey !== where.idempotencyKey) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  return true;
}

function p2002(message: string, target: string[]) {
  return new Prisma.PrismaClientKnownRequestError(message, { code: 'P2002', clientVersion: 'test', meta: { target } });
}

function findConflict(candidates: Iterable<any>, predicate: (existing: any) => boolean) {
  for (const existing of candidates) {
    if (predicate(existing)) return existing;
  }
  return undefined;
}

/** Same commit-time-uniqueness-check transaction mock as ProductService.test.ts — see this file's own header comment for exactly what it does and doesn't prove about concurrency. Assigned in beforeEach, not at module scope, to avoid the same vi.mock hoisting TDZ issue documented in ProductService.test.ts. */
function setTransactionMockImplementation() {
  transactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
  const stagingProducts = new Map<string, any>();

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
      create: vi.fn(async () => {
        if (simulateInventoryCreateFailure) {
          throw new Error('Simulated Inventory.create failure (DB unavailable)');
        }
        return {};
      }),
    },
  };

  const result = await callback(tx);

  for (const row of stagingProducts.values()) {
    const skuConflict = findConflict(productStore.values(), (e) => e.workspaceId === row.workspaceId && e.sku === row.sku);
    if (skuConflict) {
      throw p2002('Unique constraint failed on the fields: (`workspaceId`,`sku`)', ['workspaceId', 'sku']);
    }
    if (row.sourceMarketplace != null && row.sourceId != null) {
      const sourceConflict = findConflict(
        productStore.values(),
        (e) => e.workspaceId === row.workspaceId && e.sourceMarketplace === row.sourceMarketplace && e.sourceId === row.sourceId
      );
      if (sourceConflict) {
        throw p2002('Unique constraint failed on the fields: (`workspaceId`,`sourceMarketplace`,`sourceId`)', ['workspaceId', 'sourceMarketplace', 'sourceId']);
      }
    }
  }

  for (const [k, v] of stagingProducts) productStore.set(k, v);
  return result;
  });
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentConversation: {
      findFirst: vi.fn(async ({ where }: any) => {
        const owner = conversationOwners.get(where.id);
        if (owner === undefined || owner !== where.workspaceId) return null;
        return { id: where.id };
      }),
    },
    agentMessage: {
      findMany: vi.fn(async ({ where }: any) => {
        const roleFilter: string[] | undefined = where?.role?.in;
        return messageRows
          .filter((r) => r.conversationId === where.conversationId)
          .filter((r) => !roleFilter || roleFilter.includes(r.role))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
    },
    agentAction: {
      findFirst: vi.fn(async ({ where }: any) => {
        for (const row of actionStore.values()) {
          if (matchesAction(row, where)) return { ...row };
        }
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `action-${++actionIdCounter}`, confirmedAt: null, executedAt: null, result: null, error: null, updatedAt: new Date(), ...data };
        actionStore.set(row.id, row);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of actionStore.values()) {
          if (matchesAction(row, where)) {
            Object.assign(row, data, { updatedAt: new Date() });
            count++;
          }
        }
        return { count };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = actionStore.get(where.id);
        if (!row) throw new Error('AgentAction not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      }),
    },
    workspace: {
      findUnique: vi.fn(async ({ where }: any) => ({ id: where.id })),
    },
    product: {
      // Supports create_product's own existingProductId lookup on a
      // source conflict — a plain, workspace-scoped read, never by `id`
      // here (ProductService itself never calls prisma.product.findFirst;
      // only the tool's own conflict handling does).
      findFirst: vi.fn(async ({ where }: any) => {
        for (const existing of productStore.values()) {
          if (existing.workspaceId === where.workspaceId && existing.sourceMarketplace === where.sourceMarketplace && existing.sourceId === where.sourceId) {
            return { id: existing.id };
          }
        }
        return null;
      }),
    },
    $transaction: transactionMock,
  },
}));

vi.mock('@/services/SubscriptionService', () => ({
  SubscriptionService: { isLimitReached: vi.fn().mockResolvedValue(false) },
}));

// Same reasoning as publish-listing-pipeline-integration.test.ts's own
// AiEntitlementService/AiUsageService mocks — both are separate,
// already-tested concerns; this file's own scope is create_product's
// pipeline, not entitlement/quota logic.
vi.mock('@/services/ai/AiEntitlementService', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/AiEntitlementService')>('@/services/ai/AiEntitlementService');
  return { ...actual, AiEntitlementService: { canUseCapability: vi.fn().mockResolvedValue(true) } };
});

vi.mock('@/services/ai/AiUsageService', () => ({
  AiUsageService: {
    hasQuotaRemaining: vi.fn().mockResolvedValue({ allowed: true }),
    reserveUsage: vi.fn().mockResolvedValue({ status: 'RESERVED', eventId: 'test-usage-event', units: 0 }),
    finalizeUsage: vi.fn().mockResolvedValue({ status: 'RECORDED' }),
    releaseUsage: vi.fn().mockResolvedValue({ status: 'RELEASED' }),
  },
}));

import { AiActionService } from '@/services/ai/AiActionService';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import type { NormalizedSourcingResult } from '@/services/sourcing/types';

function assistantToolUseRow(conversationId: string, toolUseId: string, toolName: string, input: unknown): FakeMessageRow {
  return {
    id: `mrow-${++rowIdCounter}`,
    conversationId,
    role: 'assistant',
    content: JSON.stringify([{ type: 'tool_use', id: toolUseId, name: toolName, input }]),
    createdAt: new Date(++clock),
  };
}
function toolResultRow(conversationId: string, toolUseId: string, resultPayload: unknown): FakeMessageRow {
  return {
    id: `mrow-${++rowIdCounter}`,
    conversationId,
    role: 'tool_result',
    content: JSON.stringify([{ type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(resultPayload) }]),
    createdAt: new Date(++clock),
  };
}
function pushToolCall(conversationId: string, toolUseId: string, toolName: string, input: unknown, resultPayload: unknown) {
  messageRows.push(assistantToolUseRow(conversationId, toolUseId, toolName, input));
  messageRows.push(toolResultRow(conversationId, toolUseId, resultPayload));
}

const sourcedItem: NormalizedSourcingResult = {
  source: 'ebay',
  sourceId: 'v1|222|0',
  sourceUrl: 'https://www.ebay.co.uk/itm/222',
  title: 'Prada Cut Out Sneakers',
  brand: 'Prada',
  price: 380,
  currency: 'GBP',
  marketplace: 'EBAY_GB',
  images: ['https://img.ebay.com/main.jpg'],
  condition: 'USED_EXCELLENT',
  authenticityStatus: 'claimed',
};

function seedSearchResult(conversationId: string, workspaceId = 'ws-1') {
  conversationOwners.set(conversationId, workspaceId);
  pushToolCall(conversationId, 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
}

function createProductInput(overrides: Record<string, unknown> = {}) {
  return {
    sourceMarketplace: sourcedItem.source,
    sourceId: sourcedItem.sourceId,
    sourceUrl: sourcedItem.sourceUrl,
    title: 'Prada Cut Out Sneakers',
    description: 'A real description of the item, at least twenty characters long.',
    sellingPrice: 449,
    purchasePrice: 200,
    ...overrides,
  };
}

async function proposeCreateProduct(workspaceId: string, conversationId: string, input: Record<string, unknown>, toolUseId = 'tu-create-product') {
  const tool = AiToolRegistry.get('create_product')!;
  const preview = await tool.preview!(workspaceId, input, { conversationId, userId: 'user-1' });
  return AiActionService.proposeAction({
    workspaceId,
    userId: 'user-1',
    conversationId,
    toolUseId,
    toolName: tool.name,
    toolCategory: tool.category,
    preview: async () => preview,
    input,
  });
}

describe('create_product — end-to-end pipeline via the REAL AiActionService + REAL ProductService', () => {
  beforeEach(() => {
    messageRows.length = 0;
    actionStore.clear();
    conversationOwners.clear();
    productStore.clear();
    rowIdCounter = 0;
    clock = 0;
    actionIdCounter = 0;
    productIdCounter = 0;
    simulateInventoryCreateFailure = false;
    vi.clearAllMocks();
    transactionMock.mockReset();
    setTransactionMockImplementation();
  });

  it('TEST A / P — propose -> confirm creates a real Product with Inventory and its provenance persisted exactly once', async () => {
    seedSearchResult('conv-1');
    const proposed = await proposeCreateProduct('ws-1', 'conv-1', createProductInput());
    expect(proposed.status).toBe('PENDING_CONFIRMATION');

    const confirmed = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(confirmed?.status).toBe('COMPLETED');
    const result = confirmed?.result as any;
    expect(result.success).toBe(true);
    expect(productStore.size).toBe(1);
    const stored = Array.from(productStore.values())[0];
    expect(stored.sourceMarketplace).toBe('ebay');
    expect(stored.sourceId).toBe(sourcedItem.sourceId);
    expect(stored.sourceUrl).toBe(sourcedItem.sourceUrl);
  });

  it('TEST O — an unconfirmed (still PENDING_CONFIRMATION) action creates no Product at all', async () => {
    seedSearchResult('conv-1');
    await proposeCreateProduct('ws-1', 'conv-1', createProductInput());

    expect(productStore.size).toBe(0);
  });

  describe('idempotence', () => {
    it('TEST Q — double-click: two confirms fired concurrently still create the Product AT MOST ONCE', async () => {
      seedSearchResult('conv-1');
      const proposed = await proposeCreateProduct('ws-1', 'conv-1', createProductInput());

      const [a, b] = await Promise.all([
        AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
        AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
      ]);

      expect(productStore.size).toBe(1);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
    });

    it('retry: confirming an already-COMPLETED action again replays the stored result, never creates a second Product', async () => {
      seedSearchResult('conv-1');
      const proposed = await proposeCreateProduct('ws-1', 'conv-1', createProductInput());

      const first = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      const retry = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(retry).toEqual(first);
      expect(productStore.size).toBe(1);
    });

    it('an EXPIRED action can never be confirmed/executed', async () => {
      seedSearchResult('conv-1');
      const proposed = await proposeCreateProduct('ws-1', 'conv-1', createProductInput());
      actionStore.get(proposed.id).expiresAt = new Date(Date.now() - 1000);

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('EXPIRED');
      expect(productStore.size).toBe(0);
    });
  });

  describe('workspace isolation (TEST R)', () => {
    it("workspace B cannot confirm workspace A's create_product action", async () => {
      seedSearchResult('conv-1', 'ws-A');
      const proposed = await proposeCreateProduct('ws-A', 'conv-1', createProductInput());

      const result = await AiActionService.confirmAndExecute('ws-B', 'user-B', proposed.id);

      expect(result).toBeNull();
      expect(productStore.size).toBe(0);
    });

    it("workspace B previewing with ws-A's conversationId is rejected — the sourced item never leaks across workspaces", async () => {
      seedSearchResult('conv-1', 'ws-A');

      const tool = AiToolRegistry.get('create_product')!;
      const preview: any = await tool.preview!('ws-B', createProductInput(), { conversationId: 'conv-1', userId: 'user-B' });

      expect(preview.error).toBeDefined();
    });
  });

  describe('duplicate provenance (TEST G / H)', () => {
    it('TEST G — the same source in the SAME workspace is refused on the second attempt, no second Product created', async () => {
      seedSearchResult('conv-1');
      const first = await proposeCreateProduct('ws-1', 'conv-1', createProductInput(), 'tu-1');
      await AiActionService.confirmAndExecute('ws-1', 'user-1', first.id);
      expect(productStore.size).toBe(1);

      const second = await proposeCreateProduct('ws-1', 'conv-1', createProductInput(), 'tu-2');
      const secondResult = await AiActionService.confirmAndExecute('ws-1', 'user-1', second.id);

      expect(secondResult?.status).toBe('COMPLETED'); // a controlled refusal, not a FAILED execution
      const outcome = secondResult?.result as any;
      expect(outcome.success).toBe(false);
      expect(outcome.errorCode).toBe('PRODUCT_SOURCE_ALREADY_EXISTS');
      expect(outcome.existingProductId).toBe(Array.from(productStore.values())[0].id);
      expect(productStore.size).toBe(1); // still exactly one
    });

    it('TEST H — the same source in a DIFFERENT workspace is allowed', async () => {
      seedSearchResult('conv-A', 'ws-A');
      seedSearchResult('conv-B', 'ws-B');

      const actionA = await proposeCreateProduct('ws-A', 'conv-A', createProductInput(), 'tu-A');
      const actionB = await proposeCreateProduct('ws-B', 'conv-B', createProductInput(), 'tu-B');

      const resultA = await AiActionService.confirmAndExecute('ws-A', 'user-1', actionA.id);
      const resultB = await AiActionService.confirmAndExecute('ws-B', 'user-1', actionB.id);

      expect((resultA?.result as any).success).toBe(true);
      expect((resultB?.result as any).success).toBe(true);
      expect(productStore.size).toBe(2);
    });
  });

  it('TEST N — a SKU conflict (distinct from a source conflict) is refused with the SKU message, never mislabeled', async () => {
    seedSearchResult('conv-1');
    const first = await proposeCreateProduct('ws-1', 'conv-1', createProductInput({ sku: 'SHARED-SKU' }), 'tu-1');
    await AiActionService.confirmAndExecute('ws-1', 'user-1', first.id);
    expect(productStore.size).toBe(1);

    // A different source, but the SAME sku — must conflict on sku, not on provenance.
    const second = await proposeCreateProduct(
      'ws-1',
      'conv-1',
      createProductInput({ sku: 'SHARED-SKU', sourceId: 'v1|different|0', sourceUrl: 'https://www.ebay.co.uk/itm/different' }),
      'tu-2'
    );
    // The second source was never really searched — seed it too so revalidation passes and the SKU conflict is what's actually exercised.
    pushToolCall('conv-1', 'tu-search-2', 'search_products', {}, {
      status: 'ok',
      results: [{ ...sourcedItem, sourceId: 'v1|different|0', sourceUrl: 'https://www.ebay.co.uk/itm/different' }],
      providerErrors: [],
    });

    const secondResult = await AiActionService.confirmAndExecute('ws-1', 'user-1', second.id);

    expect(secondResult?.status).toBe('COMPLETED');
    const outcome = secondResult?.result as any;
    expect(outcome.error).toMatch(/SKU/i);
    expect(outcome.errorCode).toBeUndefined();
    expect(productStore.size).toBe(1);
  });

  it('TEST M — Inventory.create failing inside ProductService\'s own transaction rolls back the Product too: the action is marked FAILED, no orphaned Product', async () => {
    seedSearchResult('conv-1');
    simulateInventoryCreateFailure = true;
    const proposed = await proposeCreateProduct('ws-1', 'conv-1', createProductInput());

    const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(result?.status).toBe('FAILED');
    expect(result?.error).toBe('Action execution failed'); // generic, never the raw error text
    expect(productStore.size).toBe(0);
  });

  it(
    'TEST S — two separately proposed create_product actions racing on the SAME provenance: exactly one succeeds, the other gets a clean conflict, never two Products. ' +
      'LIMITATION (documented per Étape 17/S, same discipline as ProductService.test.ts\'s own concurrency test): this proves the expected OUTCOME under a race using this ' +
      'file\'s commit-time uniqueness check, not real Postgres row-locking — unreachable without a live database in this sandbox.',
    async () => {
      seedSearchResult('conv-1');
      // Distinct explicit SKUs on purpose: the auto-generated `SKU-${Date.now()}`
      // fallback (ProductService.createProduct, unchanged by this task, see
      // Étape 4) could otherwise coincidentally collide between two calls
      // racing in the same millisecond, masking the SOURCE conflict this
      // test exists to prove behind an unrelated SKU conflict (see TEST N
      // for that distinct scenario, tested on its own).
      const first = await proposeCreateProduct('ws-1', 'conv-1', createProductInput({ sku: 'RACE-SKU-A' }), 'tu-race-1');
      const second = await proposeCreateProduct('ws-1', 'conv-1', createProductInput({ sku: 'RACE-SKU-B' }), 'tu-race-2');

      const [resultA, resultB] = await Promise.all([
        AiActionService.confirmAndExecute('ws-1', 'user-1', first.id),
        AiActionService.confirmAndExecute('ws-1', 'user-1', second.id),
      ]);

      const outcomes = [resultA?.result as any, resultB?.result as any];
      const succeeded = outcomes.filter((o) => o.success === true);
      const refused = outcomes.filter((o) => o.success === false);

      expect(succeeded).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0].errorCode).toBe('PRODUCT_SOURCE_ALREADY_EXISTS');
      expect(productStore.size).toBe(1);
    }
  );
});
