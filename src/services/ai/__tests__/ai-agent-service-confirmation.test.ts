/**
 * Proves the confirmation guarantee at the orchestration level: no matter
 * what the model asks for, AiAgentService NEVER auto-executes a tool
 * categorized 'engage' or 'blocked' — it must always come back as a
 * CONFIRMATION_REQUIRED/NOT_SUPPORTED result plus a populated
 * `pendingConfirmation`, without the handler ever running.
 *
 * AiToolRegistry only has one real tool today (get_order, category
 * 'read'), so this uses fake 'engage'/'blocked' tools via a mocked
 * registry to test the loop's enforcement itself, independent of which
 * real tools exist yet — this is the same guarantee a future
 * publish_listing/send_order_to_fulfillment tool will rely on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentConversation: { findFirst: vi.fn(), create: vi.fn() },
    agentMessage: { findMany: vi.fn(), create: vi.fn() },
    // Phase 12A: an 'engage' tool call now goes through
    // AiActionService.proposeAction, which persists a real AgentAction
    // row — findFirst returning null (no prior row for this
    // idempotencyKey) makes it fall through to create().
    agentAction: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

const engageHandler = vi.fn().mockResolvedValue({ ok: true });
const blockedHandler = vi.fn().mockResolvedValue({ ok: true });

const fakeEngageTool = {
  name: 'publish_listing',
  description: 'fake engage tool for this test',
  category: 'engage' as const,
  inputSchema: { safeParse: (input: unknown) => ({ success: true, data: input }) } as any,
  jsonSchema: { type: 'object' as const, properties: {} },
  handler: engageHandler,
};

const fakeBlockedTool = {
  name: 'purchase_product',
  description: 'fake blocked tool for this test',
  category: 'blocked' as const,
  inputSchema: { safeParse: (input: unknown) => ({ success: true, data: input }) } as any,
  jsonSchema: { type: 'object' as const, properties: {} },
  handler: blockedHandler,
};

// A real Zod schema (not the always-succeeds fake above) — proves the
// Phase 12A hardening: an 'engage' tool's input is validated exactly like
// an auto-executable tool's, never trusted from the model unvalidated.
const strictEngageHandler = vi.fn().mockResolvedValue({ ok: true });
let strictPreviewResult: Record<string, unknown> = { action: 'strict_engage', ready: true };
const strictEngageTool = {
  name: 'strict_engage_action',
  description: 'fake engage tool with real Zod validation, for this test',
  category: 'engage' as const,
  inputSchema: z.object({ listingId: z.string().min(1) }),
  jsonSchema: { type: 'object' as const, properties: { listingId: { type: 'string' } }, required: ['listingId'] },
  handler: strictEngageHandler,
  preview: vi.fn(async () => strictPreviewResult),
};

// This file proves the engage/blocked non-auto-execution guarantee itself
// — entitlement refusal is a separate, already-tested concern (see
// ai-entitlement-service.test.ts). Real AiEntitlementService.canUseCapability
// would call SubscriptionService against a workspace/plan Prisma mock this
// file doesn't set up (only agentConversation/agentMessage/agentAction are
// mocked below) — always-true here keeps this file's own scope narrow.
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
    reserveUsage: vi.fn().mockResolvedValue({ status: 'RESERVED', eventId: 'test-usage-event', units: 0 }),
    finalizeUsage: vi.fn().mockResolvedValue({ status: 'RECORDED' }),
    releaseUsage: vi.fn().mockResolvedValue({ status: 'RELEASED' }),
  },
}));

vi.mock('@/services/ai/AiToolRegistry', () => {
  const tools: unknown[] = [];
  return {
    AiToolRegistry: {
      list: () => tools,
      get: (name: string) => {
        if (name === 'publish_listing') return fakeEngageTool;
        if (name === 'purchase_product') return fakeBlockedTool;
        if (name === 'strict_engage_action') return strictEngageTool;
        return undefined;
      },
      toAnthropicTools: () => [],
      isAutoExecutable: (category: string) => category === 'read' || category === 'write',
    },
  };
});

import { prisma } from '@/lib/prisma';
import { AiAgentService } from '@/services/ai/AiAgentService';

const prismaMock = prisma as unknown as {
  agentConversation: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  agentMessage: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  agentAction: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function toolUseResponse(name: string, input: unknown, id = 'tooluse_1') {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] };
}
function textOnlyResponse(text: string) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}

/**
 * mock.calls stores a reference to the exact `messages` array/object
 * passed in, and AiAgentService mutates that same array on every loop
 * iteration — so inspecting `createMock.mock.calls[i][0].messages` after
 * the whole turn has finished reflects its FINAL state, not the state at
 * the time of call i. This snapshots a deep clone at call time instead.
 */
function queueResponses(...responses: unknown[]): unknown[][] {
  const queue = [...responses];
  const snapshots: unknown[][] = [];
  createMock.mockImplementation(async (args: any) => {
    snapshots.push(JSON.parse(JSON.stringify(args.messages)));
    return queue.shift();
  });
  return snapshots;
}

describe('AiAgentService — engage/blocked tools are never auto-executed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (AiAgentService as any).client = null;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    prismaMock.agentConversation.create.mockResolvedValue({ id: 'conv-new' });
    prismaMock.agentMessage.findMany.mockResolvedValue([]);
    prismaMock.agentMessage.create.mockResolvedValue({});
    prismaMock.agentAction.findFirst.mockResolvedValue(null);
    prismaMock.agentAction.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'action-1',
        workspaceId: data.workspaceId,
        type: data.type,
        category: data.category,
        status: data.status,
        input: data.input,
        summary: data.summary,
        confirmationRequired: data.confirmationRequired,
        expiresAt: data.expiresAt,
        result: null,
        error: null,
      })
    );
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('model requests an "engage" tool -> handler never runs, response asks for confirmation', async () => {
    const snapshots = queueResponses(
      toolUseResponse('publish_listing', { listingId: 'l-1', price: 799 }),
      textOnlyResponse('I have prepared the listing — do you want me to publish it?')
    );

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'publish my listing at 799');

    expect(engageHandler).not.toHaveBeenCalled();
    expect(turn.pendingConfirmation).toMatchObject({
      toolName: 'publish_listing',
      input: { listingId: 'l-1', price: 799 },
      actionId: 'action-1',
    });
    // A real, persisted action id — never null/undefined — is what lets
    // the frontend later call /api/ai/agent/actions/[id]/confirm.
    expect(typeof turn.pendingConfirmation?.actionId).toBe('string');
    expect(turn.pendingConfirmation?.actionId.length).toBeGreaterThan(0);

    const secondCallMessages = snapshots[1] as any[];
    const toolResultContent = JSON.parse(
      secondCallMessages[secondCallMessages.length - 1].content[0].content
    );
    expect(toolResultContent.status).toBe('CONFIRMATION_REQUIRED');
    expect(toolResultContent.actionId).toBe('action-1');

    // The engage tool's handler is still never called from this turn —
    // only AiActionService.confirmAndExecute (a separate, backend-verified
    // confirmation step) is ever allowed to run it.
    expect(prismaMock.agentAction.create).toHaveBeenCalledTimes(1);
  });

  it('model requests a "blocked" tool -> handler never runs, response says not supported', async () => {
    const snapshots = queueResponses(
      toolUseResponse('purchase_product', { sourcingId: 'x' }),
      textOnlyResponse('Automatic purchasing is not available yet.')
    );

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'buy it for me automatically');

    expect(blockedHandler).not.toHaveBeenCalled();
    const secondCallMessages = snapshots[1] as any[];
    const toolResultContent = JSON.parse(
      secondCallMessages[secondCallMessages.length - 1].content[0].content
    );
    expect(toolResultContent.status).toBe('NOT_SUPPORTED');
  });

  describe('Phase 12A — engage tool input is Zod-validated before any AgentAction is proposed', () => {
    it('a genuinely invalid input (missing listingId) is rejected — no AgentAction created, no pendingConfirmation set', async () => {
      queueResponses(
        toolUseResponse('strict_engage_action', { notListingId: 'oops' }),
        textOnlyResponse('Something went wrong with that request.')
      );

      const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'do the strict thing');

      expect(turn.pendingConfirmation).toBeNull();
      expect(prismaMock.agentAction.create).not.toHaveBeenCalled();
      expect(strictEngageTool.preview).not.toHaveBeenCalled();
    });

    it('an attempt to inject workspaceId/userId into the tool input never overrides the real, server-verified values', async () => {
      queueResponses(
        toolUseResponse('strict_engage_action', { listingId: 'l-1', workspaceId: 'ws-ATTACKER', userId: 'user-ATTACKER' }),
        textOnlyResponse('Proposed.')
      );

      await AiAgentService.sendMessage('ws-1', 'user-1', 'do the strict thing');

      expect(prismaMock.agentAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ workspaceId: 'ws-1', userId: 'user-1' }) })
      );
      // Only the tool's own declared schema fields survive Zod's default
      // strip-unknown-keys behavior — the injected fields are simply gone
      // from what gets persisted as the action's input.
      const [[createCall]] = prismaMock.agentAction.create.mock.calls;
      const persistedInput = JSON.parse(createCall.data.input);
      expect(persistedInput).toEqual({ listingId: 'l-1' });
    });

    it('when preview() reports the target does not exist, no AgentAction is created — the model gets an immediate error instead', async () => {
      strictPreviewResult = { error: 'Listing not found in this workspace.' };
      const snapshots = queueResponses(
        toolUseResponse('strict_engage_action', { listingId: 'does-not-exist' }),
        textOnlyResponse('That listing could not be found.')
      );

      const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'publish listing does-not-exist');

      expect(turn.pendingConfirmation).toBeNull();
      expect(prismaMock.agentAction.create).not.toHaveBeenCalled();

      const secondCallMessages = snapshots[1] as any[];
      const toolResultContent = JSON.parse(secondCallMessages[secondCallMessages.length - 1].content[0].content);
      expect(toolResultContent).toEqual({ error: 'Listing not found in this workspace.' });

      strictPreviewResult = { action: 'strict_engage', ready: true }; // reset for later tests
    });
  });
});
