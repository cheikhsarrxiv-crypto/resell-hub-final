/**
 * Behavioral tests for AiActionService — the backend authority behind
 * every 'engage' tool's propose -> confirm -> execute pipeline. Uses a
 * tiny in-memory fake for prisma.agentAction (find/create/updateMany/
 * update) so the real read-modify-write sequences AiActionService relies
 * on for its concurrency/idempotency guarantees are exercised faithfully,
 * rather than a hand-queued sequence of canned responses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => {
  const store = new Map<string, any>();
  let idCounter = 0;

  function matches(row: any, where: any): boolean {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.workspaceId !== undefined && row.workspaceId !== where.workspaceId) return false;
    if (where.idempotencyKey !== undefined && row.idempotencyKey !== where.idempotencyKey) return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    return true;
  }

  return {
    __actionStore: store,
    prisma: {
      agentAction: {
        findFirst: vi.fn(async ({ where }: any) => {
          for (const row of store.values()) {
            if (matches(row, where)) return { ...row };
          }
          return null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const row = {
            id: `action-${++idCounter}`,
            confirmedAt: null,
            executedAt: null,
            result: null,
            error: null,
            updatedAt: new Date(),
            ...data,
          };
          store.set(row.id, row);
          return { ...row };
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const row of store.values()) {
            if (matches(row, where)) {
              Object.assign(row, data, { updatedAt: new Date() });
              count++;
            }
          }
          return { count };
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const row = store.get(where.id);
          if (!row) throw new Error('AgentAction not found');
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        }),
      },
    },
  };
});

const publishHandler = vi.fn().mockResolvedValue({ simulated: true, message: 'ok' });
const failingHandler = vi.fn().mockRejectedValue(new Error('boom — a raw internal detail that must never leak'));

vi.mock('@/services/ai/AiToolRegistry', () => ({
  AiToolRegistry: {
    get: (name: string) => {
      if (name === 'publish_listing') return { name, category: 'engage', handler: publishHandler };
      if (name === 'failing_tool') return { name, category: 'engage', handler: failingHandler };
      return undefined;
    },
  },
}));

// This file exercises the propose -> confirm -> execute STATE MACHINE
// itself (idempotency, races, expiry, isolation) — entitlement refusal has
// its own dedicated behavioral tests (ai-entitlement-service.test.ts and
// the confirmAndExecute-specific cases there). Real
// AiEntitlementService.canUseCapability would call SubscriptionService,
// which needs a workspace/plan Prisma mock this file deliberately doesn't
// set up (only agentAction is mocked above) — always-true here keeps this
// file's own scope narrow and its mocks honest about what they exercise.
vi.mock('@/services/ai/AiEntitlementService', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/AiEntitlementService')>('@/services/ai/AiEntitlementService');
  return {
    ...actual,
    AiEntitlementService: { canUseCapability: vi.fn().mockResolvedValue(true) },
  };
});

import * as prismaModule from '@/lib/prisma';
import { AiActionService } from '@/services/ai/AiActionService';

// __actionStore is a test-only export the mocked module above adds — not
// part of the real @/lib/prisma module's type, hence the cast.
const __actionStore = (prismaModule as unknown as { __actionStore: Map<string, any> }).__actionStore;

function baseParams(overrides: Partial<Parameters<typeof AiActionService.proposeAction>[0]> = {}) {
  return {
    workspaceId: 'ws-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    toolUseId: 'tooluse-1',
    toolName: 'publish_listing',
    toolCategory: 'engage' as const,
    preview: async () => ({ action: 'publish_listing', title: 'Prada sneakers' }),
    input: { listingId: 'listing-1' },
    ...overrides,
  };
}

describe('AiActionService.proposeAction', () => {
  beforeEach(() => {
    __actionStore.clear();
    vi.clearAllMocks();
  });

  it('creates a PENDING_CONFIRMATION action with the given preview as its summary', async () => {
    const action = await AiActionService.proposeAction(baseParams());

    expect(action.status).toBe('PENDING_CONFIRMATION');
    expect(action.confirmationRequired).toBe(true);
    expect(action.summary).toEqual({ action: 'publish_listing', title: 'Prada sneakers' });
    expect(action.type).toBe('publish_listing');
    expect(action.category).toBe('engage');
  });

  it('sets an expiresAt roughly 15 minutes in the future', async () => {
    const before = Date.now();
    const action = await AiActionService.proposeAction(baseParams());
    const expiresAtMs = new Date(action.expiresAt).getTime();

    expect(expiresAtMs).toBeGreaterThan(before + 14 * 60 * 1000);
    expect(expiresAtMs).toBeLessThan(before + 16 * 60 * 1000);
  });

  it('the SAME (conversationId, toolUseId) proposes only once — idempotent creation', async () => {
    const first = await AiActionService.proposeAction(baseParams());
    const second = await AiActionService.proposeAction(baseParams());

    expect(second.id).toBe(first.id);
    expect(__actionStore.size).toBe(1);
  });

  it('a DIFFERENT toolUseId in the same conversation creates a distinct action', async () => {
    const first = await AiActionService.proposeAction(baseParams());
    const second = await AiActionService.proposeAction(baseParams({ toolUseId: 'tooluse-2' }));

    expect(second.id).not.toBe(first.id);
    expect(__actionStore.size).toBe(2);
  });

  it('the same toolUseId in a DIFFERENT workspace never collides with another workspace\'s action', async () => {
    const wsA = await AiActionService.proposeAction(baseParams({ workspaceId: 'ws-A' }));
    const wsB = await AiActionService.proposeAction(baseParams({ workspaceId: 'ws-B' }));

    expect(wsA.id).not.toBe(wsB.id);
  });
});

describe('AiActionService.getAction — workspace isolation', () => {
  beforeEach(() => {
    __actionStore.clear();
    vi.clearAllMocks();
  });

  it('returns the action for the workspace that owns it', async () => {
    const created = await AiActionService.proposeAction(baseParams({ workspaceId: 'ws-A' }));
    const read = await AiActionService.getAction('ws-A', created.id);
    expect(read?.id).toBe(created.id);
  });

  it('returns null for an action that belongs to a DIFFERENT workspace (never leaks its existence)', async () => {
    const created = await AiActionService.proposeAction(baseParams({ workspaceId: 'ws-A' }));
    const read = await AiActionService.getAction('ws-B', created.id);
    expect(read).toBeNull();
  });

  it('returns null for a genuinely unknown action id', async () => {
    const read = await AiActionService.getAction('ws-A', 'does-not-exist');
    expect(read).toBeNull();
  });
});

describe('AiActionService.confirmAndExecute — the real pipeline', () => {
  beforeEach(() => {
    __actionStore.clear();
    vi.clearAllMocks();
  });

  it('runs PENDING_CONFIRMATION -> CONFIRMED -> EXECUTING -> COMPLETED and calls the tool handler exactly once', async () => {
    const proposed = await AiActionService.proposeAction(baseParams());
    const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(result?.status).toBe('COMPLETED');
    expect(result?.result).toEqual({ simulated: true, message: 'ok' });
    expect(publishHandler).toHaveBeenCalledTimes(1);
    // Phase 12C-Offline: the action's own conversationId/userId (captured
    // at proposeAction time) are now threaded through as a 3rd argument.
    expect(publishHandler).toHaveBeenCalledWith('ws-1', { listingId: 'listing-1' }, { conversationId: 'conv-1', userId: 'user-1' });
  });

  it('a tool handler that throws lands the action on FAILED with a short, sanitized error — never the raw exception text', async () => {
    const proposed = await AiActionService.proposeAction(baseParams({ toolName: 'failing_tool' }));
    const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(result?.status).toBe('FAILED');
    expect(result?.error).toBe('Action execution failed');
    expect(result?.error).not.toContain('boom');
    expect(result?.error).not.toContain('raw internal detail');
  });

  it('cross-tenant: workspace B cannot confirm workspace A\'s action', async () => {
    const proposed = await AiActionService.proposeAction(baseParams({ workspaceId: 'ws-A' }));
    const result = await AiActionService.confirmAndExecute('ws-B', 'user-B', proposed.id);

    expect(result).toBeNull();
    expect(publishHandler).not.toHaveBeenCalled();
  });

  it('idempotence: confirming an already-COMPLETED action again returns the SAME stored result without re-running the handler', async () => {
    const proposed = await AiActionService.proposeAction(baseParams());
    const first = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
    const second = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(second).toEqual(first);
    expect(publishHandler).toHaveBeenCalledTimes(1); // not 2
  });

  it('idempotence: a double-click (two confirms fired back to back) still only executes once', async () => {
    const proposed = await AiActionService.proposeAction(baseParams());

    const [a, b] = await Promise.all([
      AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
      AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
    ]);

    expect(publishHandler).toHaveBeenCalledTimes(1);
    // Both calls resolve to a real, non-null outcome — never a crash from the race.
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it('a CANCELLED action can never be confirmed afterward', async () => {
    const proposed = await AiActionService.proposeAction(baseParams());
    await AiActionService.cancelAction('ws-1', 'user-1', proposed.id);

    const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(result?.status).toBe('CANCELLED');
    expect(publishHandler).not.toHaveBeenCalled();
  });

  it('an EXPIRED confirmation can never be executed', async () => {
    const proposed = await AiActionService.proposeAction(baseParams());
    // Force it into the past directly in the store — simulates the TTL having elapsed.
    __actionStore.get(proposed.id).expiresAt = new Date(Date.now() - 1000);

    const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(result?.status).toBe('EXPIRED');
    expect(publishHandler).not.toHaveBeenCalled();
  });

  it('a genuinely unknown action id resolves to null (never throws)', async () => {
    const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', 'does-not-exist');
    expect(result).toBeNull();
  });
});

describe('AiActionService.cancelAction', () => {
  beforeEach(() => {
    __actionStore.clear();
    vi.clearAllMocks();
  });

  it('cancels a PENDING_CONFIRMATION action', async () => {
    const proposed = await AiActionService.proposeAction(baseParams());
    const result = await AiActionService.cancelAction('ws-1', 'user-1', proposed.id);
    expect(result?.status).toBe('CANCELLED');
  });

  it('cannot cancel an action that is already COMPLETED', async () => {
    const proposed = await AiActionService.proposeAction(baseParams());
    await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    const result = await AiActionService.cancelAction('ws-1', 'user-1', proposed.id);
    expect(result?.status).toBe('COMPLETED'); // unchanged — cancel had no effect
  });

  it('cross-tenant: workspace B cannot cancel workspace A\'s action', async () => {
    const proposed = await AiActionService.proposeAction(baseParams({ workspaceId: 'ws-A' }));
    const result = await AiActionService.cancelAction('ws-B', 'user-B', proposed.id);
    expect(result).toBeNull();
  });
});
