/**
 * Behavioral tests for AiUsageService — the commercial AI Units quota
 * layer. Uses the REAL SubscriptionService (never mocked) so period/limit
 * resolution is proven to build on it rather than duplicate its logic —
 * only prisma.workspace/plan/workspaceAiOverride/aiUsagePeriod/aiUsageEvent
 * are mocked, as a small in-memory store faithfully reproducing Postgres's
 * own UNIQUE-constraint (P2002) and atomic-conditional-UPDATE semantics —
 * the same style already established in ai-action-service.test.ts and
 * subscription-status-access.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { workspaceFindUniqueMock, planFindUniqueMock, overrideStore, periodStore, eventStore } = vi.hoisted(() => ({
  workspaceFindUniqueMock: vi.fn(),
  planFindUniqueMock: vi.fn(),
  overrideStore: new Map<string, any>(),
  periodStore: new Map<string, any>(), // key: `${workspaceId}|${periodStart.toISOString()}|${periodEnd.toISOString()}`
  eventStore: new Map<string, any>(), // key: `${workspaceId}|${idempotencyKey}`
}));

let periodIdCounter = 0;
let eventIdCounter = 0;

function periodKey(workspaceId: string, periodStart: Date, periodEnd: Date) {
  return `${workspaceId}|${periodStart.toISOString()}|${periodEnd.toISOString()}`;
}
function eventKey(workspaceId: string, idempotencyKey: string) {
  return `${workspaceId}|${idempotencyKey}`;
}

function p2002(): never {
  throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

vi.mock('@/lib/prisma', () => {
  const client = {
    workspace: { findUnique: workspaceFindUniqueMock },
    plan: { findUnique: planFindUniqueMock },
    workspaceAiOverride: {
      findUnique: vi.fn(async ({ where }: any) => overrideStore.get(where.workspaceId) ?? null),
    },
    aiUsagePeriod: {
      findUnique: vi.fn(async ({ where }: any) => {
        const k = where.workspaceId_periodStart_periodEnd;
        return periodStore.get(periodKey(k.workspaceId, k.periodStart, k.periodEnd)) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const k = periodKey(data.workspaceId, data.periodStart, data.periodEnd);
        // Real Postgres UNIQUE constraint: a create() for a key that
        // already exists never succeeds — no internal await between this
        // check and the write below, matching a single atomic INSERT.
        if (periodStore.has(k)) p2002();
        const row = { id: `period-${++periodIdCounter}`, unitsConsumed: 0, ...data };
        periodStore.set(k, row);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of periodStore.values()) {
          if (row.id !== where.id) continue;
          if (where.unitsConsumed?.lte !== undefined && !(row.unitsConsumed <= where.unitsConsumed.lte)) continue;
          if (data.unitsConsumed?.increment !== undefined) row.unitsConsumed += data.unitsConsumed.increment;
          count++;
        }
        return { count };
      }),
    },
    aiUsageEvent: {
      findUnique: vi.fn(async ({ where }: any) => {
        const k = where.workspaceId_idempotencyKey;
        return eventStore.get(eventKey(k.workspaceId, k.idempotencyKey)) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const k = eventKey(data.workspaceId, data.idempotencyKey);
        if (eventStore.has(k)) p2002();
        const row = { id: `event-${++eventIdCounter}`, ...data };
        eventStore.set(k, row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        for (const row of eventStore.values()) {
          if (row.id === where.id) {
            Object.assign(row, data);
            return { ...row };
          }
        }
        throw new Error('AiUsageEvent not found');
      }),
    },
  };
  return { default: client, prisma: client };
});

import { AiUsageService } from '@/services/ai/AiUsageService';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { TOOL_USAGE_UNITS, getToolUsageUnits } from '@/services/ai/aiUsageConfig';

const FREE_PLAN = { id: 'plan-free', name: 'free', aiAssistant: false, fulfillmentEnabled: false };
const BUSINESS_PLAN = { id: 'plan-business', name: 'business', aiAssistant: true, fulfillmentEnabled: true };

function makeWorkspaceWithSubscription(status: string, plan: any, overrides: Partial<{ currentPeriodStart: Date | null; currentPeriodEnd: Date | null }> = {}) {
  return {
    id: 'ws-1',
    subscription: {
      id: 'sub-1',
      planId: plan.id,
      status,
      stripeSubscriptionId: 'sub_stripe_1',
      currentPeriodStart: overrides.currentPeriodStart ?? new Date('2026-03-10T00:00:00.000Z'),
      currentPeriodEnd: overrides.currentPeriodEnd ?? new Date('2026-04-10T00:00:00.000Z'),
      plan,
    },
  };
}
function makeFreeWorkspaceNoSubscription() {
  return { id: 'ws-1', subscription: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  overrideStore.clear();
  periodStore.clear();
  eventStore.clear();
  planFindUniqueMock.mockResolvedValue(FREE_PLAN);
});

describe('AiUsageService — period resolution', () => {
  it('a real Stripe-backed subscription uses its own exact currentPeriodStart/End, never a fabricated calendar month', async () => {
    workspaceFindUniqueMock.mockResolvedValue(
      makeWorkspaceWithSubscription('active', BUSINESS_PLAN, {
        currentPeriodStart: new Date('2026-03-17T08:00:00.000Z'),
        currentPeriodEnd: new Date('2026-04-17T08:00:00.000Z'),
      })
    );

    const result = await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' });
    expect(result.status).toBe('RECORDED');

    const row = [...periodStore.values()][0];
    expect(row.periodStart.toISOString()).toBe('2026-03-17T08:00:00.000Z');
    expect(row.periodEnd.toISOString()).toBe('2026-04-17T08:00:00.000Z');
  });

  it('a workspace with NO real subscription (pure Free) uses a UTC calendar month, never a rolling window', async () => {
    workspaceFindUniqueMock.mockResolvedValue(makeFreeWorkspaceNoSubscription());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:34:56.000Z'));

    try {
      const result = await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' });
      expect(result.status).toBe('RECORDED');

      const row = [...periodStore.values()][0];
      expect(row.periodStart.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(row.periodEnd.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AiUsageService.hasQuotaRemaining / recordUsage — exact quota, REJECTED, no double counting', () => {
  beforeEach(() => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspaceWithSubscription('active', BUSINESS_PLAN));
  });

  it('allows usage exactly up to the limit, refuses the unit that would exceed it', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 5 });

    // publish_listing costs 5 — exactly the limit.
    const r1 = await AiUsageService.recordUsage('ws-1', { toolName: 'publish_listing', idempotencyKey: 'action:a-1' });
    expect(r1.status).toBe('RECORDED');

    const check = await AiUsageService.hasQuotaRemaining('ws-1', 'get_order'); // 1 more unit -> would be 6 > 5
    expect(check).toEqual({ allowed: false, reason: 'quota_exceeded' });

    const r2 = await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-2' });
    expect(r2.status).toBe('REJECTED');
    expect(r2.reason).toBe('quota_exceeded');

    const snapshot = await AiUsageService.getUsageForCurrentPeriod('ws-1');
    expect(snapshot?.unitsConsumed).toBe(5); // the REJECTED event never incremented the counter
  });

  it('a REJECTED event is persisted (never deleted) and never counted', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 2 });
    await AiUsageService.recordUsage('ws-1', { toolName: 'search_products', idempotencyKey: 'tool:conv-1:tu-1' }); // 3 units > 2 -> REJECTED

    expect(eventStore.size).toBe(1);
    const stored = [...eventStore.values()][0];
    expect(stored.status).toBe('REJECTED');
    const snapshot = await AiUsageService.getUsageForCurrentPeriod('ws-1');
    expect(snapshot?.unitsConsumed).toBe(0);
  });

  it('a tool with no commercial cost (simulate_engage_action) is always allowed and records nothing', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 0 }); // would refuse anything real
    const check = await AiUsageService.hasQuotaRemaining('ws-1', 'simulate_engage_action');
    expect(check).toEqual({ allowed: true });

    const result = await AiUsageService.recordUsage('ws-1', { toolName: 'simulate_engage_action', idempotencyKey: 'action:a-1' });
    expect(result).toEqual({ status: 'RECORDED', eventId: null, units: 0 });
    expect(eventStore.size).toBe(0);
  });
});

describe('AiUsageService — idempotence and retry', () => {
  beforeEach(() => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspaceWithSubscription('active', BUSINESS_PLAN));
    overrideStore.set('ws-1', { monthlyUnitsLimit: 100 });
  });

  it('the exact same idempotencyKey recorded twice consumes only once', async () => {
    const first = await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' });
    const second = await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' });

    expect(second).toEqual(first);
    const snapshot = await AiUsageService.getUsageForCurrentPeriod('ws-1');
    expect(snapshot?.unitsConsumed).toBe(1); // not 2
  });

  it('a retry after a REJECTED (quota exceeded) event replays the same REJECTED outcome, never re-attempts the increment', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 0 });
    const first = await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' });
    expect(first.status).toBe('REJECTED');

    const retry = await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' });
    expect(retry.status).toBe('REJECTED');
    expect(retry.eventId).toBe(first.eventId);
  });
});

describe('AiUsageService — concurrency', () => {
  beforeEach(() => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspaceWithSubscription('active', BUSINESS_PLAN));
  });

  it('double confirmation concurrent (same idempotencyKey) never double-counts — at most one consumption', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 100 });

    const [a, b] = await Promise.all([
      AiUsageService.recordUsage('ws-1', { toolName: 'publish_listing', idempotencyKey: 'action:a-1' }),
      AiUsageService.recordUsage('ws-1', { toolName: 'publish_listing', idempotencyKey: 'action:a-1' }),
    ]);

    expect(a.status).toBe('RECORDED');
    expect(b.status).toBe('RECORDED');
    expect(a.eventId).toBe(b.eventId); // same underlying event — only one really won the insert

    const snapshot = await AiUsageService.getUsageForCurrentPeriod('ws-1');
    expect(snapshot?.unitsConsumed).toBe(5); // publish_listing's own cost, counted exactly once
  });

  it('two DIFFERENT concurrent consumptions that would together exceed the limit never both succeed', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 5 });

    const [a, b] = await Promise.all([
      AiUsageService.recordUsage('ws-1', { toolName: 'publish_listing', idempotencyKey: 'action:a-1' }), // 5 units
      AiUsageService.recordUsage('ws-1', { toolName: 'publish_etsy_listing', idempotencyKey: 'action:a-2' }), // 5 units
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['RECORDED', 'REJECTED']); // exactly one wins, never both

    const snapshot = await AiUsageService.getUsageForCurrentPeriod('ws-1');
    expect(snapshot?.unitsConsumed).toBe(5); // never 10
  });

  it('a period row is created exactly once under concurrent first use of the same period', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 100 });

    await Promise.all([
      AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' }),
      AiUsageService.recordUsage('ws-1', { toolName: 'get_orders', idempotencyKey: 'tool:conv-1:tu-2' }),
    ]);

    expect(periodStore.size).toBe(1); // one row for the (workspace, period) pair, never two
    const snapshot = await AiUsageService.getUsageForCurrentPeriod('ws-1');
    expect(snapshot?.unitsConsumed).toBe(2); // both 1-unit reads counted
  });
});

describe('AiUsageService — plan upgrade / downgrade / renewal', () => {
  it('upgrade mid-period: the limit check reflects the new plan immediately, the already-consumed counter is untouched', async () => {
    const period = { currentPeriodStart: new Date('2026-03-10T00:00:00.000Z'), currentPeriodEnd: new Date('2026-04-10T00:00:00.000Z') };
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspaceWithSubscription('active', FREE_PLAN, period));

    await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' }); // Free plan: 50/month, consumes 1

    // "Upgrade" mid-period: same period boundaries (a real Stripe upgrade
    // typically keeps them), new plan.
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspaceWithSubscription('active', BUSINESS_PLAN, period));

    const snapshot = await AiUsageService.getUsageForCurrentPeriod('ws-1');
    expect(snapshot?.unitsConsumed).toBe(1); // unchanged by the upgrade itself
    expect(snapshot?.unitsLimit).toBe(5000); // immediately reflects Business's own default, not Free's stale 50
  });

  it('downgrade mid-period: same period key, the counter is preserved, only the fresh limit check changes', async () => {
    const period = { currentPeriodStart: new Date('2026-03-10T00:00:00.000Z'), currentPeriodEnd: new Date('2026-04-10T00:00:00.000Z') };
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspaceWithSubscription('active', BUSINESS_PLAN, period));

    await AiUsageService.recordUsage('ws-1', { toolName: 'publish_listing', idempotencyKey: 'action:a-1' }); // 5 units

    workspaceFindUniqueMock.mockResolvedValue(makeWorkspaceWithSubscription('active', FREE_PLAN, period));

    const check = await AiUsageService.hasQuotaRemaining('ws-1', 'publish_listing'); // 5 + 5 = 10 > Free's 50? actually Free=50 allows it
    expect(check.allowed).toBe(true); // still well under Free's own 50/month default
    expect(periodStore.size).toBe(1); // same period row, not recreated
  });

  it('renewal: new real Stripe period boundaries produce a NEW, independent AiUsagePeriod row', async () => {
    workspaceFindUniqueMock.mockResolvedValue(
      makeWorkspaceWithSubscription('active', BUSINESS_PLAN, {
        currentPeriodStart: new Date('2026-03-10T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-04-10T00:00:00.000Z'),
      })
    );
    await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' });

    // Renewal: Stripe's webhook advances the real period boundaries.
    workspaceFindUniqueMock.mockResolvedValue(
      makeWorkspaceWithSubscription('active', BUSINESS_PLAN, {
        currentPeriodStart: new Date('2026-04-10T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-05-10T00:00:00.000Z'),
      })
    );

    const snapshotBeforeAnyNewUsage = await AiUsageService.getUsageForCurrentPeriod('ws-1');
    expect(snapshotBeforeAnyNewUsage?.unitsConsumed).toBe(0); // the new period starts fresh — a pure read never creates a row
    expect(periodStore.size).toBe(1); // read-only: no new row created just by checking

    await AiUsageService.recordUsage('ws-1', { toolName: 'get_orders', idempotencyKey: 'tool:conv-2:tu-1' });
    expect(periodStore.size).toBe(2); // a genuinely new, independent row for the new period
    const oldRow = [...periodStore.values()].find((r) => r.periodStart.toISOString() === '2026-03-10T00:00:00.000Z');
    expect(oldRow.unitsConsumed).toBe(1); // the old period's row is preserved, untouched, for audit — never merged or reset
  });
});

describe('AiUsageService — Enterprise override', () => {
  beforeEach(() => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspaceWithSubscription('active', BUSINESS_PLAN));
  });

  it('an override, when present, always wins over the plan default', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 20000 });
    const snapshot = await AiUsageService.getUsageForCurrentPeriod('ws-1');
    expect(snapshot?.unitsLimit).toBe(20000); // not Business's own 5000 default
  });

  it('no override -> falls back cleanly to the plan default, works correctly with zero override rows', async () => {
    const snapshot = await AiUsageService.getUsageForCurrentPeriod('ws-1');
    expect(snapshot?.unitsLimit).toBe(5000);
  });

  it('an invalid override (zero) fails closed — refuses usage rather than falling back to the plan default', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 0 });
    const result = await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' });
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('no_quota_configured');
  });

  it('an invalid override (negative) also fails closed', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: -5 });
    const check = await AiUsageService.hasQuotaRemaining('ws-1', 'get_order');
    expect(check).toEqual({ allowed: false, reason: 'no_quota_configured' });
  });
});

describe('AiUsageService — fail-closed edge cases', () => {
  it('a nonexistent workspace resolves through SubscriptionService\'s own Free-plan fallback, never throws — the same behavior AiEntitlementService already relies on, never duplicated or diverged from here', async () => {
    workspaceFindUniqueMock.mockResolvedValue(null);
    const check = await AiUsageService.hasQuotaRemaining('ws-does-not-exist', 'get_order');
    // SubscriptionService.getSubscription treats a missing workspace
    // identically to "no subscription" (Free plan, status 'active') — see
    // that service's own code. AiUsageService never re-derives this
    // distinction itself; Free's own configured default (50/month, see
    // aiUsageConfig.ts) legitimately allows a single 1-unit read.
    expect(check).toEqual({ allowed: true });
  });

  it('subscription references a plan not in PLAN_MONTHLY_AI_UNITS -> refused, never treated as unlimited', async () => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspaceWithSubscription('active', { ...BUSINESS_PLAN, name: 'some_future_plan' }));
    const result = await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' });
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('no_quota_configured');
  });

  it('an unexpected DB error resolving the subscription -> fails closed, never throws past recordUsage', async () => {
    workspaceFindUniqueMock.mockRejectedValue(new Error('connection refused: raw internal detail'));
    const result = await AiUsageService.recordUsage('ws-1', { toolName: 'get_order', idempotencyKey: 'tool:conv-1:tu-1' });
    expect(result.status).toBe('REJECTED');
  });

  it('an unexpected DB error resolving the override -> fails closed', async () => {
    workspaceFindUniqueMock.mockResolvedValue(makeWorkspaceWithSubscription('active', BUSINESS_PLAN));
    const client = await import('@/lib/prisma');
    (client as any).prisma.workspaceAiOverride.findUnique.mockRejectedValueOnce(new Error('db down'));
    const check = await AiUsageService.hasQuotaRemaining('ws-1', 'get_order');
    expect(check.allowed).toBe(false);
  });

  it('workspace isolation: two workspaces never share a quota counter', async () => {
    workspaceFindUniqueMock.mockImplementation(async ({ where }: any) =>
      where.id === 'ws-A' ? makeWorkspaceWithSubscription('active', BUSINESS_PLAN) : makeWorkspaceWithSubscription('active', FREE_PLAN)
    );
    overrideStore.clear();

    await AiUsageService.recordUsage('ws-A', { toolName: 'publish_listing', idempotencyKey: 'action:a-1' });
    const snapshotA = await AiUsageService.getUsageForCurrentPeriod('ws-A');
    const snapshotB = await AiUsageService.getUsageForCurrentPeriod('ws-B');

    expect(snapshotA?.unitsConsumed).toBe(5);
    expect(snapshotB?.unitsConsumed).toBe(0);
  });
});

describe('aiUsageConfig — barème completeness', () => {
  it('every real tool currently registered in AiToolRegistry has an explicit TOOL_USAGE_UNITS entry', () => {
    for (const tool of AiToolRegistry.list()) {
      expect(Object.prototype.hasOwnProperty.call(TOOL_USAGE_UNITS, tool.name)).toBe(true);
    }
  });

  it('the V1 barème matches exactly what was validated for this task', () => {
    expect(getToolUsageUnits('get_order')).toBe(1);
    expect(getToolUsageUnits('get_orders')).toBe(1);
    expect(getToolUsageUnits('get_listing')).toBe(1);
    expect(getToolUsageUnits('get_listings')).toBe(1);
    expect(getToolUsageUnits('get_shipment')).toBe(1);
    expect(getToolUsageUnits('get_customer')).toBe(1);
    expect(getToolUsageUnits('get_customer_orders')).toBe(1);
    expect(getToolUsageUnits('get_product')).toBe(1);
    expect(getToolUsageUnits('get_inventory')).toBe(1);
    expect(getToolUsageUnits('get_sales_summary')).toBe(1);
    expect(getToolUsageUnits('calculate_margin')).toBe(1);
    expect(getToolUsageUnits('generate_listing_draft')).toBe(2);
    expect(getToolUsageUnits('edit_listing_draft')).toBe(1);
    expect(getToolUsageUnits('search_products')).toBe(3);
    expect(getToolUsageUnits('update_listing')).toBe(3);
    expect(getToolUsageUnits('publish_listing')).toBe(5);
    expect(getToolUsageUnits('publish_etsy_listing')).toBe(5);
    expect(getToolUsageUnits('send_to_fulfillment')).toBe(5);
    expect(getToolUsageUnits('simulate_engage_action')).toBeNull();
  });

  it('an unmapped tool name never crashes and is never treated as commercially costly', () => {
    expect(getToolUsageUnits('some_future_tool_nobody_mapped_yet')).toBeNull();
  });
});
