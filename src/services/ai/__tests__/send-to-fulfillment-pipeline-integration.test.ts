/**
 * End-to-end integration tests for send_to_fulfillment driven through the
 * REAL AiActionService: propose -> confirm -> execute, exactly as a live
 * confirm click would. Proves ADKSY's atomic state-machine idempotence
 * guarantee (Phase 12A) holds for this tool too, and specifically verifies
 * the double-fulfillment risk this task asked to be documented rather than
 * "solved": two separately confirmed actions for the SAME order must never
 * both succeed in creating a FulfillmentOrder — FulfillmentOrder.orderId's
 * real @unique constraint (prisma/schema.prisma) is the actual backstop,
 * exercised here via an in-memory store that enforces the same constraint.
 *
 * OrderService/FulfillmentService/SubscriptionService are mocked wholesale
 * — this file makes ZERO real database calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function matchesAction(row: any, where: any): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.workspaceId !== undefined && row.workspaceId !== where.workspaceId) return false;
  if (where.idempotencyKey !== undefined && row.idempotencyKey !== where.idempotencyKey) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  return true;
}

const {
  actionStore,
  getOrderMock,
  sendToFulfillmentMock,
  hasFeatureMock,
  partnerFindUniqueMock,
  partnerFindManyMock,
} = vi.hoisted(() => ({
  actionStore: new Map<string, any>(),
  getOrderMock: vi.fn(),
  sendToFulfillmentMock: vi.fn(),
  hasFeatureMock: vi.fn(),
  partnerFindUniqueMock: vi.fn(),
  partnerFindManyMock: vi.fn(),
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
    fulfillmentPartner: { findUnique: partnerFindUniqueMock, findMany: partnerFindManyMock },
  },
}));

vi.mock('@/services/OrderService', () => ({
  OrderService: { getOrder: getOrderMock },
}));

vi.mock('@/services/FulfillmentService', () => ({
  FulfillmentService: { sendToFulfillment: sendToFulfillmentMock },
}));

vi.mock('@/services/SubscriptionService', () => ({
  SubscriptionService: { hasFeature: hasFeatureMock },
}));

vi.mock('@/services/ListingService', () => ({
  ListingService: { getListing: vi.fn(), updateListing: vi.fn() },
  getAuthenticatedAdapter: vi.fn(),
}));

import { AiActionService } from '@/services/ai/AiActionService';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    workspaceId: 'ws-1',
    status: 'pending',
    fulfillmentType: 'self',
    fulfillmentOrder: null,
    items: [{ productId: 'product-1', title: 'Prada Sneakers', quantity: 1, price: 449 }],
    ...overrides,
  };
}

function makePartner(overrides: Record<string, any> = {}) {
  return { id: 'partner-1', name: 'ShipMock France', country: 'FR', status: 'active', costPerOrder: 5, processingTime: 24, deliveryTime: 48, ...overrides };
}

async function proposeSendToFulfillment(workspaceId: string, orderId: string, toolUseId = 'tu-fulfillment') {
  const tool = AiToolRegistry.get('send_to_fulfillment')!;
  const input = { orderId };
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

describe('send_to_fulfillment — end-to-end pipeline via the REAL AiActionService', () => {
  beforeEach(() => {
    actionStore.clear();
    actionIdCounter = 0;
    vi.clearAllMocks();
    hasFeatureMock.mockResolvedValue(true);
    partnerFindManyMock.mockResolvedValue([makePartner()]);
  });

  it('propose -> confirm -> COMPLETED, FulfillmentService.sendToFulfillment called exactly once', async () => {
    getOrderMock.mockResolvedValue(makeOrder());
    sendToFulfillmentMock.mockResolvedValue({ id: 'fo-1', status: 'pending' });

    const proposed = await proposeSendToFulfillment('ws-1', 'order-1');
    expect(proposed.status).toBe('PENDING_CONFIRMATION');
    expect(sendToFulfillmentMock).not.toHaveBeenCalled(); // no mutation during proposal

    const confirmed = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

    expect(confirmed?.status).toBe('COMPLETED');
    expect((confirmed?.result as any).success).toBe(true);
    expect(sendToFulfillmentMock).toHaveBeenCalledTimes(1);
    expect(sendToFulfillmentMock).toHaveBeenCalledWith('order-1', 'ws-1', 'partner-1');
  });

  describe('idempotence', () => {
    it('double-click: two confirms fired concurrently still execute the real send AT MOST ONCE', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockResolvedValue({ id: 'fo-1', status: 'pending' });

      const proposed = await proposeSendToFulfillment('ws-1', 'order-1');

      const [a, b] = await Promise.all([
        AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
        AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id),
      ]);

      expect(sendToFulfillmentMock).toHaveBeenCalledTimes(1);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
    });

    it('retry: confirming an already-COMPLETED action again replays the stored result, never re-executes', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockResolvedValue({ id: 'fo-1', status: 'pending' });

      const proposed = await proposeSendToFulfillment('ws-1', 'order-1');

      const first = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      const retry = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(retry).toEqual(first);
      expect(sendToFulfillmentMock).toHaveBeenCalledTimes(1);
    });

    it('an action already FAILED is never retried automatically — confirming again replays the same failure', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockRejectedValue(new Error('Unexpected internal failure'));

      const proposed = await proposeSendToFulfillment('ws-1', 'order-1');

      const first = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      expect(first?.status).toBe('FAILED');

      const again = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);
      expect(again?.status).toBe('FAILED');
      expect(sendToFulfillmentMock).toHaveBeenCalledTimes(1); // not retried
    });

    it('an EXPIRED action can never be confirmed/executed', async () => {
      getOrderMock.mockResolvedValue(makeOrder());

      const proposed = await proposeSendToFulfillment('ws-1', 'order-1');
      actionStore.get(proposed.id).expiresAt = new Date(Date.now() - 1000);

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('EXPIRED');
      expect(sendToFulfillmentMock).not.toHaveBeenCalled();
    });

    it('a cancelled action can never later be confirmed', async () => {
      getOrderMock.mockResolvedValue(makeOrder());

      const proposed = await proposeSendToFulfillment('ws-1', 'order-1');
      await AiActionService.cancelAction('ws-1', 'user-1', proposed.id);

      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('CANCELLED');
      expect(sendToFulfillmentMock).not.toHaveBeenCalled();
    });
  });

  describe('AUDIT — double-fulfillment risk for TWO DIFFERENT actions on the SAME order (§5 of the task)', () => {
    it('DOCUMENTED, NOT INVENTED: two separately proposed actions for the same order each pass their own pre-check, but only ONE real FulfillmentOrder is ever created — ' +
      'the real backstop is FulfillmentOrder.orderId\'s @unique DB constraint (prisma/schema.prisma), simulated here by having the second real call reject exactly as ' +
      'Prisma would on a unique-constraint violation. This tool adds no new guard beyond reusing the real service — see this file\'s own header comment.',
      async () => {
        getOrderMock.mockResolvedValue(makeOrder()); // both proposals see no existing FulfillmentOrder yet
        let created = false;
        sendToFulfillmentMock.mockImplementation(async () => {
          if (created) {
            throw new Error('Unique constraint failed on the fields: (`orderId`)'); // the real DB backstop
          }
          created = true;
          return { id: 'fo-1', status: 'pending' };
        });

        const first = await proposeSendToFulfillment('ws-1', 'order-1', 'tu-1');
        const second = await proposeSendToFulfillment('ws-1', 'order-1', 'tu-2'); // a distinct tool_use

        const firstResult = await AiActionService.confirmAndExecute('ws-1', 'user-1', first.id);
        const secondResult = await AiActionService.confirmAndExecute('ws-1', 'user-1', second.id);

        expect(firstResult?.status).toBe('COMPLETED');
        expect(secondResult?.status).toBe('FAILED'); // the raw Prisma error is never masked as a friendly "already created" success
        expect(sendToFulfillmentMock).toHaveBeenCalledTimes(2); // both were attempted — the DB constraint is what actually prevented the duplicate
      }
    );
  });

  describe('workspace isolation', () => {
    it("workspace B cannot confirm workspace A's send_to_fulfillment action", async () => {
      getOrderMock.mockResolvedValue(makeOrder({ workspaceId: 'ws-A' }));

      const proposed = await proposeSendToFulfillment('ws-A', 'order-1');

      const result = await AiActionService.confirmAndExecute('ws-B', 'user-B', proposed.id);

      expect(result).toBeNull();
      expect(sendToFulfillmentMock).not.toHaveBeenCalled();
    });

    it("an orderId belonging to another workspace never leaks a preview (OrderService.getOrder's own {id, workspaceId} query)", async () => {
      getOrderMock.mockImplementation(async (orderId: string, workspaceId: string) => (workspaceId === 'ws-A' ? makeOrder() : null));

      const tool = AiToolRegistry.get('send_to_fulfillment')!;
      const preview: any = await tool.preview!('ws-B', { orderId: 'order-1' } as any);

      expect(preview.error).toMatch(/not found/i);
    });
  });

  describe('gating / security', () => {
    it('a workspace whose plan does not include fulfillment cannot execute — the real service refusal is preserved as a clear error', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      hasFeatureMock.mockResolvedValue(false); // preview reflects it
      sendToFulfillmentMock.mockRejectedValue(new Error('Fulfillment is not included in your current plan'));

      const proposed = await proposeSendToFulfillment('ws-1', 'order-1');
      expect((proposed.summary as any).fulfillmentEnabledForPlan).toBe(false);

      const confirmed = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(confirmed?.status).toBe('COMPLETED'); // controlled {error}, not a crash
      expect((confirmed?.result as any).error).toBe('Fulfillment is not included in your current plan');
      expect(sendToFulfillmentMock).toHaveBeenCalledTimes(1);
    });

    it('a cancelled order is not blocked by an invented rule — the real service is called exactly as it would be for any other order', async () => {
      getOrderMock.mockResolvedValue(makeOrder({ status: 'cancelled' }));
      sendToFulfillmentMock.mockResolvedValue({ id: 'fo-1', status: 'pending' });

      const proposed = await proposeSendToFulfillment('ws-1', 'order-1');
      expect((proposed.summary as any).orderStatus).toBe('cancelled');

      const confirmed = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(confirmed?.status).toBe('COMPLETED');
      expect(sendToFulfillmentMock).toHaveBeenCalledTimes(1);
    });

    it('no secret ever appears in a FAILED action\'s stored error', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockRejectedValue(new Error('DB connection string: postgres://user:supersecret@host/db'));

      const proposed = await proposeSendToFulfillment('ws-1', 'order-1');
      const result = await AiActionService.confirmAndExecute('ws-1', 'user-1', proposed.id);

      expect(result?.status).toBe('FAILED');
      expect(result?.error).toBe('Action execution failed');
      expect(result?.error).not.toContain('supersecret');
    });
  });
});
