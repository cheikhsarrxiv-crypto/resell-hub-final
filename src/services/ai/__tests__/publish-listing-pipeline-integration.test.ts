/**
 * Phase 12C-Offline — end-to-end integration tests for the real
 * publish_listing tool driven through the REAL AiActionService (not a
 * fake tool registry this time): propose -> confirm -> execute, exactly
 * as a live confirm click would. Proves ADKSY's own idempotence guarantee
 * (Phase 12A's atomic state-machine) holds for THIS tool specifically,
 * and that its absolute real-call safeguard (ENABLE_REAL_EBAY_PUBLISH)
 * survives the full pipeline, not just the tool in isolation.
 *
 * Every eBay call is mocked (getAuthenticatedAdapter/createListing) —
 * this file makes ZERO real network calls, matching the Phase 12C-Offline
 * brief's "objectif: zéro appel réseau réel".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeMessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
}

const { messageRows, actionStore, conversationOwners, productStore, connectionStore, listingStore, createListingMock, getAuthenticatedAdapterMock } = vi.hoisted(() => {
  const createListingMock = vi.fn();
  const getAuthenticatedAdapterMock = vi.fn(async (_workspaceId: string, _marketplaceName: string) => ({
    createListing: createListingMock,
  }));
  return {
    messageRows: [] as FakeMessageRow[],
    actionStore: new Map<string, any>(),
    // Phase 12C-Offline: real conversationId -> workspaceId ownership,
    // populated by seedReadyDraft — lets this file's cross-workspace
    // tests exercise the NEW findToolResultsByName ownership check for
    // real, not just assert against an always-matching stub.
    conversationOwners: new Map<string, string>(),
    // Persistence-architecture audit — real Product/MarketplaceConnection/
    // Listing tables, needed now that publish_listing requires a real
    // productId and persists a Listing on success (see actionTools.ts's
    // reserveListingForPublish).
    productStore: new Map<string, any>(),
    connectionStore: new Map<string, any>(), // key: `${workspaceId}:${marketplaceId}`
    listingStore: new Map<string, any>(),
    createListingMock,
    getAuthenticatedAdapterMock,
  };
});

let rowIdCounter = 0;
let clock = 0;
let actionIdCounter = 0;
let listingIdCounter = 0;

function matchesAction(row: any, where: any): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.workspaceId !== undefined && row.workspaceId !== where.workspaceId) return false;
  if (where.idempotencyKey !== undefined && row.idempotencyKey !== where.idempotencyKey) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  return true;
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
        const row = {
          id: `action-${++actionIdCounter}`,
          confirmedAt: null,
          executedAt: null,
          result: null,
          error: null,
          updatedAt: new Date(),
          ...data,
        };
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

vi.mock('@/services/ListingService', () => ({
  getAuthenticatedAdapter: getAuthenticatedAdapterMock,
}));

import { AiActionService } from '@/services/ai/AiActionService';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { generateListingDraftTool, editListingDraftTool } from '@/services/ai/tools/listingDraftTools';
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

function productIdFor(workspaceId: string) {
  return `product-${workspaceId}`;
}

/** Seeds a real, existing Product + eBay MarketplaceConnection for this workspace (Architecture A — required by publish_listing). */
function seedPublishableProduct(workspaceId: string) {
  productStore.set(productIdFor(workspaceId), { id: productIdFor(workspaceId), workspaceId, sku: `SKU-${workspaceId}`, deletedAt: null });
  connectionStore.set(`${workspaceId}:ebay`, { id: `conn-ebay-${workspaceId}` });
}

async function seedReadyDraft(conversationId: string, workspaceId = 'ws-1') {
  conversationOwners.set(conversationId, workspaceId);
  seedPublishableProduct(workspaceId);
  pushToolCall(conversationId, 'tu-search', 'search_products', {}, { status: 'ok', results: [sourcedItem], providerErrors: [] });
  const generated: any = await generateListingDraftTool.handler(
    workspaceId,
    { sourceUrl: sourcedItem.sourceUrl, proposedPrice: 449, proposedCurrency: 'EUR' },
    { conversationId, userId: 'user-1' }
  );
  pushToolCall(conversationId, 'tu-gen', 'generate_listing_draft', {}, generated);
  const edited: any = await editListingDraftTool.handler(
    workspaceId,
    { sourceUrl: sourcedItem.sourceUrl, patch: { ebayCategoryId: 15709, ebayMarketplaceId: 'EBAY_GB' } },
    { conversationId, userId: 'user-1' }
  );
  pushToolCall(conversationId, 'tu-edit', 'edit_listing_draft', {}, edited);
}

async function proposePublish(workspaceId: string, conversationId: string, toolUseId = 'tu-publish') {
  const tool = AiToolRegistry.get('publish_listing')!;
  const input = { sourceUrl: sourcedItem.sourceUrl, productId: productIdFor(workspaceId) };
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

describe('publish_listing — end-to-end pipeline via the REAL AiActionService', () => {
  beforeEach(() => {
    messageRows.length = 0; // messageRows is a const binding (from vi.hoisted) — clear in place, never reassign
    actionStore.clear();
    conversationOwners.clear();
    productStore.clear();
    connectionStore.clear();
    listingStore.clear();
    rowIdCounter = 0;
    clock = 0;
    actionIdCounter = 0;
    listingIdCounter = 0;
    vi.clearAllMocks();
    delete process.env.ENABLE_REAL_EBAY_PUBLISH;
  });

  afterEach(() => {
    delete process.env.ENABLE_REAL_EBAY_PUBLISH;
  });

  it('propose -> confirm (real publish disabled, the default) -> COMPLETED with a simulated result, adapter never called', async () => {
    await seedReadyDraft('conv-1');
    const proposed = await proposePublish('ws-1', 'conv-1');
    expect(proposed.status).toBe('PENDING_CONFIRMATION');

    const confirmed = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(confirmed?.status).toBe('COMPLETED');
    expect((confirmed?.result as any).simulated).toBe(true);
    expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
  });

  describe('idempotence (§4 — ADKSY-side, never eBay-side)', () => {
    it('double-click: two confirms fired concurrently still execute the real adapter call AT MOST ONCE', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      createListingMock.mockResolvedValue({ externalId: 'EBAY-1', status: 'active' });
      await seedReadyDraft('conv-1');
      const proposed = await proposePublish('ws-1', 'conv-1');

      const [a, b] = await Promise.all([
        AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
        AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
      ]);

      expect(createListingMock).toHaveBeenCalledTimes(1);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
    });

    it('FIXED (persistence-architecture audit): TWO separately proposed publish_listing actions for the SAME (product, connection) pair ' +
      '(a distinct tool_use each — e.g. the model asked again) are now deduped through the persisted Listing row itself, never the real eBay adapter twice. ' +
      'Previously (before this fix) this called createListing twice, since nothing local existed to check against — see actionTools.test.ts\'s own ' +
      'idempotence tests for the unit-level version of this guarantee.',
      async () => {
        process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
        createListingMock.mockResolvedValue({ externalId: 'EBAY-1', status: 'active' });
        await seedReadyDraft('conv-1');

        const first = await proposePublish('ws-1', 'conv-1', 'tu-publish-1');
        const second = await proposePublish('ws-1', 'conv-1', 'tu-publish-2'); // a distinct tool_use, e.g. the model asked again

        const firstResult = await AiActionService.confirmAndExecute('ws-1', 'user-1', first.id);
        const secondResult = await AiActionService.confirmAndExecute('ws-1', 'user-1', second.id);

        expect(createListingMock).toHaveBeenCalledTimes(1); // real adapter call happens only once now
        expect((firstResult?.result as any).published).toBe(true);
        expect((secondResult?.result as any).alreadyPublished).toBe(true);
        expect(listingStore.size).toBe(1); // no duplicate Listing row
      }
    );

    it('retry: confirming an already-COMPLETED action again replays the stored result, never re-executes', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      createListingMock.mockResolvedValue({ externalId: 'EBAY-1', status: 'active' });
      await seedReadyDraft('conv-1');
      const proposed = await proposePublish('ws-1', 'conv-1');

      const first = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      const retry = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(retry).toEqual(first);
      expect(createListingMock).toHaveBeenCalledTimes(1);
    });

    it('an action already FAILED is never retried automatically — confirming again replays the same failure', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      createListingMock.mockRejectedValue({ status: 500, message: 'eBay server error' });
      await seedReadyDraft('conv-1');
      const proposed = await proposePublish('ws-1', 'conv-1');

      const first = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      expect(first?.status).toBe('FAILED');

      const again = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      expect(again?.status).toBe('FAILED');
      expect(createListingMock).toHaveBeenCalledTimes(1); // not retried
    });

    it('an EXPIRED action can never be confirmed/executed', async () => {
      await seedReadyDraft('conv-1');
      const proposed = await proposePublish('ws-1', 'conv-1');
      actionStore.get(proposed.id).expiresAt = new Date(Date.now() - 1000);

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('EXPIRED');
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('a cancelled action can never later be confirmed', async () => {
      await seedReadyDraft('conv-1');
      const proposed = await proposePublish('ws-1', 'conv-1');
      await AiActionService.cancelAction('ws-1', 'user-1', proposed.id);

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('CANCELLED');
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });
  });

  describe('workspace isolation (§3)', () => {
    it('workspace B cannot confirm workspace A\'s publish_listing action', async () => {
      await seedReadyDraft('conv-1', 'ws-A');
      const proposed = await proposePublish('ws-A', 'conv-1');

      const result = await AiActionService.confirmAndExecute('ws-B', 'user-B', proposed.id);

      expect(result).toBeNull();
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('DEFENSE IN DEPTH (hardened in this phase): findLatestDraft/findToolResultsByName now explicitly verify AgentConversation.workspaceId before reading anything — ws-B given conv-1\'s id (owned by ws-A) is rejected here too, not just at AiActionService\'s own layer. Previously (before this fix) this same call would have succeeded, relying only on conversationId\'s non-guessability and on AiAgentService never leaking it — see conversationToolResults.ts\'s own comment for the full history.', async () => {
      await seedReadyDraft('conv-1', 'ws-A');

      const tool = AiToolRegistry.get('publish_listing')!;
      const preview: any = await tool.preview!('ws-B', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-B' });

      expect(preview.error).toBeDefined();
      expect(preview.price).toBeUndefined();
    });
  });

  describe('error handling (§6) — no secret ever leaks, whatever eBay says', () => {
    const cases: Array<[number, string]> = [
      [400, 'Invalid category'],
      [401, 'invalid_token super-secret-token-xyz'],
      [403, 'permission denied'],
      [404, 'not found'],
      [409, 'conflict'],
      [429, 'rate limited'],
      [500, 'server error'],
      [503, 'unavailable'],
    ];

    it.each(cases)('adapter error %i -> AgentAction FAILED with a generic message, never the raw text', async (status, rawMessage) => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      createListingMock.mockRejectedValue({ status, message: rawMessage });
      await seedReadyDraft('conv-1');
      const proposed = await proposePublish('ws-1', 'conv-1');

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('FAILED');
      expect(result?.error).toBe('Action execution failed');
      expect(result?.error).not.toContain(rawMessage);
      expect(result?.error).not.toContain('secret');
      expect(result?.error).not.toContain('token');
    });

    it('a network-level failure (adapter call rejects with no HTTP status at all) is still handled safely', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      const timeoutError = new Error('timeout') as any;
      timeoutError.code = 'ETIMEDOUT';
      createListingMock.mockRejectedValue(timeoutError);
      await seedReadyDraft('conv-1');
      const proposed = await proposePublish('ws-1', 'conv-1');

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('FAILED');
      expect(result?.error).toBe('Action execution failed');
    });

    it('a slow adapter response ("timeout simulé côté ADKSY") does not prevent the atomic EXECUTING claim from blocking a concurrent confirm', async () => {
      process.env.ENABLE_REAL_EBAY_PUBLISH = 'true';
      let resolveCreate!: (v: unknown) => void;
      createListingMock.mockImplementation(
        () => new Promise((resolve) => { resolveCreate = resolve; })
      );
      await seedReadyDraft('conv-1');
      const proposed = await proposePublish('ws-1', 'conv-1');

      const firstConfirm = AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      // Give the first confirm time to claim EXECUTING before the second fires.
      await new Promise((r) => setTimeout(r, 10));
      const secondConfirm = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(secondConfirm?.status).toBe('EXECUTING'); // already claimed by the first — never re-entered
      resolveCreate({ externalId: 'EBAY-LATE', status: 'active' });
      const firstResult = await firstConfirm;
      expect(firstResult?.status).toBe('COMPLETED');
      expect(createListingMock).toHaveBeenCalledTimes(1);
    });
  });
});
