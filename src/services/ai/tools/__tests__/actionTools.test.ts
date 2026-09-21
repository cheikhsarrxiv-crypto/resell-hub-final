/**
 * Real behavioral tests for the Phase 12A/12C-Offline framework 'engage'
 * tools: simulate_engage_action (no dependencies, pure framework test
 * action) and publish_listing (Phase 12C-Offline: connected to the real
 * generate_listing_draft/edit_listing_draft pipeline, but its real-eBay-call
 * branch is gated behind ENABLE_REAL_EBAY_PUBLISH, which is never set to
 * 'true' anywhere in this test file or elsewhere in this codebase — every
 * test here either exercises the simulated branch or mocks the adapter,
 * never a real network call).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
}

let rows: FakeRow[] = [];
let rowIdCounter = 0;
let clock = 0;
let listingIdCounter = 0;

// Persistence-architecture audit — real Product/MarketplaceConnection/
// Listing tables, backed by simple in-memory maps (same style as
// publish-listing-pipeline-integration.test.ts's agentAction store), so
// publish_listing/publish_etsy_listing's new productId requirement and
// their reserve-then-publish Listing bookkeeping can be exercised for
// real, never just stubbed to always succeed.
const { productStore, connectionStore, listingStore } = vi.hoisted(() => ({
  productStore: new Map<string, any>(),
  connectionStore: new Map<string, any>(), // key: `${workspaceId}:${marketplaceId}`
  listingStore: new Map<string, any>(),
}));

// Listing-reconciliation fix — Test 9 (Étape 9) flag: when
// `.value` is true, prisma.listing.update throws for every call,
// simulating the DB being genuinely unavailable right after a real
// marketplace call already succeeded. A mutable holder OBJECT (not a
// destructured primitive) so the mocked module factory below — itself
// hoisted, and evaluated once at import time — and the test bodies below
// share the exact same reference and see each other's mutations.
const dbDownFlag = vi.hoisted(() => ({ value: false }));

const DEFAULT_PRODUCT_ID = 'product-1';
const DEFAULT_PRODUCT_SKU = 'SKU-REAL-PRODUCT-1';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    // Phase 12C-Offline: findToolResultsByName now checks conversation
    // ownership first. This file's tests aren't about cross-workspace
    // ownership (that's covered in publish-listing-pipeline-integration.test.ts)
    // — every conversationId is treated as belonging to whatever
    // workspaceId asks.
    agentConversation: {
      findFirst: vi.fn(async ({ where }: any) => ({ id: where.id })),
    },
    agentMessage: {
      findMany: vi.fn(async ({ where }: any) => {
        const roleFilter: string[] | undefined = where?.role?.in;
        return rows
          .filter((r) => r.conversationId === where.conversationId)
          .filter((r) => !roleFilter || roleFilter.includes(r.role))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
    },
    product: {
      findFirst: vi.fn(async ({ where }: any) => {
        const product = productStore.get(where.id);
        if (!product || product.workspaceId !== where.workspaceId) return null;
        if (where.deletedAt === null && product.deletedAt) return null;
        return { id: product.id, sku: product.sku };
      }),
    },
    marketplaceConnection: {
      findFirst: vi.fn(async ({ where }: any) => {
        const connection = connectionStore.get(`${where.workspaceId}:${where.marketplaceId}`);
        return connection ? { id: connection.id } : null;
      }),
    },
    listing: {
      findFirst: vi.fn(async ({ where }: any) => {
        for (const listing of listingStore.values()) {
          if (
            listing.productId === where.productId &&
            listing.marketplaceConnectionId === where.marketplaceConnectionId &&
            (where.deletedAt === undefined || listing.deletedAt === where.deletedAt)
          ) {
            return { ...listing };
          }
        }
        return null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const row = listingStore.get(where.id);
        return row ? { ...row } : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `listing-${++listingIdCounter}`, externalId: null, deletedAt: null, ...data };
        listingStore.set(row.id, row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        // Listing-reconciliation fix — Test 9 (Étape 9): simulates the DB
        // being genuinely unavailable for `update` calls specifically
        // (both markListingSynced's and markListingFailed's), the exact
        // "adapter.createListing succeeded, the local write then failed"
        // crash scenario the audit identified. Toggled per-test only.
        if (dbDownFlag.value) {
          throw new Error('DB temporarily unavailable');
        }
        const row = listingStore.get(where.id);
        if (!row) throw new Error('Listing not found');
        Object.assign(row, data);
        return { ...row };
      }),
      // Race-safe conditional transition, the same idiom
      // AgentActionStateMachine already uses — only counts as a match
      // (and only then mutates) when the row's CURRENT syncStatus equals
      // what `where` demands, exactly like a real
      // `UPDATE ... WHERE id = ? AND syncStatus = ?` would.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = listingStore.get(where.id);
        if (!row || row.syncStatus !== where.syncStatus) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  },
}));

// vi.mock(...) is hoisted above every import AND every plain top-level
// statement in this file — a plain `const` defined "before" it in source
// order is still in its temporal dead zone by the time the factory
// actually runs (triggered by this file's own hoisted imports resolving
// the module graph). vi.hoisted() is Vitest's own documented mechanism
// for exactly this: values that must exist inside a hoisted mock factory.
const { getAuthenticatedAdapterMock, createListingMock, findPublishedOfferBySkuMock } = vi.hoisted(() => {
  const createListingMock = vi.fn();
  // Listing-reconciliation fix — the eBay-only real lookup used to
  // reconcile a stuck 'syncing' Listing (see EbayAdapter.findPublishedOfferBySku).
  // Defaults to an explicit unable_to_verify so a test that forgets to
  // configure it fails loudly rather than silently behaving like a
  // confirmed not_found.
  const findPublishedOfferBySkuMock = vi.fn(
    async (): Promise<
      { status: 'found'; listingId: string; offerId: string } | { status: 'not_found' } | { status: 'unable_to_verify'; reason: string }
    > => ({ status: 'unable_to_verify', reason: 'not configured by this test' })
  );
  const getAuthenticatedAdapterMock = vi.fn(async (_workspaceId: string, _marketplaceName: string) => ({
    createListing: createListingMock,
    findPublishedOfferBySku: findPublishedOfferBySkuMock,
  }));
  return { getAuthenticatedAdapterMock, createListingMock, findPublishedOfferBySkuMock };
});

vi.mock('@/services/ListingService', () => ({
  getAuthenticatedAdapter: getAuthenticatedAdapterMock,
}));

// create_product's own collaborator, ProductService, is treated as an
// already-tested dependency here (same reasoning as mocking
// getAuthenticatedAdapter above rather than re-exercising real eBay OAuth):
// its own atomicity/SKU-conflict/source-conflict behavior is exhaustively
// covered in ProductService.test.ts. This file focuses on create_product's
// OWN logic — sourcing revalidation, and correctly mapping ProductService's
// results/errors. The full real pipeline (real ProductService + real
// AiActionService together) is covered separately in
// create-product-pipeline-integration.test.ts, mirroring how
// publish-listing-pipeline-integration.test.ts complements this file for
// publish_listing.
const { createProductMock } = vi.hoisted(() => ({ createProductMock: vi.fn() }));

vi.mock('@/services/ProductService', async () => {
  // vi.importActual pulls in the REAL PRODUCT_SKU_CONFLICT_MESSAGE /
  // PRODUCT_SOURCE_CONFLICT_MESSAGE constants (never duplicated/hardcoded
  // here, which could otherwise silently drift from the real strings) —
  // only the ProductService class itself is replaced.
  const actual = await vi.importActual<typeof import('@/services/ProductService')>('@/services/ProductService');
  return { ...actual, ProductService: { createProduct: createProductMock } };
});

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { simulateEngageActionTool, createProductTool, publishListingTool, publishEtsyListingTool } from '@/services/ai/tools/actionTools';
import { generateListingDraftTool, editListingDraftTool } from '@/services/ai/tools/listingDraftTools';
import { PRODUCT_SKU_CONFLICT_MESSAGE, PRODUCT_SOURCE_CONFLICT_MESSAGE } from '@/services/ProductService';
import type { NormalizedSourcingResult } from '@/services/sourcing/types';

function assistantToolUseRow(conversationId: string, toolUseId: string, toolName: string, input: unknown): FakeRow {
  return {
    id: `row-${++rowIdCounter}`,
    conversationId,
    role: 'assistant',
    content: JSON.stringify([{ type: 'tool_use', id: toolUseId, name: toolName, input }]),
    createdAt: new Date(++clock),
  };
}

function toolResultRow(conversationId: string, toolUseId: string, resultPayload: unknown): FakeRow {
  return {
    id: `row-${++rowIdCounter}`,
    conversationId,
    role: 'tool_result',
    content: JSON.stringify([{ type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(resultPayload) }]),
    createdAt: new Date(++clock),
  };
}

function pushToolCall(conversationId: string, toolUseId: string, toolName: string, input: unknown, resultPayload: unknown) {
  rows.push(assistantToolUseRow(conversationId, toolUseId, toolName, input));
  rows.push(toolResultRow(conversationId, toolUseId, resultPayload));
}

const sourcedItem: NormalizedSourcingResult = {
  source: 'ebay',
  sourceId: 'v1|111|0',
  sourceUrl: 'https://www.ebay.co.uk/itm/111',
  title: 'Prada Cut Out Sneakers',
  brand: 'Prada',
  price: 380,
  currency: 'GBP',
  marketplace: 'EBAY_GB',
  images: ['https://img.ebay.com/main.jpg'],
  condition: 'USED_EXCELLENT',
  authenticityStatus: 'claimed',
};

/** Builds a genuinely READY draft (via the real tools, not hand-rolled) and records it in the fake conversation history, exactly like a real turn would. */
async function seedReadyDraft(conversationId: string) {
  pushToolCall(conversationId, 'tu-search', 'search_products', { query: 'prada' }, { status: 'ok', results: [sourcedItem], providerErrors: [] });

  const generated: any = await generateListingDraftTool.handler(
    'ws-1',
    { sourceUrl: sourcedItem.sourceUrl, proposedPrice: 449, proposedCurrency: 'EUR' },
    { conversationId, userId: 'user-1' }
  );
  pushToolCall(conversationId, 'tu-gen', 'generate_listing_draft', {}, generated);

  const edited: any = await editListingDraftTool.handler(
    'ws-1',
    { sourceUrl: sourcedItem.sourceUrl, patch: { ebayCategoryId: 15709, ebayMarketplaceId: 'EBAY_GB' } },
    { conversationId, userId: 'user-1' }
  );
  pushToolCall(conversationId, 'tu-edit', 'edit_listing_draft', {}, edited);

  return edited.draft;
}

/** The Etsy equivalent of seedReadyDraft above — a draft ready for validateEtsyDraft, not validateEbayDraft. */
async function seedReadyEtsyDraft(conversationId: string) {
  pushToolCall(conversationId, 'tu-search', 'search_products', { query: 'prada' }, { status: 'ok', results: [sourcedItem], providerErrors: [] });

  const generated: any = await generateListingDraftTool.handler(
    'ws-1',
    { sourceUrl: sourcedItem.sourceUrl, proposedPrice: 449, proposedCurrency: 'EUR' },
    { conversationId, userId: 'user-1' }
  );
  pushToolCall(conversationId, 'tu-gen', 'generate_listing_draft', {}, generated);

  const edited: any = await editListingDraftTool.handler(
    'ws-1',
    { sourceUrl: sourcedItem.sourceUrl, patch: { etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' } },
    { conversationId, userId: 'user-1' }
  );
  pushToolCall(conversationId, 'tu-edit', 'edit_listing_draft', {}, edited);

  return edited.draft;
}

describe('simulate_engage_action tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as an engage tool', () => {
    const tool = AiToolRegistry.get('simulate_engage_action');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('engage');
  });

  it('accepts an empty input (note is optional)', () => {
    expect(simulateEngageActionTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it('rejects an overly long note', () => {
    const result = simulateEngageActionTool.inputSchema.safeParse({ note: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('preview() never touches the database and is clearly labeled as a simulation', async () => {
    const summary = await simulateEngageActionTool.preview!('ws-1', { note: 'testing' });
    expect(summary.simulated).toBe(true);
    expect(summary.note).toBe('testing');
  });

  it('handler() has no real effect and says so explicitly', async () => {
    const result = await simulateEngageActionTool.handler('ws-1', { note: undefined });
    expect(result).toMatchObject({ simulated: true });
    expect((result as any).message).toContain('No real external or financial effect');
  });
});

describe('create_product tool definition', () => {
  beforeEach(() => {
    rows = [];
    rowIdCounter = 0;
    clock = 0;
    vi.clearAllMocks();
  });

  const validInput = {
    sourceMarketplace: 'ebay',
    sourceId: sourcedItem.sourceId!, // sourcedItem hardcodes a real literal sourceId above — the `?` on NormalizedSourcingResult.sourceId is a type-level generality, not true of this specific fixture
    sourceUrl: sourcedItem.sourceUrl,
    title: 'Prada Cut Out Sneakers',
    description: 'A real description of the item, at least twenty characters long.',
    sellingPrice: 449,
    purchasePrice: 200,
  };

  it('is registered in AiToolRegistry as an engage tool — never auto-executed', () => {
    const tool = AiToolRegistry.get('create_product');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('engage');
    expect(AiToolRegistry.isAutoExecutable('engage')).toBe(false);
  });

  describe('inputSchema', () => {
    it('requires sourceMarketplace, sourceId, sourceUrl, title, sellingPrice, purchasePrice', () => {
      expect(createProductTool.inputSchema.safeParse({}).success).toBe(false);
      expect(createProductTool.inputSchema.safeParse(validInput).success).toBe(true);
    });

    it('TEST K — purchasePrice absent is rejected before the handler ever runs — no price is ever invented', () => {
      const { purchasePrice, ...withoutPurchasePrice } = validInput;
      expect(createProductTool.inputSchema.safeParse(withoutPurchasePrice).success).toBe(false);
    });

    it('TEST K — purchasePrice invalid (negative) is rejected', () => {
      expect(createProductTool.inputSchema.safeParse({ ...validInput, purchasePrice: -1 }).success).toBe(false);
    });

    it('TEST L — sellingPrice absent is rejected before the handler ever runs — no price is ever invented', () => {
      const { sellingPrice, ...withoutSellingPrice } = validInput;
      expect(createProductTool.inputSchema.safeParse(withoutSellingPrice).success).toBe(false);
    });

    it('TEST L — sellingPrice invalid (negative) is rejected', () => {
      expect(createProductTool.inputSchema.safeParse({ ...validInput, sellingPrice: -1 }).success).toBe(false);
    });

    it('never accepts a quantity or images field as input — a sourced item is always a single unit, and images are out of this tool\'s scope', () => {
      const parsed = createProductTool.inputSchema.safeParse({ ...validInput, quantity: 5, images: ['https://img.example/1.jpg'] });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).not.toHaveProperty('quantity');
        expect(parsed.data).not.toHaveProperty('images');
      }
    });

    it('rejects an unrecognized condition value', () => {
      expect(createProductTool.inputSchema.safeParse({ ...validInput, condition: 'mint' }).success).toBe(false);
    });
  });

  describe('sourcing revalidation — never trusts provenance the model merely repeats back', () => {
    it('rejects when no search_products result exists at all in this conversation', async () => {
      const result: any = await createProductTool.handler('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' });
      expect(result.error).toMatch(/does not match a real search_products result/i);
      expect(createProductMock).not.toHaveBeenCalled();
    });

    it('TEST C — a falsified sourceId (does not match the real result) is refused', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });

      const result: any = await createProductTool.handler(
        'ws-1',
        { ...validInput, sourceId: 'FABRICATED-ID' },
        { conversationId: 'conv-1', userId: 'user-1' }
      );

      expect(result.error).toMatch(/does not match a real search_products result/i);
      expect(createProductMock).not.toHaveBeenCalled();
    });

    it('TEST D — a falsified sourceUrl (does not match the real result) is refused', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });

      const result: any = await createProductTool.handler(
        'ws-1',
        { ...validInput, sourceUrl: 'https://www.ebay.co.uk/itm/999999999' },
        { conversationId: 'conv-1', userId: 'user-1' }
      );

      expect(result.error).toMatch(/does not match a real search_products result/i);
      expect(createProductMock).not.toHaveBeenCalled();
    });

    it('TEST E — a falsified sourceMarketplace (does not match the real result\'s own source) is refused', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });

      const result: any = await createProductTool.handler(
        'ws-1',
        { ...validInput, sourceMarketplace: 'etsy' },
        { conversationId: 'conv-1', userId: 'user-1' }
      );

      expect(result.error).toMatch(/does not match a real search_products result/i);
      expect(createProductMock).not.toHaveBeenCalled();
    });

    it('cross-conversation: a source that only appeared in a DIFFERENT conversation is rejected', async () => {
      pushToolCall('conv-OTHER', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });

      const result: any = await createProductTool.handler('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toMatch(/does not match a real search_products result/i);
      expect(createProductMock).not.toHaveBeenCalled();
    });

    it('TEST B — sourceMarketplace/sourceId/sourceUrl ALL matching the real result succeeds in reaching ProductService', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      createProductMock.mockResolvedValue({
        id: 'product-new-1',
        sku: 'SKU-NEW-1',
        title: validInput.title,
        sourceMarketplace: 'ebay',
        sourceId: sourcedItem.sourceId,
        sourceUrl: sourcedItem.sourceUrl,
        sellingPrice: 449,
        purchasePrice: 200,
      });

      const result: any = await createProductTool.handler('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' });

      expect(createProductMock).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });
  });

  describe('preview()', () => {
    it('never calls ProductService — no mutation during proposal', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      await createProductTool.preview!('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' });
      expect(createProductMock).not.toHaveBeenCalled();
    });

    it('rejects a source with no matching search_products result, same as handler()', async () => {
      const summary: any = await createProductTool.preview!('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/does not match a real search_products result/i);
    });

    it('when valid, returns exactly the fields that will be created — what the reseller confirms matches what handler() would send', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      const summary: any = await createProductTool.preview!('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' });

      expect(summary.title).toBe(validInput.title);
      expect(summary.sellingPrice).toBe(449);
      expect(summary.purchasePrice).toBe(200);
      expect(summary.sourceMarketplace).toBe('ebay');
      expect(summary.sourceId).toBe(sourcedItem.sourceId);
      expect(summary.sourceUrl).toBe(sourcedItem.sourceUrl);
    });
  });

  describe('handler() — SKU (TEST I / TEST J)', () => {
    it('TEST I — a SKU explicitly provided is passed through to ProductService unchanged', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      createProductMock.mockResolvedValue({ id: 'product-1', sku: 'MY-OWN-SKU', title: validInput.title, sourceMarketplace: 'ebay', sourceId: sourcedItem.sourceId, sourceUrl: sourcedItem.sourceUrl, sellingPrice: 449, purchasePrice: 200 });

      await createProductTool.handler('ws-1', { ...validInput, sku: 'MY-OWN-SKU' }, { conversationId: 'conv-1', userId: 'user-1' });

      const [, passedData] = createProductMock.mock.calls[0];
      expect(passedData.sku).toBe('MY-OWN-SKU');
    });

    it('TEST J — no SKU provided: ProductService receives no sku field, so its own existing auto-generation behavior applies unchanged', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      createProductMock.mockResolvedValue({ id: 'product-1', sku: 'SKU-AUTO', title: validInput.title, sourceMarketplace: 'ebay', sourceId: sourcedItem.sourceId, sourceUrl: sourcedItem.sourceUrl, sellingPrice: 449, purchasePrice: 200 });

      await createProductTool.handler('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' });

      const [, passedData] = createProductMock.mock.calls[0];
      expect(passedData.sku).toBeUndefined();
    });

    it('never derives sourceId/sourceMarketplace/sourceUrl from the SKU or title — passes them through exactly as validated', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      createProductMock.mockResolvedValue({ id: 'product-1', sku: 'SKU-X', title: validInput.title, sourceMarketplace: 'ebay', sourceId: sourcedItem.sourceId, sourceUrl: sourcedItem.sourceUrl, sellingPrice: 449, purchasePrice: 200 });

      await createProductTool.handler('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' });

      const [, passedData] = createProductMock.mock.calls[0];
      expect(passedData.sourceMarketplace).toBe('ebay');
      expect(passedData.sourceId).toBe(sourcedItem.sourceId);
      expect(passedData.sourceUrl).toBe(sourcedItem.sourceUrl);
    });
  });

  describe('handler() — duplicate provenance (TEST G shape) and SKU conflict (TEST N)', () => {
    it('a PRODUCT_SOURCE_CONFLICT_MESSAGE from ProductService becomes a clean, distinguishable refusal — never a fabricated success', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      createProductMock.mockRejectedValue(new Error(PRODUCT_SOURCE_CONFLICT_MESSAGE));

      const result: any = await createProductTool.handler('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('PRODUCT_SOURCE_ALREADY_EXISTS');
      expect(typeof result.error).toBe('string'); // so AiActionService treats this as a non-billable refusal, never a success
      expect(result.message).toMatch(/already been added/i);
    });

    it('TEST N — a PRODUCT_SKU_CONFLICT_MESSAGE from ProductService is never confused with a source conflict', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      createProductMock.mockRejectedValue(new Error(PRODUCT_SKU_CONFLICT_MESSAGE));

      const result: any = await createProductTool.handler('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toBe(PRODUCT_SKU_CONFLICT_MESSAGE);
      expect(result.errorCode).toBeUndefined(); // never mislabeled as PRODUCT_SOURCE_ALREADY_EXISTS
    });

    it('an unexpected/unrecognized error from ProductService is never swallowed as a controlled refusal — it propagates', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      createProductMock.mockRejectedValue(new Error('Something genuinely unexpected'));

      await expect(
        createProductTool.handler('ws-1', validInput, { conversationId: 'conv-1', userId: 'user-1' })
      ).rejects.toThrow('Something genuinely unexpected');
    });
  });
});

describe('publish_listing tool definition (Phase 12C-Offline)', () => {
  beforeEach(() => {
    rows = [];
    rowIdCounter = 0;
    clock = 0;
    listingIdCounter = 0;
    vi.clearAllMocks();
    delete process.env.ENABLE_REAL_EBAY_PUBLISH;
    productStore.clear();
    connectionStore.clear();
    listingStore.clear();
    dbDownFlag.value = false;
    findPublishedOfferBySkuMock.mockReset().mockResolvedValue({ status: 'unable_to_verify', reason: 'not configured by this test' });
    productStore.set(DEFAULT_PRODUCT_ID, { id: DEFAULT_PRODUCT_ID, workspaceId: 'ws-1', sku: DEFAULT_PRODUCT_SKU, deletedAt: null });
    connectionStore.set('ws-1:ebay', { id: 'conn-ebay-1' });
  });

  afterEach(() => {
    delete process.env.ENABLE_REAL_EBAY_PUBLISH;
    dbDownFlag.value = false;
  });

  it('is registered in AiToolRegistry as an engage tool — never auto-executed', () => {
    const tool = AiToolRegistry.get('publish_listing');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('engage');
    expect(AiToolRegistry.isAutoExecutable('engage')).toBe(false);
  });

  it('input schema requires sourceUrl (a real URL) AND productId, never a raw workspaceId/marketplaceId', () => {
    expect(publishListingTool.inputSchema.safeParse({}).success).toBe(false);
    expect(publishListingTool.inputSchema.safeParse({ sourceUrl: 'not-a-url', productId: DEFAULT_PRODUCT_ID }).success).toBe(false);
    expect(publishListingTool.inputSchema.safeParse({ sourceUrl: 'https://ebay.example/item/1' }).success).toBe(false); // productId now required
    expect(publishListingTool.inputSchema.safeParse({ sourceUrl: 'https://ebay.example/item/1', productId: DEFAULT_PRODUCT_ID }).success).toBe(true);

    const parsed = publishListingTool.inputSchema.safeParse({
      sourceUrl: 'https://ebay.example/item/1',
      productId: DEFAULT_PRODUCT_ID,
      workspaceId: 'ws-ATTACKER',
      marketplaceId: 'EBAY_US',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('workspaceId');
      expect(parsed.data).not.toHaveProperty('marketplaceId');
    }
  });

  const withProduct = { productId: DEFAULT_PRODUCT_ID };

  describe('preview() — built from the real, already-revalidated draft, never a separate hand-written summary', () => {
    it('rejects a sourceUrl with no draft in this conversation', async () => {
      const summary = await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/no listing draft found/i);
    });

    it('rejects a draft that is not ready for eBay, with the specific reason', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
      pushToolCall('conv-1', 'tu-gen', 'generate_listing_draft', {}, generated);
      // No price/category/marketplaceId ever set — not ready.

      const summary = await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/not ready for eBay/i);
    });

    it('when ready, returns exactly mapDraftToEbayInput\'s fields plus policy/environment metadata — preview matches what handler() would send', async () => {
      await seedReadyDraft('conv-1');

      const summary: any = await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(summary.title).toBeDefined();
      expect(summary.price).toBe(449);
      expect(summary.currency).toBe('EUR');
      expect(summary.ebay).toEqual({ categoryId: 15709, marketplaceId: 'EBAY_GB' });
      expect(summary.policyStatus).toBe('POLICY_CONFIGURATION_REQUIRED');
      expect(summary.missingPolicies).toContain('paymentPolicyId');
    });

    it('overrides the draft\'s own sku with the real product\'s sku, and includes productId', async () => {
      await seedReadyDraft('conv-1');

      const summary: any = await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(summary.sku).toBe(DEFAULT_PRODUCT_SKU);
      expect(summary.productId).toBe(DEFAULT_PRODUCT_ID);
    });

    it('marks itself simulatedOnly:true when ENABLE_REAL_EBAY_PUBLISH is unset (the default in every environment this was built in)', async () => {
      await seedReadyDraft('conv-1');
      const summary: any = await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.simulatedOnly).toBe(true);
    });

    it('cross-conversation: a sourceUrl with a draft only in a DIFFERENT conversation is rejected', async () => {
      await seedReadyDraft('conv-OTHER');

      const summary = await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/no listing draft found/i);
    });

    it('preview() never calls getAuthenticatedAdapter — it must never itself execute anything', async () => {
      await seedReadyDraft('conv-1');
      await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('preview() never writes to the Listing table — no mutation during proposal', async () => {
      await seedReadyDraft('conv-1');
      await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(listingStore.size).toBe(0);
    });

    it('ARCHITECTURE A: a productId that does not exist in this workspace is refused — sourceUrl alone never identifies a Product', async () => {
      await seedReadyDraft('conv-1');
      const summary: any = await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, productId: 'does-not-exist' }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/product not found/i);
    });

    it('ARCHITECTURE A: a productId belonging to ANOTHER workspace is refused, never leaked', async () => {
      productStore.set('product-other-ws', { id: 'product-other-ws', workspaceId: 'ws-OTHER', sku: 'SKU-OTHER', deletedAt: null });
      await seedReadyDraft('conv-1');
      const summary: any = await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, productId: 'product-other-ws' }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/product not found/i);
    });

    it('a deleted product is refused', async () => {
      productStore.set(DEFAULT_PRODUCT_ID, { ...productStore.get(DEFAULT_PRODUCT_ID), deletedAt: new Date() });
      await seedReadyDraft('conv-1');
      const summary: any = await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/product not found/i);
    });

    it('no eBay MarketplaceConnection for this workspace is refused, with an actionable message', async () => {
      connectionStore.clear();
      await seedReadyDraft('conv-1');
      const summary: any = await publishListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/no ebay connection/i);
    });
  });

  describe('handler() — the absolute safeguard against a real eBay call', () => {
    it('with ENABLE_REAL_EBAY_PUBLISH unset (default): returns a simulation and NEVER calls getAuthenticatedAdapter/createListing, never touches Listing', async () => {
      await seedReadyDraft('conv-1');

      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.simulated).toBe(true);
      expect(result.wouldHaveSent).toBeDefined();
      expect(result.wouldHaveSent.sku).toBe(DEFAULT_PRODUCT_SKU);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
      expect(createListingMock).not.toHaveBeenCalled();
      expect(listingStore.size).toBe(0);
    });

    it('with ENABLE_REAL_EBAY_PUBLISH set to anything OTHER than the exact string "true": still simulates, never calls the adapter', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'TRUE'; // wrong case — must not be treated as enabled
      await seedReadyDraft('conv-1');

      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.simulated).toBe(true);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('rejects a sourceUrl with no draft in this conversation, before any adapter/config code runs', async () => {
      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(result.error).toMatch(/no listing draft found/i);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('rejects a draft that is not ready, before any adapter/config code runs', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
      pushToolCall('conv-1', 'tu-gen', 'generate_listing_draft', {}, generated);

      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(result.error).toMatch(/not ready for eBay/i);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('ARCHITECTURE A: an unknown/cross-workspace productId is refused before any adapter call, before any Listing write', async () => {
      await seedReadyDraft('conv-1');

      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, productId: 'does-not-exist' }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toMatch(/product not found/i);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
      expect(listingStore.size).toBe(0);
    });

    it('no eBay connection is refused before any adapter call', async () => {
      connectionStore.clear();
      await seedReadyDraft('conv-1');

      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toMatch(/no ebay connection/i);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    describe('the real path — ONLY reachable with ENABLE_REAL_EBAY_PUBLISH="true" AND a fully mocked adapter (never real network)', () => {
      it('calls getAuthenticatedAdapter + adapter.createListing with the exact mapped payload (real product SKU, not the draft\'s), and returns the real result shape', async () => {
        process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
        createListingMock.mockResolvedValue({ externalId: 'EBAY-LISTING-1', status: 'active' });
        await seedReadyDraft('conv-1');

        const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

        expect(getAuthenticatedAdapterMock).toHaveBeenCalledWith('ws-1', 'ebay');
        expect(createListingMock).toHaveBeenCalledTimes(1);
        const [sentPayload] = createListingMock.mock.calls[0];
        expect(sentPayload.price).toBe(449);
        expect(sentPayload.ebay).toEqual({ categoryId: 15709, marketplaceId: 'EBAY_GB' });
        expect(sentPayload.sku).toBe(DEFAULT_PRODUCT_SKU);
        expect(result).toEqual({ published: true, listingId: expect.any(String), externalId: 'EBAY-LISTING-1', status: 'active' });
      });

      it('FIXED (persistence-architecture audit): a successful real publish creates a real, synced Listing row — workspaceId, productId, ' +
        'marketplaceConnectionId, externalId, syncStatus all correct, so get_listing/get_listings/update_listing and order sync can now see it', async () => {
        process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
        createListingMock.mockResolvedValue({ externalId: 'EBAY-LISTING-1', status: 'active' });
        await seedReadyDraft('conv-1');

        const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

        const listing = listingStore.get(result.listingId);
        expect(listing).toBeDefined();
        expect(listing.workspaceId).toBe('ws-1');
        expect(listing.productId).toBe(DEFAULT_PRODUCT_ID);
        expect(listing.marketplaceConnectionId).toBe('conn-ebay-1');
        expect(listing.externalId).toBe('EBAY-LISTING-1');
        expect(listing.syncStatus).toBe('synced');
        expect(listing.status).toBe('active');
        expect(listing.deletedAt).toBeNull();
      });

      it('idempotence: confirming the SAME (product, connection) pair a second time never re-calls the real adapter — replays the existing synced Listing', async () => {
        process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
        createListingMock.mockResolvedValue({ externalId: 'EBAY-LISTING-1', status: 'active' });
        await seedReadyDraft('conv-1');

        const first: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
        const second: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

        expect(createListingMock).toHaveBeenCalledTimes(1); // never called twice
        expect(second.alreadyPublished).toBe(true);
        expect(second.listingId).toBe(first.listingId);
        expect(listingStore.size).toBe(1); // no duplicate Listing row
      });

      it('a failed publish leaves the Listing row in a retryable "failed" state, and a later successful retry reuses the SAME row (no duplicate)', async () => {
        process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
        createListingMock.mockRejectedValueOnce({ type: 'VALIDATION_ERROR', message: 'eBay rejected the offer', statusCode: 400 });
        await seedReadyDraft('conv-1');

        await expect(
          publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' })
        ).rejects.toBeTruthy();

        expect(listingStore.size).toBe(1);
        const failedListing = Array.from(listingStore.values())[0];
        expect(failedListing.syncStatus).toBe('failed');
        expect(failedListing.syncError).not.toMatch(/eBay rejected the offer/); // never the raw marketplace message
        expect(failedListing.syncError).not.toMatch(/token|secret/i);

        createListingMock.mockResolvedValueOnce({ externalId: 'EBAY-LISTING-RETRY', status: 'active' });
        const retryResult: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

        expect(retryResult.listingId).toBe(failedListing.id); // same row reused, never a duplicate
        expect(listingStore.size).toBe(1);
        expect(listingStore.get(failedListing.id).syncStatus).toBe('synced');
      });

      it('a failure from the real adapter propagates (never swallowed into a fake success)', async () => {
        process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
        createListingMock.mockRejectedValue({ type: 'VALIDATION_ERROR', message: 'eBay rejected the offer', statusCode: 400 });
        await seedReadyDraft('conv-1');

        await expect(
          publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' })
        ).rejects.toBeTruthy();
      });
    });
  });

  /**
   * Listing-reconciliation fix (audit finding CRITICAL) — a Listing
   * stuck at syncStatus='syncing' (the real eBay call already succeeded,
   * but the local DB write that should have followed it crashed/failed)
   * must never be silently trusted as published nor blindly republished.
   * See ListingReconciliationService for the unit-level tests of the
   * atomic claim/race logic; these are end-to-end through the real tool.
   */
  describe('reconciliation of a Listing stuck at "syncing" (listing-reconciliation fix)', () => {
    function seedStuckListing(overrides: Record<string, any> = {}) {
      const id = `listing-${++listingIdCounter}`;
      listingStore.set(id, {
        id,
        productId: DEFAULT_PRODUCT_ID,
        workspaceId: 'ws-1',
        marketplaceConnectionId: 'conn-ebay-1',
        externalId: null,
        status: 'active',
        syncStatus: 'syncing',
        syncError: null,
        deletedAt: null,
        title: 'stale',
        description: 'stale',
        price: 1,
        quantity: 1,
        ...overrides,
      });
      return id;
    }

    it('TEST 1 — eBay: reconciliation finds the real published offer, records the externalId, moves to synced, and NEVER calls createListing again', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      const stuckId = seedStuckListing();
      findPublishedOfferBySkuMock.mockResolvedValue({ status: 'found', listingId: 'EBAY-RECOVERED-1', offerId: 'OFFER-1' });
      await seedReadyDraft('conv-1');

      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result).toEqual({ published: true, listingId: stuckId, externalId: 'EBAY-RECOVERED-1', status: 'active', alreadyPublished: true });
      expect(createListingMock).not.toHaveBeenCalled();
      expect(findPublishedOfferBySkuMock).toHaveBeenCalledWith(DEFAULT_PRODUCT_SKU, 'EBAY_GB');
      expect(listingStore.get(stuckId).syncStatus).toBe('synced');
      expect(listingStore.get(stuckId).externalId).toBe('EBAY-RECOVERED-1');
      expect(listingStore.size).toBe(1); // no duplicate row created
    });

    it('TEST 3 — eBay: reconciliation confirms real absence (not_found) and allows a controlled retry — a fresh call then publishes for real, never a duplicate', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      const stuckId = seedStuckListing();
      findPublishedOfferBySkuMock.mockResolvedValue({ status: 'not_found' });
      await seedReadyDraft('conv-1');

      const first: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(first.error).toMatch(/could not be confirmed on eBay.*marked for retry/i);
      expect(createListingMock).not.toHaveBeenCalled(); // reconciliation itself never republishes
      expect(listingStore.get(stuckId).syncStatus).toBe('failed');

      // A separate, later call is the "controlled retry" — reuses the SAME row via the existing 'failed' retry path, never a duplicate.
      createListingMock.mockResolvedValueOnce({ externalId: 'EBAY-NEW-1', status: 'active' });
      const second: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(createListingMock).toHaveBeenCalledTimes(1);
      expect(second.listingId).toBe(stuckId);
      expect(second.externalId).toBe('EBAY-NEW-1');
      expect(listingStore.size).toBe(1);
    });

    it('TEST 5 — eBay: the marketplace check is inconclusive (rate-limited/unreachable) — no republication, no false not_found, explicit error', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      const stuckId = seedStuckListing();
      findPublishedOfferBySkuMock.mockResolvedValue({ status: 'unable_to_verify', reason: 'eBay rate limited the check' });
      await seedReadyDraft('conv-1');

      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toMatch(/could not be confirmed/i);
      expect(result.error).not.toMatch(/not found|not_found/i);
      expect(createListingMock).not.toHaveBeenCalled();
      expect(listingStore.get(stuckId).syncStatus).toBe('syncing'); // left exactly as it was — never failed, never synced
      expect(listingStore.get(stuckId).externalId).toBeNull();
    });

    it('TEST 6 — eBay: two concurrent publish attempts on the SAME stuck Listing — only one reconciliation actually checks eBay, no duplicate external call', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      seedStuckListing();
      let resolveLookup!: (v: any) => void;
      findPublishedOfferBySkuMock.mockImplementation(() => new Promise((resolve) => { resolveLookup = resolve; }));
      await seedReadyDraft('conv-1');

      const firstCall = publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const second: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(second.error).toBeTruthy(); // the second request lost the claim — reports "in progress", never re-checks

      resolveLookup({ status: 'found', listingId: 'EBAY-CONCURRENT-1', offerId: 'OFFER-1' });
      const first: any = await firstCall;

      expect(findPublishedOfferBySkuMock).toHaveBeenCalledTimes(1); // never checked twice
      expect(first.published).toBe(true);
      expect(first.externalId).toBe('EBAY-CONCURRENT-1');
      expect(createListingMock).not.toHaveBeenCalled();
    });

    it('a THIRD request landing on a row already mid-reconciliation (syncStatus="reconciling") is also routed to reconciliation, never to a fresh reservation', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      seedStuckListing({ syncStatus: 'reconciling' }); // simulates another request's in-flight claim
      await seedReadyDraft('conv-1');

      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toBeTruthy();
      expect(findPublishedOfferBySkuMock).not.toHaveBeenCalled(); // never re-checks — the claim belongs to someone else
      expect(createListingMock).not.toHaveBeenCalled();
      expect(listingStore.size).toBe(1); // no duplicate row created
    });

    it('TEST 7 — the old "alreadyPublished=true + externalId=null" behavior for a stuck Listing no longer exists', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      seedStuckListing();
      findPublishedOfferBySkuMock.mockResolvedValue({ status: 'unable_to_verify', reason: 'inconclusive' });
      await seedReadyDraft('conv-1');

      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      // Never presented as a confirmed publish while unresolved.
      expect(result.alreadyPublished).not.toBe(true);
      expect(result.published).not.toBe(true);
    });

    it('TEST 9b — a genuine "failed" Listing (real adapter rejection, not a stuck reconciliation) still retries normally, unaffected by this fix', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      const stuckId = seedStuckListing({ syncStatus: 'failed', syncError: "Couldn't publish to eBay. Please try again." });
      createListingMock.mockResolvedValueOnce({ externalId: 'EBAY-RETRY-NORMAL', status: 'active' });
      await seedReadyDraft('conv-1');

      const result: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(findPublishedOfferBySkuMock).not.toHaveBeenCalled(); // a 'failed' row never goes through reconciliation
      expect(result.listingId).toBe(stuckId);
      expect(result.externalId).toBe('EBAY-RETRY-NORMAL');
    });

    it('TEST 10 — workspace isolation: workspace B can never trigger reconciliation on workspace A\'s stuck Listing', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      seedStuckListing(); // belongs to ws-1 / DEFAULT_PRODUCT_ID / conn-ebay-1
      await seedReadyDraft('conv-1');

      // ws-2 has no matching Product/connection at all — the existing,
      // unmodified workspace-scoped lookups (loadPublishableProduct /
      // loadMarketplaceConnectionForPublish) refuse before reconciliation
      // is ever reached.
      const result: any = await publishListingTool.handler('ws-2', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toMatch(/product not found/i);
      expect(findPublishedOfferBySkuMock).not.toHaveBeenCalled();
    });

    it('Étape 9 — the exact crash scenario: adapter.createListing() succeeds, the DB write (markListingSynced) then throws, the Listing stays "syncing"; a later reconciliation recovers it without ever republishing', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      createListingMock.mockResolvedValueOnce({ externalId: 'EBAY-CRASHED-SUCCESS', status: 'active' });
      await seedReadyDraft('conv-1');

      // Simulates the DB going down for the write immediately following
      // the real eBay success (both markListingSynced's and
      // markListingFailed's own compensating write fail too — the exact
      // "DB temporarily indisponible" scenario from the audit).
      dbDownFlag.value = true;
      await expect(
        publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' })
      ).rejects.toBeTruthy();
      dbDownFlag.value = false;

      expect(listingStore.size).toBe(1);
      const stuck = Array.from(listingStore.values())[0];
      expect(stuck.syncStatus).toBe('syncing');
      expect(stuck.externalId).toBeNull();
      expect(createListingMock).toHaveBeenCalledTimes(1); // the real eBay call really happened, exactly once

      // DB is back — a later attempt must reconcile, not republish.
      findPublishedOfferBySkuMock.mockResolvedValue({ status: 'found', listingId: 'EBAY-CRASHED-SUCCESS', offerId: 'OFFER-CRASHED-1' });
      const recovered: any = await publishListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(createListingMock).toHaveBeenCalledTimes(1); // still exactly once — never republished
      expect(recovered.published).toBe(true);
      expect(recovered.externalId).toBe('EBAY-CRASHED-SUCCESS');
      expect(listingStore.get(stuck.id).syncStatus).toBe('synced');
    });
  });
});

describe('publish_etsy_listing tool definition (Etsy publication parity)', () => {
  beforeEach(() => {
    rows = [];
    rowIdCounter = 0;
    clock = 0;
    listingIdCounter = 0;
    vi.clearAllMocks();
    delete process.env.ENABLE_REAL_ETSY_PUBLISH;
    productStore.clear();
    connectionStore.clear();
    listingStore.clear();
    dbDownFlag.value = false;
    productStore.set(DEFAULT_PRODUCT_ID, { id: DEFAULT_PRODUCT_ID, workspaceId: 'ws-1', sku: DEFAULT_PRODUCT_SKU, deletedAt: null });
    connectionStore.set('ws-1:etsy', { id: 'conn-etsy-1' });
  });

  afterEach(() => {
    delete process.env.ENABLE_REAL_ETSY_PUBLISH;
    dbDownFlag.value = false;
  });

  const withProduct = { productId: DEFAULT_PRODUCT_ID };

  it('is registered in AiToolRegistry as an engage tool — never auto-executed', () => {
    const tool = AiToolRegistry.get('publish_etsy_listing');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('engage');
    expect(AiToolRegistry.isAutoExecutable('engage')).toBe(false);
  });

  it('input schema requires sourceUrl (a real URL) AND productId, never a raw workspaceId', () => {
    expect(publishEtsyListingTool.inputSchema.safeParse({}).success).toBe(false);
    expect(publishEtsyListingTool.inputSchema.safeParse({ sourceUrl: 'not-a-url', productId: DEFAULT_PRODUCT_ID }).success).toBe(false);
    expect(publishEtsyListingTool.inputSchema.safeParse({ sourceUrl: 'https://etsy.example/item/1' }).success).toBe(false); // productId now required
    expect(publishEtsyListingTool.inputSchema.safeParse({ sourceUrl: 'https://etsy.example/item/1', productId: DEFAULT_PRODUCT_ID }).success).toBe(true);
  });

  describe('preview()', () => {
    it('rejects a sourceUrl with no draft in this conversation', async () => {
      const summary = await publishEtsyListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/no listing draft found/i);
    });

    it('rejects a draft that is not ready for Etsy, with the specific reason (taxonomyId/whenMade/whoMade missing)', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
      pushToolCall('conv-1', 'tu-gen', 'generate_listing_draft', {}, generated);
      // No taxonomyId/whenMade/whoMade ever set — not ready.

      const summary = await publishEtsyListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/not ready for etsy/i);
    });

    it('when ready, returns exactly mapDraftToEtsyInput\'s fields plus environment metadata — preview matches what handler() would send', async () => {
      await seedReadyEtsyDraft('conv-1');

      const summary: any = await publishEtsyListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(summary.title).toBeDefined();
      expect(summary.price).toBe(449);
      expect(summary.etsy).toEqual({ whoMade: 'i_did', whenMade: '2020_2025', taxonomyId: 1234 });
      expect(summary.marketplace).toBe('Etsy');
      // Etsy has no policy-status concept in EtsyAdapter.createListing — never fabricated here.
      expect(summary.policyStatus).toBeUndefined();
    });

    it('overrides the draft\'s own sku with the real product\'s sku, and includes productId', async () => {
      await seedReadyEtsyDraft('conv-1');

      const summary: any = await publishEtsyListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(summary.sku).toBe(DEFAULT_PRODUCT_SKU);
      expect(summary.productId).toBe(DEFAULT_PRODUCT_ID);
    });

    it('marks itself simulatedOnly:true when ENABLE_REAL_ETSY_PUBLISH is unset (the default in every environment this was built in)', async () => {
      await seedReadyEtsyDraft('conv-1');
      const summary: any = await publishEtsyListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.simulatedOnly).toBe(true);
    });

    it('preview() never calls getAuthenticatedAdapter — it must never itself execute anything', async () => {
      await seedReadyEtsyDraft('conv-1');
      await publishEtsyListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('preview() never writes to the Listing table — no mutation during proposal', async () => {
      await seedReadyEtsyDraft('conv-1');
      await publishEtsyListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(listingStore.size).toBe(0);
    });

    it('ARCHITECTURE A: a productId that does not exist in this workspace is refused', async () => {
      await seedReadyEtsyDraft('conv-1');
      const summary: any = await publishEtsyListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, productId: 'does-not-exist' }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/product not found/i);
    });

    it('ARCHITECTURE A: a productId belonging to ANOTHER workspace is refused, never leaked', async () => {
      productStore.set('product-other-ws', { id: 'product-other-ws', workspaceId: 'ws-OTHER', sku: 'SKU-OTHER', deletedAt: null });
      await seedReadyEtsyDraft('conv-1');
      const summary: any = await publishEtsyListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, productId: 'product-other-ws' }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/product not found/i);
    });

    it('no Etsy MarketplaceConnection for this workspace is refused, with an actionable message', async () => {
      connectionStore.clear();
      await seedReadyEtsyDraft('conv-1');
      const summary: any = await publishEtsyListingTool.preview!('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(summary.error).toMatch(/no etsy connection/i);
    });
  });

  describe('handler() — the absolute safeguard against a real Etsy call', () => {
    it('with ENABLE_REAL_ETSY_PUBLISH unset (default): returns a simulation and NEVER calls getAuthenticatedAdapter/createListing, never touches Listing', async () => {
      await seedReadyEtsyDraft('conv-1');

      const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.simulated).toBe(true);
      expect(result.wouldHaveSent).toBeDefined();
      expect(result.wouldHaveSent.sku).toBe(DEFAULT_PRODUCT_SKU);
      expect(JSON.stringify(result)).not.toMatch(/"published"\s*:\s*true/);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
      expect(createListingMock).not.toHaveBeenCalled();
      expect(listingStore.size).toBe(0);
    });

    it('with ENABLE_REAL_ETSY_PUBLISH set to anything OTHER than the exact string "true": still simulates, never calls the adapter', async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'TRUE'; // wrong case — must not be treated as enabled
      await seedReadyEtsyDraft('conv-1');

      const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.simulated).toBe(true);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('enabling ENABLE_REAL_EBAY_PUBLISH does NOT enable a real Etsy call — the two flags are independent', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      await seedReadyEtsyDraft('conv-1');

      const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.simulated).toBe(true);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
      delete process.env.ENABLE_REAL_EBAY_PUBLISH;
    });

    it('rejects a sourceUrl with no draft in this conversation, before any adapter/config code runs', async () => {
      const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(result.error).toMatch(/no listing draft found/i);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('rejects a draft that is not ready, before any adapter/config code runs', async () => {
      pushToolCall('conv-1', 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
      const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
      pushToolCall('conv-1', 'tu-gen', 'generate_listing_draft', {}, generated);

      const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
      expect(result.error).toMatch(/not ready for etsy/i);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('ARCHITECTURE A: an unknown/cross-workspace productId is refused before any adapter call, before any Listing write', async () => {
      await seedReadyEtsyDraft('conv-1');

      const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, productId: 'does-not-exist' }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toMatch(/product not found/i);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
      expect(listingStore.size).toBe(0);
    });

    it('no Etsy connection is refused before any adapter call', async () => {
      connectionStore.clear();
      await seedReadyEtsyDraft('conv-1');

      const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toMatch(/no etsy connection/i);
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    describe('the real path — ONLY reachable with ENABLE_REAL_ETSY_PUBLISH="true" AND a fully mocked adapter (never real network)', () => {
      it('calls getAuthenticatedAdapter + adapter.createListing with the exact mapped payload (real product SKU), and returns the real result shape', async () => {
        process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
        createListingMock.mockResolvedValue({ externalId: 'ETSY-LISTING-1', status: 'active' });
        await seedReadyEtsyDraft('conv-1');

        const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

        expect(getAuthenticatedAdapterMock).toHaveBeenCalledWith('ws-1', 'etsy');
        expect(createListingMock).toHaveBeenCalledTimes(1);
        const [sentPayload] = createListingMock.mock.calls[0];
        expect(sentPayload.price).toBe(449);
        expect(sentPayload.etsy).toEqual({ whoMade: 'i_did', whenMade: '2020_2025', taxonomyId: 1234 });
        expect(sentPayload.sku).toBe(DEFAULT_PRODUCT_SKU);
        expect(result).toEqual({ published: true, listingId: expect.any(String), externalId: 'ETSY-LISTING-1', status: 'active' });
      });

      it('FIXED (persistence-architecture audit): a successful real publish creates a real, synced Listing row', async () => {
        process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
        createListingMock.mockResolvedValue({ externalId: 'ETSY-LISTING-1', status: 'active' });
        await seedReadyEtsyDraft('conv-1');

        const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

        const listing = listingStore.get(result.listingId);
        expect(listing).toBeDefined();
        expect(listing.workspaceId).toBe('ws-1');
        expect(listing.productId).toBe(DEFAULT_PRODUCT_ID);
        expect(listing.marketplaceConnectionId).toBe('conn-etsy-1');
        expect(listing.externalId).toBe('ETSY-LISTING-1');
        expect(listing.syncStatus).toBe('synced');
      });

      it('idempotence: confirming the SAME (product, connection) pair a second time never re-calls the real adapter', async () => {
        process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
        createListingMock.mockResolvedValue({ externalId: 'ETSY-LISTING-1', status: 'active' });
        await seedReadyEtsyDraft('conv-1');

        const first: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });
        const second: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

        expect(createListingMock).toHaveBeenCalledTimes(1);
        expect(second.alreadyPublished).toBe(true);
        expect(second.listingId).toBe(first.listingId);
        expect(listingStore.size).toBe(1);
      });

      it('a failed publish leaves the Listing row "failed" (retryable), and a later successful retry reuses the SAME row', async () => {
        process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
        createListingMock.mockRejectedValueOnce({ type: 'VALIDATION_ERROR', message: 'Etsy rejected the listing', statusCode: 400 });
        await seedReadyEtsyDraft('conv-1');

        await expect(
          publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' })
        ).rejects.toBeTruthy();

        expect(listingStore.size).toBe(1);
        const failedListing = Array.from(listingStore.values())[0];
        expect(failedListing.syncStatus).toBe('failed');
        expect(failedListing.syncError).not.toMatch(/Etsy rejected the listing/);

        createListingMock.mockResolvedValueOnce({ externalId: 'ETSY-LISTING-RETRY', status: 'active' });
        const retryResult: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

        expect(retryResult.listingId).toBe(failedListing.id);
        expect(listingStore.size).toBe(1);
      });

      it('a failure from the real adapter propagates (never swallowed into a fake success)', async () => {
        process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
        createListingMock.mockRejectedValue({ type: 'VALIDATION_ERROR', message: 'Etsy rejected the listing', statusCode: 400 });
        await seedReadyEtsyDraft('conv-1');

        await expect(
          publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' })
        ).rejects.toBeTruthy();
      });
    });
  });

  /**
   * Listing-reconciliation fix — Etsy side. Etsy has no reliable
   * SKU-indexed listing lookup (see ListingReconciliationService's own
   * documented reason), so a stuck Etsy Listing always fails closed:
   * never trusted as published, never blindly retried, and — unlike
   * eBay — never resolved to 'synced' by this mechanism at all (TEST 2
   * as literally specified — "reconciliation retrouve le listing" for
   * Etsy — is not something this fix can honestly deliver; see the
   * final report's own explanation of this scope decision).
   */
  describe('reconciliation of a Listing stuck at "syncing" (listing-reconciliation fix, Etsy fail-closed)', () => {
    function seedStuckEtsyListing(overrides: Record<string, any> = {}) {
      const id = `listing-${++listingIdCounter}`;
      listingStore.set(id, {
        id,
        productId: DEFAULT_PRODUCT_ID,
        workspaceId: 'ws-1',
        marketplaceConnectionId: 'conn-etsy-1',
        externalId: null,
        status: 'active',
        syncStatus: 'syncing',
        syncError: null,
        deletedAt: null,
        title: 'stale',
        description: 'stale',
        price: 1,
        quantity: 1,
        ...overrides,
      });
      return id;
    }

    it('TEST 5 (Etsy variant) — always fails closed: no lookup capability exists, so it is always treated as "unable to verify", never "not found", never republished', async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
      const stuckId = seedStuckEtsyListing();
      await seedReadyEtsyDraft('conv-1');

      const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toMatch(/could not be confirmed/i);
      expect(result.error).not.toMatch(/not found|not_found/i);
      expect(createListingMock).not.toHaveBeenCalled();
      expect(listingStore.get(stuckId).syncStatus).toBe('syncing'); // left exactly as it was
      expect(listingStore.get(stuckId).externalId).toBeNull();
    });

    it('TEST 7 (Etsy variant) — the old "alreadyPublished=true + externalId=null" behavior no longer exists for Etsy either', async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
      seedStuckEtsyListing();
      await seedReadyEtsyDraft('conv-1');

      const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.alreadyPublished).not.toBe(true);
      expect(result.published).not.toBe(true);
    });

    it('TEST 9b (Etsy variant) — a genuine "failed" Listing (real adapter rejection) still retries normally, unaffected by this fix', async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
      const stuckId = seedStuckEtsyListing({ syncStatus: 'failed', syncError: "Couldn't publish to Etsy. Please try again." });
      createListingMock.mockResolvedValueOnce({ externalId: 'ETSY-RETRY-NORMAL', status: 'active' });
      await seedReadyEtsyDraft('conv-1');

      const result: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.listingId).toBe(stuckId);
      expect(result.externalId).toBe('ETSY-RETRY-NORMAL');
    });

    it("TEST 10 (Etsy variant) — workspace isolation: workspace B can never trigger reconciliation on workspace A's stuck Etsy Listing", async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
      seedStuckEtsyListing();
      await seedReadyEtsyDraft('conv-1');

      const result: any = await publishEtsyListingTool.handler('ws-2', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(result.error).toMatch(/product not found/i);
    });

    it('Étape 9 (Etsy variant) — adapter.createListing() succeeds, the DB write then throws, the Listing stays "syncing"; a later attempt fails closed (Etsy has no recovery lookup) rather than republishing', async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
      createListingMock.mockResolvedValueOnce({ externalId: 'ETSY-CRASHED-SUCCESS', status: 'active' });
      await seedReadyEtsyDraft('conv-1');

      dbDownFlag.value = true;
      await expect(
        publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' })
      ).rejects.toBeTruthy();
      dbDownFlag.value = false;

      expect(listingStore.size).toBe(1);
      const stuck = Array.from(listingStore.values())[0];
      expect(stuck.syncStatus).toBe('syncing');
      expect(createListingMock).toHaveBeenCalledTimes(1);

      const secondAttempt: any = await publishEtsyListingTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, ...withProduct }, { conversationId: 'conv-1', userId: 'user-1' });

      expect(createListingMock).toHaveBeenCalledTimes(1); // never republished — Etsy fails closed, no way to confirm the crashed success
      expect(secondAttempt.error).toBeTruthy();
      expect(listingStore.get(stuck.id).syncStatus).toBe('syncing');
    });
  });
});
