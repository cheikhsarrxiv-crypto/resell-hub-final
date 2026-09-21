/**
 * The Etsy equivalent of publish-listing-pipeline-integration.test.ts —
 * end-to-end integration tests for publish_etsy_listing driven through
 * the REAL AiActionService (not a fake tool registry): propose -> confirm
 * -> execute, exactly as a live confirm click would. Proves ADKSY's own
 * idempotence guarantee (Phase 12A's atomic state-machine) holds for this
 * tool too, and that its absolute real-call safeguard
 * (ENABLE_REAL_ETSY_PUBLISH) survives the full pipeline, not just the
 * tool in isolation.
 *
 * Every Etsy call is mocked (getAuthenticatedAdapter/createListing) —
 * this file makes ZERO real network calls.
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
    conversationOwners: new Map<string, string>(),
    // Persistence-architecture audit — see publish-listing-pipeline-integration.test.ts's own comment.
    productStore: new Map<string, any>(),
    connectionStore: new Map<string, any>(),
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

// This file proves publish_etsy_listing's own propose -> confirm -> execute
// pipeline — entitlement refusal is a separate, already-tested concern
// (see ai-entitlement-service.test.ts). Real
// AiEntitlementService.canUseCapability would call SubscriptionService
// against a workspace/plan Prisma mock this file doesn't set up above —
// always-true here keeps this file's own scope narrow.
vi.mock('@/services/ai/AiEntitlementService', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/AiEntitlementService')>('@/services/ai/AiEntitlementService');
  return { ...actual, AiEntitlementService: { canUseCapability: vi.fn().mockResolvedValue(true) } };
});

// Same reasoning as the AiEntitlementService mock above — AiUsageService
// is a separate, already-tested concern (see ai-usage-service.test.ts);
// real AiUsageService.hasQuotaRemaining would call SubscriptionService/
// prisma.workspaceAiOverride/aiUsagePeriod, none of which this file mocks.
vi.mock('@/services/ai/AiUsageService', () => ({
  AiUsageService: {
    hasQuotaRemaining: vi.fn().mockResolvedValue({ allowed: true }),
    recordUsage: vi.fn().mockResolvedValue({ status: 'RECORDED', eventId: 'test-usage-event', units: 0 }),
  },
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

function seedPublishableProduct(workspaceId: string) {
  productStore.set(productIdFor(workspaceId), { id: productIdFor(workspaceId), workspaceId, sku: `SKU-${workspaceId}`, deletedAt: null });
  connectionStore.set(`${workspaceId}:etsy`, { id: `conn-etsy-${workspaceId}` });
}

async function seedReadyEtsyDraft(conversationId: string, workspaceId = 'ws-1') {
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
    { sourceUrl: sourcedItem.sourceUrl, patch: { etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' } },
    { conversationId, userId: 'user-1' }
  );
  pushToolCall(conversationId, 'tu-edit', 'edit_listing_draft', {}, edited);
}

async function proposeEtsyPublish(workspaceId: string, conversationId: string, toolUseId = 'tu-publish') {
  const tool = AiToolRegistry.get('publish_etsy_listing')!;
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

describe('publish_etsy_listing — end-to-end pipeline via the REAL AiActionService', () => {
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
    delete process.env.ENABLE_REAL_ETSY_PUBLISH;
  });

  afterEach(() => {
    delete process.env.ENABLE_REAL_ETSY_PUBLISH;
  });

  it('propose -> confirm (real publish disabled, the default) -> COMPLETED with a simulated result, adapter never called', async () => {
    await seedReadyEtsyDraft('conv-1');
    const proposed = await proposeEtsyPublish('ws-1', 'conv-1');
    expect(proposed.status).toBe('PENDING_CONFIRMATION');

    const confirmed = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(confirmed?.status).toBe('COMPLETED');
    expect((confirmed?.result as any).simulated).toBe(true);
    expect(JSON.stringify(confirmed?.result)).not.toMatch(/"published"\s*:\s*true/);
    expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
  });

  it('propose -> confirm with the real flag enabled -> COMPLETED with the real adapter result (pipeline correct end-to-end)', async () => {
    process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
    createListingMock.mockResolvedValue({ externalId: 'ETSY-1', status: 'active' });
    await seedReadyEtsyDraft('conv-1');
    const proposed = await proposeEtsyPublish('ws-1', 'conv-1');

    const confirmed = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(confirmed?.status).toBe('COMPLETED');
    expect(confirmed?.result).toEqual({ published: true, listingId: expect.any(String), externalId: 'ETSY-1', status: 'active' });
    expect(getAuthenticatedAdapterMock).toHaveBeenCalledWith('ws-1', 'etsy');
  });

  describe('idempotence', () => {
    it('double-click: two confirms fired concurrently still execute the real adapter call AT MOST ONCE', async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
      createListingMock.mockResolvedValue({ externalId: 'ETSY-1', status: 'active' });
      await seedReadyEtsyDraft('conv-1');
      const proposed = await proposeEtsyPublish('ws-1', 'conv-1');

      const [a, b] = await Promise.all([
        AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
        AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
      ]);

      expect(createListingMock).toHaveBeenCalledTimes(1);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
    });

    it('retry: confirming an already-COMPLETED action again replays the stored result, never re-executes', async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
      createListingMock.mockResolvedValue({ externalId: 'ETSY-1', status: 'active' });
      await seedReadyEtsyDraft('conv-1');
      const proposed = await proposeEtsyPublish('ws-1', 'conv-1');

      const first = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      const retry = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(retry).toEqual(first);
      expect(createListingMock).toHaveBeenCalledTimes(1);
    });

    it('an EXPIRED action can never be confirmed/executed', async () => {
      await seedReadyEtsyDraft('conv-1');
      const proposed = await proposeEtsyPublish('ws-1', 'conv-1');
      actionStore.get(proposed.id).expiresAt = new Date(Date.now() - 1000);

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('EXPIRED');
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('a cancelled action can never later be confirmed', async () => {
      await seedReadyEtsyDraft('conv-1');
      const proposed = await proposeEtsyPublish('ws-1', 'conv-1');
      await AiActionService.cancelAction('ws-1', 'user-1', proposed.id);

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('CANCELLED');
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });
  });

  describe('workspace isolation', () => {
    it('workspace B cannot confirm workspace A\'s publish_etsy_listing action', async () => {
      await seedReadyEtsyDraft('conv-1', 'ws-A');
      const proposed = await proposeEtsyPublish('ws-A', 'conv-1');

      const result = await AiActionService.confirmAndExecute('ws-B', 'user-B', proposed.id);

      expect(result).toBeNull();
      expect(getAuthenticatedAdapterMock).not.toHaveBeenCalled();
    });

    it('workspace B previewing with ws-A\'s conversationId is rejected — findLatestDraft/findToolResultsByName verify AgentConversation.workspaceId', async () => {
      await seedReadyEtsyDraft('conv-1', 'ws-A');

      const tool = AiToolRegistry.get('publish_etsy_listing')!;
      const preview: any = await tool.preview!('ws-B', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-B' });

      expect(preview.error).toBeDefined();
      expect(preview.price).toBeUndefined();
    });
  });

  describe('error handling — Etsy API failure is stored as FAILED, no secret ever leaks', () => {
    it('an adapter error results in the AgentAction FAILED with a generic message, never the raw text', async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
      createListingMock.mockRejectedValue({ status: 400, message: 'Etsy rejected the listing, api-key super-secret-xyz' });
      await seedReadyEtsyDraft('conv-1');
      const proposed = await proposeEtsyPublish('ws-1', 'conv-1');

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('FAILED');
      expect(result?.error).toBe('Action execution failed');
      expect(result?.error).not.toContain('secret');
      expect(result?.error).not.toContain('api-key');
    });

    it('an already-FAILED action is never retried automatically — confirming again replays the same failure', async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
      createListingMock.mockRejectedValue({ status: 500, message: 'Etsy server error' });
      await seedReadyEtsyDraft('conv-1');
      const proposed = await proposeEtsyPublish('ws-1', 'conv-1');

      const first = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      expect(first?.status).toBe('FAILED');

      const again = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      expect(again?.status).toBe('FAILED');
      expect(createListingMock).toHaveBeenCalledTimes(1); // not retried
    });

    it('a network-level failure (adapter call rejects with no HTTP status at all) is still handled safely', async () => {
      process.env.ENABLE_REAL_ETSY_PUBLISH = 'true';
      const timeoutError = new Error('timeout') as any;
      timeoutError.code = 'ETIMEDOUT';
      createListingMock.mockRejectedValue(timeoutError);
      await seedReadyEtsyDraft('conv-1');
      const proposed = await proposeEtsyPublish('ws-1', 'conv-1');

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('FAILED');
      expect(result?.error).toBe('Action execution failed');
    });
  });
});
