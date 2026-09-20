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
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `listing-${++listingIdCounter}`, externalId: null, deletedAt: null, ...data };
        listingStore.set(row.id, row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = listingStore.get(where.id);
        if (!row) throw new Error('Listing not found');
        Object.assign(row, data);
        return { ...row };
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
const { getAuthenticatedAdapterMock, createListingMock } = vi.hoisted(() => {
  const createListingMock = vi.fn();
  const getAuthenticatedAdapterMock = vi.fn(async (_workspaceId: string, _marketplaceName: string) => ({
    createListing: createListingMock,
  }));
  return { getAuthenticatedAdapterMock, createListingMock };
});

vi.mock('@/services/ListingService', () => ({
  getAuthenticatedAdapter: getAuthenticatedAdapterMock,
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { simulateEngageActionTool, publishListingTool, publishEtsyListingTool } from '@/services/ai/tools/actionTools';
import { generateListingDraftTool, editListingDraftTool } from '@/services/ai/tools/listingDraftTools';
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
    productStore.set(DEFAULT_PRODUCT_ID, { id: DEFAULT_PRODUCT_ID, workspaceId: 'ws-1', sku: DEFAULT_PRODUCT_SKU, deletedAt: null });
    connectionStore.set('ws-1:ebay', { id: 'conn-ebay-1' });
  });

  afterEach(() => {
    delete process.env.ENABLE_REAL_EBAY_PUBLISH;
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
    productStore.set(DEFAULT_PRODUCT_ID, { id: DEFAULT_PRODUCT_ID, workspaceId: 'ws-1', sku: DEFAULT_PRODUCT_SKU, deletedAt: null });
    connectionStore.set('ws-1:etsy', { id: 'conn-etsy-1' });
  });

  afterEach(() => {
    delete process.env.ENABLE_REAL_ETSY_PUBLISH;
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
});
