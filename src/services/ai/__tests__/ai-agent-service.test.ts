/**
 * Real behavioral tests for AiAgentService's tool-use orchestration loop,
 * using the REAL AiToolRegistry (and therefore the real get_order tool
 * and real OrderService code path) — only the Anthropic SDK and Prisma
 * are mocked at the module boundary, matching the exact convention
 * already used by ai-chat-service.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    order: { findFirst: vi.fn() },
  },
}));

// This file exercises the tool-use ORCHESTRATION LOOP itself (history,
// iteration cap, tool dispatch, persistence) — entitlement refusal has its
// own dedicated behavioral tests (ai-entitlement-service.test.ts). Real
// AiEntitlementService.canUseCapability would call SubscriptionService,
// which needs a workspace/plan Prisma mock this file deliberately doesn't
// set up above — always-true here keeps this file's own scope narrow.
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

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { AiAgentService } from '@/services/ai/AiAgentService';
import { AiEntitlementService } from '@/services/ai/AiEntitlementService';
import { AiUsageService } from '@/services/ai/AiUsageService';

const prismaMock = prisma as unknown as {
  agentConversation: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  agentMessage: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  order: { findFirst: ReturnType<typeof vi.fn> };
};

function textOnlyResponse(text: string) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}

function toolUseResponse(name: string, input: unknown, id = 'tooluse_1') {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] };
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

const fakeOrder = {
  id: 'order-1',
  status: 'processing',
  fulfillmentType: 'self',
  marketplace: 'ebay',
  externalOrderId: 'EBAY-1',
  customerName: 'Jane Doe',
  totalPrice: 120,
  marketplaceFees: 12,
  estimatedProfit: 40,
  shippingCity: 'Paris',
  shippingCountry: 'FR',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  items: [{ title: 'Sneakers', quantity: 1, price: 120 }],
  fulfillmentOrder: null,
};

describe('AiAgentService.sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (AiAgentService as any).client = null;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    prismaMock.agentConversation.create.mockResolvedValue({ id: 'conv-new' });
    prismaMock.agentMessage.findMany.mockResolvedValue([]);
    prismaMock.agentMessage.create.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('no conversationId given -> starts a new conversation for this workspace/user', async () => {
    createMock.mockResolvedValue(textOnlyResponse('Hello!'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'hi');

    expect(turn.conversationId).toBe('conv-new');
    expect(prismaMock.agentConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { workspaceId: 'ws-1', userId: 'user-1' } })
    );
  });

  it('conversationId given but not owned by this workspace -> throws, never silently creates or reuses another workspace\'s conversation', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue(null);

    await expect(
      AiAgentService.sendMessage('ws-1', 'user-1', 'hi', 'someone-elses-conversation')
    ).rejects.toThrow('Conversation not found in this workspace');

    expect(prismaMock.agentConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'someone-elses-conversation', workspaceId: 'ws-1' } })
    );
    // Never even calls the provider once ownership fails.
    expect(createMock).not.toHaveBeenCalled();
  });

  it('conversationId given and owned by this workspace -> continues it, loads prior history', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    // Prisma's real orderBy: { createdAt: 'desc' } returns most-recent
    // first — the code itself reverses this back to chronological order,
    // so the mock must supply it in the same (descending) order Prisma
    // actually would.
    prismaMock.agentMessage.findMany.mockResolvedValue([
      { role: 'assistant', content: JSON.stringify([{ type: 'text', text: 'earlier answer' }]), createdAt: new Date() },
      { role: 'user', content: 'earlier question', createdAt: new Date() },
    ]);
    const snapshots = queueResponses(textOnlyResponse('follow-up answer'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'follow up', 'conv-1');

    expect(turn.conversationId).toBe('conv-1');
    // History reconstructed in chronological order + the new user message appended last.
    expect(snapshots[0][0]).toEqual({ role: 'user', content: 'earlier question' });
    expect(snapshots[0][1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] });
    expect(snapshots[0][snapshots[0].length - 1]).toEqual({ role: 'user', content: 'follow up' });
  });

  it('model calls get_order -> tool actually runs against the given workspace, result fed back, final reply returned', async () => {
    prismaMock.order.findFirst.mockResolvedValue(fakeOrder);
    const snapshots = queueResponses(
      toolUseResponse('get_order', { orderId: 'order-1' }),
      textOnlyResponse('Your order order-1 is processing.')
    );

    const turn = await AiAgentService.sendMessage('ws-42', 'user-1', 'What is the status of order-1?');

    expect(turn.reply).toBe('Your order order-1 is processing.');
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]).toMatchObject({ name: 'get_order', category: 'read' });
    expect(turn.pendingConfirmation).toBeNull();

    // Workspace isolation: OrderService.getOrder (via the real tool
    // handler) must be called with exactly the workspaceId this turn was
    // given — never anything from the model's tool input.
    expect(prismaMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1', workspaceId: 'ws-42' } })
    );

    // The model was called twice: once producing the tool_use, once with
    // the tool_result fed back.
    expect(createMock).toHaveBeenCalledTimes(2);
    const secondCallMessages = snapshots[1] as any[];
    const toolResultMessage = secondCallMessages[secondCallMessages.length - 1];
    expect(toolResultMessage.role).toBe('user');
    expect(toolResultMessage.content[0].type).toBe('tool_result');
  });

  it('model calls an unknown tool name -> returns an error result to the model instead of crashing', async () => {
    const snapshots = queueResponses(
      toolUseResponse('compare_prices', { brand: 'Prada' }),
      textOnlyResponse("That's not available yet.")
    );

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'find me Prada sneakers');

    expect(turn.reply).toBe("That's not available yet.");
    const secondCallMessages = snapshots[1] as any[];
    const toolResultContent = JSON.parse(
      secondCallMessages[secondCallMessages.length - 1].content[0].content
    );
    expect(toolResultContent.error).toContain('Unknown tool');
  });

  it('model calls get_order with invalid input (missing orderId) -> validation error fed back, tool never runs', async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', {}))
      .mockResolvedValueOnce(textOnlyResponse('I need an order id to look that up.'));

    await AiAgentService.sendMessage('ws-1', 'user-1', 'check my order');

    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
  });

  it('exceeding MAX_TOOL_ITERATIONS -> stops with a clear message instead of looping forever', async () => {
    prismaMock.order.findFirst.mockResolvedValue(fakeOrder);
    // Always ask for another tool call, never finish.
    createMock.mockImplementation(async () => toolUseResponse('get_order', { orderId: 'order-1' }));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'loop forever');

    expect(turn.reply).toMatch(/more steps/i);
    // 6 is MAX_TOOL_ITERATIONS — the loop must not run past it.
    expect(createMock).toHaveBeenCalledTimes(6);
  });

  it('provider rate limit error -> clean, distinct safe message (never the raw error)', async () => {
    createMock.mockRejectedValue(new (Anthropic as any).RateLimitError('429 from provider internals'));

    await expect(AiAgentService.sendMessage('ws-1', 'user-1', 'hi')).rejects.toThrow(
      'The AI agent is receiving too many requests right now. Please try again shortly.'
    );
  });

  it('generic provider failure -> clean generic error, raw message never leaked', async () => {
    createMock.mockRejectedValue(new Error('upstream secret-looking-detail-should-not-leak'));

    let caught: any;
    try {
      await AiAgentService.sendMessage('ws-1', 'user-1', 'hi');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe('The AI agent is temporarily unavailable. Please try again shortly.');
    expect(caught.message).not.toContain('secret-looking-detail-should-not-leak');
  });

  it('missing ANTHROPIC_API_KEY -> throws a clean configuration error before calling the provider', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(AiAgentService.sendMessage('ws-1', 'user-1', 'hi')).rejects.toThrow(
      'AI agent is not configured'
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it('persists the user message, assistant turn(s), tool_result turn(s), and a final assistant_summary row (Phase 11D) to the conversation', async () => {
    prismaMock.order.findFirst.mockResolvedValue(fakeOrder);
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
      .mockResolvedValueOnce(textOnlyResponse('Done.'));

    await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    const roles = prismaMock.agentMessage.create.mock.calls.map((call) => call[0].data.role);
    expect(roles).toEqual(['user', 'assistant', 'tool_result', 'assistant', 'assistant_summary']);
  });

  it('the assistant_summary row (Phase 11D) stores exactly the reply and toolCalls the turn actually returned', async () => {
    prismaMock.order.findFirst.mockResolvedValue(fakeOrder);
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
      .mockResolvedValueOnce(textOnlyResponse('Done.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    const summaryCall = prismaMock.agentMessage.create.mock.calls.find((call) => call[0].data.role === 'assistant_summary');
    expect(summaryCall).toBeDefined();
    const stored = JSON.parse(summaryCall![0].data.content);
    expect(stored.reply).toBe(turn.reply);
    expect(stored.toolCalls).toEqual(turn.toolCalls);
  });
});

describe('AiAgentService.getConversationHistory (Phase 11D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the conversation does not exist at all', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue(null);

    const result = await AiAgentService.getConversationHistory('ws-1', 'conv-does-not-exist');

    expect(result).toBeNull();
  });

  it('cross-tenant: returns null for a conversation that exists but belongs to a different workspace — never leaks it', async () => {
    // The mock itself enforces the {id, workspaceId} filter contract:
    // findFirst is only ever resolved with a row when BOTH match, so
    // simulating "conversation belongs to another workspace" means the
    // real Prisma query (with workspaceId in its WHERE) would return
    // null — exactly what this asserts.
    prismaMock.agentConversation.findFirst.mockResolvedValue(null);

    const result = await AiAgentService.getConversationHistory('ws-attacker', 'conv-belongs-to-ws-victim');

    expect(result).toBeNull();
    expect(prismaMock.agentConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-belongs-to-ws-victim', workspaceId: 'ws-attacker' } })
    );
  });

  it('a conversation owned by this exact workspace is returned', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    prismaMock.agentMessage.findMany.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'hi', createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'm2', role: 'assistant_summary', content: JSON.stringify({ reply: 'hello', toolCalls: [] }), createdAt: new Date('2026-01-01T00:00:01Z') },
    ]);

    const result = await AiAgentService.getConversationHistory('ws-1', 'conv-1');

    expect(result).toEqual({
      conversationId: 'conv-1',
      messages: [
        { id: 'm1', role: 'user', content: 'hi' },
        { id: 'm2', role: 'assistant', content: 'hello', toolCalls: [] },
      ],
    });
  });

  it('reads messages ordered chronologically ascending (oldest first), matching createdAt', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    prismaMock.agentMessage.findMany.mockResolvedValue([]);

    await AiAgentService.getConversationHistory('ws-1', 'conv-1');

    expect(prismaMock.agentMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' } })
    );
  });

  it('only reads role "user"/"assistant_summary" — never the raw internal "assistant"/"tool_result" transcript rows', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    prismaMock.agentMessage.findMany.mockResolvedValue([]);

    await AiAgentService.getConversationHistory('ws-1', 'conv-1');

    expect(prismaMock.agentMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: 'conv-1', role: { in: ['user', 'assistant_summary'] } } })
    );
  });

  it('applies the documented MAX_UI_HISTORY_MESSAGES limit', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    prismaMock.agentMessage.findMany.mockResolvedValue([]);

    await AiAgentService.getConversationHistory('ws-1', 'conv-1');

    expect(prismaMock.agentMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('preserves real toolCalls (e.g. search_products results) exactly, for the UI to render as product cards', async () => {
    const toolCalls = [{ name: 'search_products', category: 'read', input: {}, result: { status: 'ok', results: [{ title: 'Item' }] } }];
    prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    prismaMock.agentMessage.findMany.mockResolvedValue([
      { id: 'm1', role: 'assistant_summary', content: JSON.stringify({ reply: 'Found it.', toolCalls }), createdAt: new Date() },
    ]);

    const result = await AiAgentService.getConversationHistory('ws-1', 'conv-1');

    expect(result?.messages[0].toolCalls).toEqual(toolCalls);
  });

  it('a malformed assistant_summary row falls back to a plain message instead of crashing the whole response', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    prismaMock.agentMessage.findMany.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'valid message A', createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'm2', role: 'assistant_summary', content: 'not valid json{{{', createdAt: new Date('2026-01-01T00:00:01Z') },
      { id: 'm3', role: 'user', content: 'valid message C', createdAt: new Date('2026-01-01T00:00:02Z') },
    ]);

    const result = await AiAgentService.getConversationHistory('ws-1', 'conv-1');

    // A and C remain fully intact; B degrades to a plain message rather
    // than taking down the whole conversation.
    expect(result?.messages).toHaveLength(3);
    expect(result?.messages[0]).toEqual({ id: 'm1', role: 'user', content: 'valid message A' });
    expect(result?.messages[1].role).toBe('assistant');
    expect(result?.messages[1].toolCalls).toBeUndefined();
    expect(result?.messages[2]).toEqual({ id: 'm3', role: 'user', content: 'valid message C' });
  });

  it('never throws for a malformed row — the whole page must stay renderable', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    prismaMock.agentMessage.findMany.mockResolvedValue([
      { id: 'm1', role: 'assistant_summary', content: '{"reply": 123, "toolCalls": "not-an-array"}', createdAt: new Date() },
    ]);

    await expect(AiAgentService.getConversationHistory('ws-1', 'conv-1')).resolves.not.toThrow();
    const result = await AiAgentService.getConversationHistory('ws-1', 'conv-1');
    expect(result?.messages[0].toolCalls).toBeUndefined();
  });

  it('preserves the real DB message ids — never generates a fake random id for a persisted message', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    prismaMock.agentMessage.findMany.mockResolvedValue([
      { id: 'real-cuid-abc123', role: 'user', content: 'hi', createdAt: new Date() },
    ]);

    const result = await AiAgentService.getConversationHistory('ws-1', 'conv-1');

    expect(result?.messages[0].id).toBe('real-cuid-abc123');
  });
});

describe('AiAgentService — AiUsageService.recordUsage is called only after a real, non-error tool success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (AiAgentService as any).client = null;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    prismaMock.agentConversation.create.mockResolvedValue({ id: 'conv-new' });
    prismaMock.agentMessage.findMany.mockResolvedValue([]);
    prismaMock.agentMessage.create.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('a real, successful get_order call records usage exactly once, with the real Anthropic toolUseId', async () => {
    prismaMock.order.findFirst.mockResolvedValue(fakeOrder);
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }, 'tu-real-1'))
      .mockResolvedValueOnce(textOnlyResponse('Done.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    expect(turn.toolCalls[0].result).not.toHaveProperty('error');
    expect(AiUsageService.recordUsage).toHaveBeenCalledTimes(1);
    expect(AiUsageService.recordUsage).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ toolName: 'get_order', idempotencyKey: expect.stringContaining('tu-real-1'), toolUseId: 'tu-real-1' })
    );
  });

  it('invalid tool input (validation refused before execution) -> the handler never runs, recordUsage never called', async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', {})) // missing orderId
      .mockResolvedValueOnce(textOnlyResponse('I need an order id.'));

    await AiAgentService.sendMessage('ws-1', 'user-1', 'check my order');

    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
    expect(AiUsageService.recordUsage).not.toHaveBeenCalled();
  });

  it('a thrown handler error -> recordUsage never called', async () => {
    prismaMock.order.findFirst.mockRejectedValue(new Error('db exploded'));
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
      .mockResolvedValueOnce(textOnlyResponse('Something went wrong.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    expect(turn.toolCalls[0].result).toEqual({ error: 'Tool execution failed' });
    expect(AiUsageService.recordUsage).not.toHaveBeenCalled();
  });

  it('a controlled business error result (no throw, e.g. order not found) -> recordUsage never called', async () => {
    prismaMock.order.findFirst.mockResolvedValue(null); // get_order returns {error: '...'} without throwing
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
      .mockResolvedValueOnce(textOnlyResponse('That order was not found.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    expect(turn.toolCalls[0].result).toEqual({ error: 'Order not found in this workspace.' });
    expect(AiUsageService.recordUsage).not.toHaveBeenCalled();
  });

  it('entitlement refused -> the handler never runs, recordUsage never called', async () => {
    (AiEntitlementService.canUseCapability as any).mockResolvedValueOnce(false);
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
      .mockResolvedValueOnce(textOnlyResponse('Not available on your plan.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    expect((turn.toolCalls[0].result as any).error).toContain('capability');
    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
    expect(AiUsageService.recordUsage).not.toHaveBeenCalled();
  });

  it('quota exceeded -> the handler never runs, recordUsage never called', async () => {
    (AiUsageService.hasQuotaRemaining as any).mockResolvedValueOnce({ allowed: false, reason: 'quota_exceeded' });
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
      .mockResolvedValueOnce(textOnlyResponse('Quota exceeded.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    expect((turn.toolCalls[0].result as any).error).toMatch(/quota/i);
    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
    expect(AiUsageService.recordUsage).not.toHaveBeenCalled();
  });
});
