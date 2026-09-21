/**
 * End-to-end proof that the race-condition fix actually closes the gap a
 * read-only audit found in AiUsageService V1: two concurrent requests
 * sharing one workspace's AI Units quota must never BOTH actually execute
 * a handler when the quota can only afford one. Uses the REAL
 * AiAgentService/AiActionService AND the REAL AiUsageService (reserve/
 * finalize/release, backed by the same in-memory Prisma double used in
 * ai-usage-service.test.ts) — only AiEntitlementService, Anthropic, and
 * each tool's own downstream service are mocked, so this is a genuine
 * Promise.all race through the real dispatch code, not just a unit test
 * of AiUsageService in isolation (see ai-usage-service.test.ts for those).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class RateLimitError extends Error {}
  class MockAnthropic {
    messages = { create: createMock };
    constructor(_opts: { apiKey: string }) {}
  }
  (MockAnthropic as any).RateLimitError = RateLimitError;
  return { default: MockAnthropic };
});

const {
  workspaceFindUniqueMock,
  planFindUniqueMock,
  overrideStore,
  periodStore,
  eventStore,
  actionStore,
  searchMock,
  getOrderMock,
  sendToFulfillmentMock,
  partnerFindManyMock,
} = vi.hoisted(() => ({
  workspaceFindUniqueMock: vi.fn(),
  planFindUniqueMock: vi.fn(),
  overrideStore: new Map<string, any>(),
  periodStore: new Map<string, any>(),
  eventStore: new Map<string, any>(),
  actionStore: new Map<string, any>(),
  searchMock: vi.fn(),
  getOrderMock: vi.fn(),
  sendToFulfillmentMock: vi.fn(),
  partnerFindManyMock: vi.fn(),
}));

let periodIdCounter = 0;
let eventIdCounter = 0;
let actionIdCounter = 0;

function periodKey(workspaceId: string, periodStart: Date, periodEnd: Date) {
  return `${workspaceId}|${periodStart.toISOString()}|${periodEnd.toISOString()}`;
}
function eventKey(workspaceId: string, idempotencyKey: string) {
  return `${workspaceId}|${idempotencyKey}`;
}
function p2002(): never {
  throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
}
function matchesAction(row: any, where: any): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.workspaceId !== undefined && row.workspaceId !== where.workspaceId) return false;
  if (where.idempotencyKey !== undefined && row.idempotencyKey !== where.idempotencyKey) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  return true;
}

vi.mock('@/lib/prisma', () => {
  const client = {
    workspace: { findUnique: workspaceFindUniqueMock },
    plan: { findUnique: planFindUniqueMock },
    agentConversation: { findFirst: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'conv-new' }) },
    agentMessage: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    fulfillmentPartner: { findMany: partnerFindManyMock, findUnique: vi.fn() },
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
    workspaceAiOverride: {
      findUnique: vi.fn(async ({ where }: any) => overrideStore.get(where.workspaceId) ?? null),
    },
    aiUsagePeriod: {
      findUnique: vi.fn(async ({ where }: any) => {
        const k = where.workspaceId_periodStart_periodEnd;
        const row = periodStore.get(periodKey(k.workspaceId, k.periodStart, k.periodEnd));
        return row ? { ...row } : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const k = periodKey(data.workspaceId, data.periodStart, data.periodEnd);
        if (periodStore.has(k)) p2002();
        const row = { id: `period-${++periodIdCounter}`, unitsConsumed: 0, unitsReserved: 0, ...data };
        periodStore.set(k, row);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of periodStore.values()) {
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.workspaceId !== undefined && row.workspaceId !== where.workspaceId) continue;
          if (data.unitsConsumed?.increment !== undefined) row.unitsConsumed += data.unitsConsumed.increment;
          if (data.unitsReserved?.increment !== undefined) row.unitsReserved += data.unitsReserved.increment;
          if (data.unitsReserved?.decrement !== undefined) row.unitsReserved -= data.unitsReserved.decrement;
          count++;
        }
        return { count };
      }),
    },
    aiUsageEvent: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id !== undefined) {
          for (const row of eventStore.values()) if (row.id === where.id) return { ...row };
          return null;
        }
        const k = where.workspaceId_idempotencyKey;
        const row = eventStore.get(eventKey(k.workspaceId, k.idempotencyKey));
        return row ? { ...row } : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const k = eventKey(data.workspaceId, data.idempotencyKey);
        if (eventStore.has(k)) p2002();
        const row = { id: `event-${++eventIdCounter}`, ...data };
        eventStore.set(k, row);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of eventStore.values()) {
          if (row.id !== where.id) continue;
          if (where.status !== undefined && row.status !== where.status) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      }),
    },
    // Mirrors AiUsageService.reserveUsage's real raw SQL exactly — see
    // ai-usage-service.test.ts's own mock for the full rationale.
    $executeRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: any[]) => {
      const [units, periodId, , limit] = values;
      const row = [...periodStore.values()].find((r) => r.id === periodId);
      if (!row) return 0;
      if (row.unitsConsumed + row.unitsReserved + units <= limit) {
        row.unitsReserved += units;
        return 1;
      }
      return 0;
    }),
  };
  return { default: client, prisma: client };
});

vi.mock('@/services/sourcing/SourcingService', () => ({
  SourcingService: { search: searchMock },
}));
vi.mock('@/services/OrderService', () => ({
  OrderService: { getOrder: getOrderMock },
}));
vi.mock('@/services/FulfillmentService', () => ({
  FulfillmentService: { sendToFulfillment: sendToFulfillmentMock },
}));
// This file is specifically about AiUsageService's race-condition fix —
// entitlement is a separate, already-tested concern (see
// ai-entitlement-service.test.ts / ai-agent-entitlement-integration.test.ts).
vi.mock('@/services/ai/AiEntitlementService', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/AiEntitlementService')>('@/services/ai/AiEntitlementService');
  return { ...actual, AiEntitlementService: { canUseCapability: vi.fn().mockResolvedValue(true) } };
});

import { AiAgentService } from '@/services/ai/AiAgentService';
import { AiActionService } from '@/services/ai/AiActionService';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';

const BUSINESS_PLAN = { id: 'plan-business', name: 'business', aiAssistant: true, fulfillmentEnabled: true };

function makeWorkspace() {
  return {
    id: 'ws-1',
    subscription: {
      id: 'sub-1',
      planId: BUSINESS_PLAN.id,
      status: 'active',
      stripeSubscriptionId: 'sub_stripe_1',
      currentPeriodStart: new Date('2026-03-10T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-04-10T00:00:00.000Z'),
      plan: BUSINESS_PLAN,
    },
  };
}

function toolUseResponse(name: string, input: unknown, id: string) {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] };
}
function textOnlyResponse(text: string) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  overrideStore.clear();
  periodStore.clear();
  eventStore.clear();
  actionStore.clear();
  (AiAgentService as any).client = null;
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  workspaceFindUniqueMock.mockResolvedValue(makeWorkspace());
  planFindUniqueMock.mockResolvedValue({ id: 'plan-free', name: 'free', aiAssistant: false, fulfillmentEnabled: false });
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('Race-condition fix — read/write tools via the real AiAgentService.sendMessage', () => {
  it('quota=3 (search_products costs 3): two concurrent turns each requesting search_products -> only ONE handler actually runs SourcingService.search', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 3 });
    searchMock.mockResolvedValue({ status: 'SOURCE_NOT_CONFIGURED', results: [], providerErrors: [] });

    // Keyed by each call's own first message (the original user turn,
    // stable within one conversation's own iterations but distinct
    // between the two concurrent conversations below) rather than a
    // shared call counter — two concurrent sendMessage() calls interleave
    // their internal createMock invocations in an order this test must
    // not assume, so a simple global counter would misattribute which
    // conversation gets the tool_use vs the final text response.
    const answeredOnce = new Set<string>();
    createMock.mockImplementation(async (args: any) => {
      const conversationKey = JSON.stringify(args.messages[0]);
      if (!answeredOnce.has(conversationKey)) {
        answeredOnce.add(conversationKey);
        // Each sendMessage() call gets its own Anthropic tool_use id — a
        // genuinely distinct real toolUseId per concurrent request,
        // exactly like two real, simultaneous HTTP requests would produce.
        const toolUseId = conversationKey.includes('again') ? 'tu-B' : 'tu-A';
        return toolUseResponse('search_products', { query: 'Prada sneakers' }, toolUseId);
      }
      return textOnlyResponse('done');
    });

    const [turnA, turnB] = await Promise.all([
      AiAgentService.sendMessage('ws-1', 'user-1', 'find Prada sneakers'),
      AiAgentService.sendMessage('ws-1', 'user-1', 'find Prada sneakers again'),
    ]);

    // The critical proof: the real downstream handler ran at most once —
    // in the V1 design (hasQuotaRemaining -> handler -> recordUsage) this
    // would have been called TWICE (both requests would pass the
    // non-atomic pre-check before either had reserved anything).
    expect(searchMock).toHaveBeenCalledTimes(1);

    const results = [turnA.toolCalls[0]?.result, turnB.toolCalls[0]?.result] as any[];
    const refused = results.filter((r) => r?.error);
    const succeeded = results.filter((r) => !r?.error);
    expect(refused).toHaveLength(1);
    expect(succeeded).toHaveLength(1);
    expect(refused[0].error).toMatch(/quota/i);

    const period = [...periodStore.values()][0];
    expect(period.unitsConsumed + period.unitsReserved).toBeLessThanOrEqual(3);
  });
});

describe('Race-condition fix — engage tools via the real AiActionService.confirmAndExecute', () => {
  async function proposeSendToFulfillment(orderId: string, toolUseId: string) {
    const tool = AiToolRegistry.get('send_to_fulfillment')!;
    const input = { orderId };
    const preview = await tool.preview!('ws-1', input as any);
    return AiActionService.proposeAction({
      workspaceId: 'ws-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      toolUseId,
      toolName: tool.name,
      toolCategory: tool.category,
      preview: async () => preview,
      input,
    });
  }

  it('quota=5 (send_to_fulfillment costs 5): two DIFFERENT AgentActions confirmed concurrently -> only ONE handler actually runs FulfillmentService.sendToFulfillment', async () => {
    overrideStore.set('ws-1', { monthlyUnitsLimit: 5 });
    partnerFindManyMock.mockResolvedValue([{ id: 'partner-1', name: 'ShipMock France', status: 'active', country: 'FR', costPerOrder: 5, processingTime: 24, deliveryTime: 48 }]);
    getOrderMock.mockImplementation(async (orderId: string) => ({
      id: orderId,
      workspaceId: 'ws-1',
      status: 'pending',
      fulfillmentOrder: null,
      items: [{ productId: 'product-1', title: 'Sneakers', quantity: 1, price: 100 }],
    }));
    sendToFulfillmentMock.mockResolvedValue({ id: 'fo-1', status: 'pending' });

    const actionA = await proposeSendToFulfillment('order-A', 'tu-a');
    const actionB = await proposeSendToFulfillment('order-B', 'tu-b');
    expect(actionA.status).toBe('PENDING_CONFIRMATION');
    expect(actionB.status).toBe('PENDING_CONFIRMATION');
    expect(sendToFulfillmentMock).not.toHaveBeenCalled(); // proposing never executes anything

    const [resultA, resultB] = await Promise.all([
      AiActionService.confirmAndExecute('ws-1', 'user-1', actionA.id),
      AiActionService.confirmAndExecute('ws-1', 'user-1', actionB.id),
    ]);

    // The critical proof: only one real FulfillmentOrder creation call
    // ever happened, even though both actions independently passed their
    // own EXECUTING transition (they are different AgentActions — the
    // per-action state machine alone does not protect the SHARED
    // workspace quota; only AiUsageService.reserveUsage does).
    expect(sendToFulfillmentMock).toHaveBeenCalledTimes(1);

    const statuses = [resultA?.status, resultB?.status].sort();
    expect(statuses).toEqual(['COMPLETED', 'FAILED']);
    const failedOne = resultA?.status === 'FAILED' ? resultA : resultB;
    expect(failedOne?.error).toMatch(/quota/i);

    const period = [...periodStore.values()][0];
    expect(period.unitsConsumed + period.unitsReserved).toBeLessThanOrEqual(5);
  });
});
