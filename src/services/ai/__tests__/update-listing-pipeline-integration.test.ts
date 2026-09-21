/**
 * End-to-end integration tests for update_listing driven through the REAL
 * AiActionService: propose -> confirm -> execute, exactly as a live
 * confirm click would. Proves ADKSY's atomic state-machine idempotence
 * guarantee (Phase 12A) holds for this tool too, and that a real
 * ListingService.updateListing failure is never leaked verbatim — mirrors
 * publish-listing-pipeline-integration.test.ts's own structure.
 *
 * ListingService is mocked wholesale (getListing/updateListing) — this
 * file makes ZERO real database or marketplace calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function matchesAction(row: any, where: any): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.workspaceId !== undefined && row.workspaceId !== where.workspaceId) return false;
  if (where.idempotencyKey !== undefined && row.idempotencyKey !== where.idempotencyKey) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  return true;
}

const { actionStore, getListingMock, updateListingMock, getAuthenticatedAdapterMock } = vi.hoisted(() => ({
  actionStore: new Map<string, any>(),
  getListingMock: vi.fn(),
  updateListingMock: vi.fn(),
  getAuthenticatedAdapterMock: vi.fn(),
}));

let actionIdCounter = 0;

vi.mock('@/lib/prisma', () => ({
  prisma: {
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
  },
}));

vi.mock('@/services/ListingService', () => ({
  ListingService: { getListing: getListingMock, updateListing: updateListingMock },
  getAuthenticatedAdapter: getAuthenticatedAdapterMock,
}));

// This file proves update_listing's own propose -> confirm -> execute
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

function makeListing(overrides: Record<string, any> = {}) {
  return {
    id: 'listing-1',
    productId: 'product-1',
    workspaceId: 'ws-1',
    marketplaceConnectionId: 'conn-1',
    externalId: 'EBAY-EXT-1',
    title: 'Old title, five plus chars',
    description: 'An old description that is at least twenty characters long.',
    price: 39.99,
    quantity: 2,
    status: 'active',
    syncStatus: 'synced',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    connection: { id: 'conn-1', marketplace: { name: 'ebay', displayName: 'eBay' } },
    ...overrides,
  };
}

async function proposeUpdate(workspaceId: string, input: { listingId: string; changes: Record<string, unknown> }, toolUseId = 'tu-update') {
  const tool = AiToolRegistry.get('update_listing')!;
  const preview = await tool.preview!(workspaceId, input as any);
  return AiActionService.proposeAction({
    workspaceId,
    userId: 'user-1',
    conversationId: 'conv-1',
    toolUseId,
    toolName: tool.name,
    toolCategory: tool.category,
    preview: async () => preview,
    input,
  });
}

describe('update_listing — end-to-end pipeline via the REAL AiActionService', () => {
  beforeEach(() => {
    actionStore.clear();
    actionIdCounter = 0;
    vi.clearAllMocks();
  });

  it('propose -> confirm -> COMPLETED, ListingService.updateListing called exactly once with the confirmed changes', async () => {
    getListingMock.mockResolvedValue(makeListing());
    updateListingMock.mockResolvedValue(makeListing({ quantity: 5 }));

    const proposed = await proposeUpdate('ws-1', { listingId: 'listing-1', changes: { quantity: 5 } });
    expect(proposed.status).toBe('PENDING_CONFIRMATION');
    expect(updateListingMock).not.toHaveBeenCalled(); // no mutation during proposal

    const confirmed = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(confirmed?.status).toBe('COMPLETED');
    expect((confirmed?.result as any).success).toBe(true);
    expect(updateListingMock).toHaveBeenCalledTimes(1);
    expect(updateListingMock).toHaveBeenCalledWith('listing-1', 'ws-1', { quantity: 5 });
  });

  it('an unsupported field (price on eBay) never reaches ListingService.updateListing, even after confirmation', async () => {
    getListingMock.mockResolvedValue(makeListing());

    const proposed = await proposeUpdate('ws-1', { listingId: 'listing-1', changes: { price: 49 } });
    expect((proposed.summary as any).error).toMatch(/currency/i);

    const confirmed = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    // handler() returns a controlled {error} object rather than throwing —
    // same "expected failure" convention as get_listing/publish_listing's
    // own draft-not-found case — so the action still reaches COMPLETED,
    // just with an error embedded in its result, never FAILED.
    expect(confirmed?.status).toBe('COMPLETED');
    expect((confirmed?.result as any).error).toMatch(/currency/i);
    expect(updateListingMock).not.toHaveBeenCalled();
  });

  describe('idempotence', () => {
    it('double-click: two confirms fired concurrently still execute the real update AT MOST ONCE', async () => {
      getListingMock.mockResolvedValue(makeListing());
      updateListingMock.mockResolvedValue(makeListing({ title: 'New title, plenty long' }));

      const proposed = await proposeUpdate('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      const [a, b] = await Promise.all([
        AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
        AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
      ]);

      expect(updateListingMock).toHaveBeenCalledTimes(1);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
    });

    it('retry: confirming an already-COMPLETED action again replays the stored result, never re-executes', async () => {
      getListingMock.mockResolvedValue(makeListing());
      updateListingMock.mockResolvedValue(makeListing({ quantity: 7 }));

      const proposed = await proposeUpdate('ws-1', { listingId: 'listing-1', changes: { quantity: 7 } });

      const first = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      const retry = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(retry).toEqual(first);
      expect(updateListingMock).toHaveBeenCalledTimes(1);
    });

    it('an action already FAILED is never retried automatically — confirming again replays the same failure', async () => {
      getListingMock.mockResolvedValue(makeListing());
      updateListingMock.mockRejectedValue(new Error("eBay isn't connected. Reconnect it in Settings and try again."));

      const proposed = await proposeUpdate('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      const first = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      expect(first?.status).toBe('FAILED');

      const again = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      expect(again?.status).toBe('FAILED');
      expect(updateListingMock).toHaveBeenCalledTimes(1); // not retried
    });

    it('an EXPIRED action can never be confirmed/executed', async () => {
      getListingMock.mockResolvedValue(makeListing());

      const proposed = await proposeUpdate('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });
      actionStore.get(proposed.id).expiresAt = new Date(Date.now() - 1000);

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('EXPIRED');
      expect(updateListingMock).not.toHaveBeenCalled();
    });

    it('a cancelled action can never later be confirmed', async () => {
      getListingMock.mockResolvedValue(makeListing());

      const proposed = await proposeUpdate('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });
      await AiActionService.cancelAction('ws-1', 'user-1', proposed.id);

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('CANCELLED');
      expect(updateListingMock).not.toHaveBeenCalled();
    });
  });

  describe('workspace isolation', () => {
    it("workspace B cannot confirm workspace A's update_listing action", async () => {
      getListingMock.mockResolvedValue(makeListing({ workspaceId: 'ws-A' }));

      const proposed = await proposeUpdate('ws-A', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      const result = await AiActionService.confirmAndExecute('ws-B', 'user-B', proposed.id);

      expect(result).toBeNull();
      expect(updateListingMock).not.toHaveBeenCalled();
    });

    it("a listingId belonging to another workspace never leaks a preview (ListingService.getListing's own {id, workspaceId} query)", async () => {
      getListingMock.mockImplementation(async (listingId: string, workspaceId: string) => (workspaceId === 'ws-A' ? makeListing() : null));

      const tool = AiToolRegistry.get('update_listing')!;
      const preview: any = await tool.preview!('ws-B', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      expect(preview.error).toMatch(/not found/i);
      expect(preview.changes).toBeUndefined();
    });
  });

  describe('error handling — no secret ever leaks, whatever ListingService says', () => {
    const cases: string[] = [
      "eBay isn't connected. Reconnect it in Settings and try again.",
      'Your eBay connection has expired. Reconnect it in Settings and try again.',
      "Couldn't update this listing on eBay. Please try again.",
    ];

    it.each(cases)('a ListingService.updateListing failure (%s) -> AgentAction FAILED with a generic message, never the raw text', async (rawMessage) => {
      getListingMock.mockResolvedValue(makeListing());
      updateListingMock.mockRejectedValue(new Error(rawMessage));

      const proposed = await proposeUpdate('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });
      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('FAILED');
      expect(result?.error).toBe('Action execution failed');
    });

    it('a slow update does not prevent the atomic EXECUTING claim from blocking a concurrent confirm', async () => {
      getListingMock.mockResolvedValue(makeListing());
      let resolveUpdate!: (v: unknown) => void;
      updateListingMock.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve; }));

      const proposed = await proposeUpdate('ws-1', { listingId: 'listing-1', changes: { title: 'New title, plenty long' } });

      const firstConfirm = AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      await new Promise((r) => setTimeout(r, 10));
      const secondConfirm = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(secondConfirm?.status).toBe('EXECUTING'); // already claimed by the first
      resolveUpdate(makeListing({ title: 'New title, plenty long' }));
      const firstResult = await firstConfirm;
      expect(firstResult?.status).toBe('COMPLETED');
      expect(updateListingMock).toHaveBeenCalledTimes(1);
    });
  });
});
