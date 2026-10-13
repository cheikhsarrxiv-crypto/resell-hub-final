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
  // Mirrors the real SDK's own hierarchy (RateLimitError extends
  // APIError) — AiAgentService's diagnostic logging checks
  // `error instanceof Anthropic.APIError` for ANY Anthropic failure, not
  // just RateLimitError, so APIError must be a real class here too.
  class APIError extends Error {
    status?: number;
    type?: string | null;
    requestID?: string | null;
    constructor(status?: number, error?: unknown, message?: string, type?: string | null) {
      super(message);
      this.status = status;
      this.type = type ?? null;
    }
  }
  class RateLimitError extends APIError {
    constructor(message?: string) {
      super(429, undefined, message, 'rate_limit_error');
    }
  }
  // Explicit-timeout fix — mirrors the real SDK's own hierarchy
  // (APIConnectionTimeoutError extends APIConnectionError extends
  // APIError — see node_modules/@anthropic-ai/sdk/core/error.js) closely
  // enough for `error instanceof Anthropic.APIConnectionTimeoutError` to
  // behave identically to the real class in AiAgentService's own catch.
  class APIConnectionError extends APIError {
    constructor(message?: string) {
      super(undefined, undefined, message);
    }
  }
  class APIConnectionTimeoutError extends APIConnectionError {
    constructor(message = 'Request timed out.') {
      super(message);
    }
  }
  class MockAnthropic {
    messages = { create: createMock };
    // Explicit-timeout fix — captured so a test can assert the real
    // constructor actually receives the new timeout/maxRetries options,
    // without needing those values to affect this mock's own behavior
    // (it never makes a real network call either way).
    constructor(public opts: { apiKey: string; timeout?: number; maxRetries?: number }) {}
  }
  (MockAnthropic as any).APIError = APIError;
  (MockAnthropic as any).RateLimitError = RateLimitError;
  (MockAnthropic as any).APIConnectionError = APIConnectionError;
  (MockAnthropic as any).APIConnectionTimeoutError = APIConnectionTimeoutError;
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
    reserveUsage: vi.fn().mockResolvedValue({ status: 'RESERVED', eventId: 'test-usage-event', units: 0 }),
    finalizeUsage: vi.fn().mockResolvedValue({ status: 'RECORDED' }),
    releaseUsage: vi.fn().mockResolvedValue({ status: 'RELEASED' }),
  },
}));

// P7 (missing-tests audit) — generate_listing_draft_image's own real
// provider call (a paid, external one) must never happen once
// AiUsageService.reserveUsage rejects the reservation — the same generic
// gate already proven for get_order below, exercised here for this
// specific tool because it is the one 'write' tool whose handler would
// otherwise make a real, billed external call and fabricate image data if
// the gate were ever bypassed.
const generateImageMock = vi.fn();
vi.mock('@/services/imagegen/ImageGenerationProviderRegistry', () => ({
  ImageGenerationProviderRegistry: {
    getConfiguredProviders: vi.fn(() => [{ name: 'test-provider', generate: generateImageMock }]),
  },
}));

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { AiAgentService } from '@/services/ai/AiAgentService';
import { AiEntitlementService } from '@/services/ai/AiEntitlementService';
import { AiUsageService } from '@/services/ai/AiUsageService';
import { StorageService } from '@/services/StorageService';

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

  // Audit fix (P1) — a configuration-level check on the system prompt
  // itself: running the real model is out of scope here (no eval harness
  // exists yet for this), so this proves the INSTRUCTION is actually
  // sent, not that a real model obeys it.
  it('system prompt instructs the model to never present diagnostics.rejectedSamples as a found/available result (P1 fix)', async () => {
    createMock.mockResolvedValue(textOnlyResponse('hi'));

    await AiAgentService.sendMessage('ws-1', 'user-1', 'hi');

    const systemPrompt = createMock.mock.calls[0][0].system as string;
    expect(systemPrompt).toContain('rejectedSamples');
    // (B) rejectedSamples must never be treated as results.
    expect(systemPrompt).toMatch(/never (use|present|describing)[^.]*rejectedSamples/i);
    // (C) results empty + rejectedSamples non-empty -> explain, never claim a find.
    expect(systemPrompt).toMatch(/results is empty but rejectedSamples contains entries/i);
    // (A) unchanged: results[] remains the one real source of truth.
    expect(systemPrompt).toMatch(/Only an item actually present in (that same call's )?results\[\]/i);
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

  describe('explicit-timeout fix', () => {
    it('the real Anthropic client is constructed with an explicit timeout and maxRetries — never left at the SDK\'s own 10-minute default', async () => {
      createMock.mockResolvedValue(textOnlyResponse('hi'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'hi');

      const client = (AiAgentService as any).client;
      expect(client.opts).toEqual({ apiKey: 'test-key-not-real', timeout: 60_000, maxRetries: 2 });
    });

    it('APIConnectionTimeoutError -> a clean, distinct, controlled error — never an indefinite hang, never the raw SDK message', async () => {
      createMock.mockRejectedValue(new (Anthropic as any).APIConnectionTimeoutError('Request timed out.'));

      let caught: any;
      try {
        await AiAgentService.sendMessage('ws-1', 'user-1', 'hi');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toBe(
        'The AI agent took too long to respond and the request was stopped before any reply was generated. Please try again.'
      );
      // Distinct from the generic/rate-limit messages — never conflated.
      expect(caught.message).not.toBe('The AI agent is temporarily unavailable. Please try again shortly.');
      expect(caught.message).not.toContain('Request timed out.');
    });

    it('a timeout is never retried a second time by the orchestrator itself — createMock called exactly once (the SDK\'s own bounded retries, if any, are entirely internal to the mocked call)', async () => {
      createMock.mockRejectedValue(new (Anthropic as any).APIConnectionTimeoutError());

      await expect(AiAgentService.sendMessage('ws-1', 'user-1', 'hi')).rejects.toThrow();
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it('a plain network error (not a timeout) still falls through to the generic safe message, never the timeout-specific one', async () => {
      createMock.mockRejectedValue(new (Anthropic as any).APIConnectionError('ECONNRESET'));

      await expect(AiAgentService.sendMessage('ws-1', 'user-1', 'hi')).rejects.toThrow(
        'The AI agent is temporarily unavailable. Please try again shortly.'
      );
    });

    it('a timeout on the FIRST call leaves no dangling AI-usage reservation and no corrupted history — only the user\'s own message is persisted, no assistant/assistant_summary row at all', async () => {
      createMock.mockRejectedValue(new (Anthropic as any).APIConnectionTimeoutError());

      await expect(AiAgentService.sendMessage('ws-1', 'user-1', 'hi')).rejects.toThrow();

      // No tool was ever dispatched (the very first model call itself
      // timed out) — the quota-reservation machinery must never have been
      // touched at all.
      expect(AiUsageService.reserveUsage).not.toHaveBeenCalled();
      expect(AiUsageService.finalizeUsage).not.toHaveBeenCalled();
      expect(AiUsageService.releaseUsage).not.toHaveBeenCalled();

      // The user's own message is a true, already-happened fact — it
      // stays persisted. Nothing else (no partial/fabricated assistant
      // reply, no assistant_summary) is ever written for this failed turn.
      const roles = prismaMock.agentMessage.create.mock.calls.map((call) => call[0].data.role);
      expect(roles).toEqual(['user']);
    });

    it('a timeout after a tool was already dispatched in an earlier iteration never leaves that iteration\'s own reservation dangling — it was already finalized before the next model call ran', async () => {
      prismaMock.order.findFirst.mockResolvedValue(fakeOrder);
      createMock
        .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
        .mockRejectedValueOnce(new (Anthropic as any).APIConnectionTimeoutError());

      await expect(AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1')).rejects.toThrow();

      // The first (successful) iteration's own reservation was finalized
      // synchronously, well before the second (timed-out) call started —
      // never left RESERVED-but-unresolved by the later timeout.
      expect(AiUsageService.reserveUsage).toHaveBeenCalledTimes(1);
      expect(AiUsageService.finalizeUsage).toHaveBeenCalledTimes(1);
      expect(AiUsageService.releaseUsage).not.toHaveBeenCalled();
    });
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

describe('AiAgentService — AiUsageService reserve/finalize/release wiring (race-condition fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (AiAgentService as any).client = null;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    prismaMock.agentConversation.create.mockResolvedValue({ id: 'conv-new' });
    prismaMock.agentMessage.findMany.mockResolvedValue([]);
    prismaMock.agentMessage.create.mockResolvedValue({});
    (AiUsageService.reserveUsage as any).mockResolvedValue({ status: 'RESERVED', eventId: 'test-usage-event', units: 0 });
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('the handler runs only after reserveUsage, and a real successful get_order call finalizes usage exactly once, with the real Anthropic toolUseId', async () => {
    prismaMock.order.findFirst.mockResolvedValue(fakeOrder);
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }, 'tu-real-1'))
      .mockResolvedValueOnce(textOnlyResponse('Done.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    expect(turn.toolCalls[0].result).not.toHaveProperty('error');
    expect(AiUsageService.reserveUsage).toHaveBeenCalledTimes(1);
    expect(AiUsageService.reserveUsage).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ toolName: 'get_order', idempotencyKey: expect.stringContaining('tu-real-1'), toolUseId: 'tu-real-1' })
    );
    expect(AiUsageService.finalizeUsage).toHaveBeenCalledTimes(1);
    expect(AiUsageService.finalizeUsage).toHaveBeenCalledWith('ws-1', expect.stringContaining('tu-real-1'));
    expect(AiUsageService.releaseUsage).not.toHaveBeenCalled();
  });

  it('invalid tool input (validation refused before execution) -> the handler never runs, reserveUsage never called', async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', {})) // missing orderId
      .mockResolvedValueOnce(textOnlyResponse('I need an order id.'));

    await AiAgentService.sendMessage('ws-1', 'user-1', 'check my order');

    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
    expect(AiUsageService.reserveUsage).not.toHaveBeenCalled();
  });

  it('reservation REJECTED -> the handler never runs at all, finalize/release never called', async () => {
    (AiUsageService.reserveUsage as any).mockResolvedValueOnce({ status: 'REJECTED', eventId: 'evt-1', units: 1, reason: 'quota_exceeded' });
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
      .mockResolvedValueOnce(textOnlyResponse('Quota exceeded.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    expect((turn.toolCalls[0].result as any).error).toMatch(/quota/i);
    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
    expect(AiUsageService.finalizeUsage).not.toHaveBeenCalled();
    expect(AiUsageService.releaseUsage).not.toHaveBeenCalled();
  });

  describe('quota-message fix — genuine exhaustion vs. infrastructure failure', () => {
    const createProductInput = {
      sourceMarketplace: 'ebay',
      sourceId: 'src-1',
      sourceUrl: 'https://example.com/item-1',
      title: 'Test Item',
      sellingPrice: 10,
      purchasePrice: 5,
    };

    it.each(['period_unavailable', 'no_quota_configured', 'error'] as const)(
      'reserveUsage REJECTED with reason=%s (infrastructure failure, read/write tool) -> an honest "temporarily unavailable" message, never the "quota" wording, and the handler still never runs (fail-closed unchanged)',
      async (reason) => {
        (AiUsageService.reserveUsage as any).mockResolvedValueOnce({ status: 'REJECTED', eventId: null, units: 1, reason });
        createMock
          .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
          .mockResolvedValueOnce(textOnlyResponse('Service unavailable.'));

        const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

        const message = (turn.toolCalls[0].result as any).error;
        expect(message).toMatch(/temporarily unavailable/i);
        expect(message).not.toMatch(/quota/i);
        // Still refused — an infrastructure failure must never implicitly
        // authorize the handler, only the MESSAGE differs from a genuine
        // quota_exceeded refusal.
        expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
        expect(AiUsageService.finalizeUsage).not.toHaveBeenCalled();
        expect(AiUsageService.releaseUsage).not.toHaveBeenCalled();
      }
    );

    it('hasQuotaRemaining allowed:false with reason=quota_exceeded (engage tool proposal pre-check) -> the quota message, exactly like the read/write path', async () => {
      (AiUsageService.hasQuotaRemaining as any).mockResolvedValueOnce({ allowed: false, reason: 'quota_exceeded' });
      createMock
        .mockResolvedValueOnce(toolUseResponse('create_product', createProductInput))
        .mockResolvedValueOnce(textOnlyResponse('Quota exceeded.'));

      const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'list this item');

      expect((turn.toolCalls[0].result as any).error).toMatch(/quota/i);
    });

    it.each(['period_unavailable', 'no_quota_configured'] as const)(
      'hasQuotaRemaining allowed:false with reason=%s (engage tool proposal pre-check, infrastructure failure) -> the honest "temporarily unavailable" message, never "quota", and the action is never proposed',
      async (reason) => {
        (AiUsageService.hasQuotaRemaining as any).mockResolvedValueOnce({ allowed: false, reason });
        createMock
          .mockResolvedValueOnce(toolUseResponse('create_product', createProductInput))
          .mockResolvedValueOnce(textOnlyResponse('Service unavailable.'));

        const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'list this item');

        const message = (turn.toolCalls[0].result as any).error;
        expect(message).toMatch(/temporarily unavailable/i);
        expect(message).not.toMatch(/quota/i);
      }
    );
  });

  it('P7 (missing-tests audit) — AI Units exhausted during generate_listing_draft_image: reservation REJECTED -> the real, paid image provider is NEVER called, no image is fabricated or appended to the draft', async () => {
    prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    const existingDraft = {
      source: {
        sourceItemId: 'https://source.example/item-1',
        sourceMarketplace: 'ebay',
        sourceUrl: 'https://source.example/item-1',
        title: 'Prada Cut Out Sneakers',
        images: ['https://img.example/source-1.jpg'],
        price: 200,
        currency: 'EUR',
        authenticityStatus: 'unverified',
      },
      fields: { title: 'Prada Cut Out Sneakers', description: 'A real description.', currency: 'EUR', quantity: 1 },
      generatedFieldKeys: [],
      editedFieldKeys: [],
      originalValues: {},
    };
    prismaMock.agentMessage.findMany.mockResolvedValue([
      { id: 'm1', conversationId: 'conv-1', role: 'assistant', content: JSON.stringify([{ type: 'tool_use', id: 'tu-draft-1', name: 'generate_listing_draft', input: { sourceUrl: existingDraft.source.sourceUrl } }]), createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'm2', conversationId: 'conv-1', role: 'tool_result', content: JSON.stringify([{ type: 'tool_result', tool_use_id: 'tu-draft-1', content: JSON.stringify({ draft: existingDraft }) }]), createdAt: new Date('2026-01-01T00:00:01Z') },
    ]);
    (AiUsageService.reserveUsage as any).mockResolvedValueOnce({ status: 'REJECTED', eventId: 'evt-img-1', units: 3, reason: 'quota_exceeded' });
    createMock
      .mockResolvedValueOnce(toolUseResponse('generate_listing_draft_image', { sourceUrl: existingDraft.source.sourceUrl }))
      .mockResolvedValueOnce(textOnlyResponse('Quota exceeded.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'generate an extra photo', 'conv-1');

    expect((turn.toolCalls[0].result as any).error).toMatch(/quota/i);
    expect(generateImageMock).not.toHaveBeenCalled(); // no real, billed provider call
    expect(AiUsageService.finalizeUsage).not.toHaveBeenCalled();
    expect(AiUsageService.releaseUsage).not.toHaveBeenCalled();
  });

  it('a thrown handler error -> the reservation is released (never finalized)', async () => {
    prismaMock.order.findFirst.mockRejectedValue(new Error('db exploded'));
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
      .mockResolvedValueOnce(textOnlyResponse('Something went wrong.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    expect(turn.toolCalls[0].result).toEqual({ error: 'Tool execution failed' });
    expect(AiUsageService.reserveUsage).toHaveBeenCalledTimes(1);
    expect(AiUsageService.releaseUsage).toHaveBeenCalledTimes(1);
    expect(AiUsageService.finalizeUsage).not.toHaveBeenCalled();
  });

  it('a controlled business error result (no throw, e.g. order not found) -> the reservation is released, never finalized', async () => {
    prismaMock.order.findFirst.mockResolvedValue(null); // get_order returns {error: '...'} without throwing
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
      .mockResolvedValueOnce(textOnlyResponse('That order was not found.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    expect(turn.toolCalls[0].result).toEqual({ error: 'Order not found in this workspace.' });
    expect(AiUsageService.releaseUsage).toHaveBeenCalledTimes(1);
    expect(AiUsageService.finalizeUsage).not.toHaveBeenCalled();
  });

  it('entitlement refused -> the handler never runs, reserveUsage never called', async () => {
    (AiEntitlementService.canUseCapability as any).mockResolvedValueOnce(false);
    createMock
      .mockResolvedValueOnce(toolUseResponse('get_order', { orderId: 'order-1' }))
      .mockResolvedValueOnce(textOnlyResponse('Not available on your plan.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'check order-1');

    expect((turn.toolCalls[0].result as any).error).toContain('capability');
    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
    expect(AiUsageService.reserveUsage).not.toHaveBeenCalled();
  });

  describe('AI-first "free listing creation" workflow — attachments (real, already-uploaded photos)', () => {
    it('records a real attachment as a synthetic user_photos_uploaded tool_use/tool_result pair, persisted BEFORE the model is ever called', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      createMock.mockResolvedValue(textOnlyResponse('Merci pour la photo !'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Voici une photo.', 'conv-1', [
        { url: 'https://fake.supabase.co/.../photo1.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/photo1.jpg', mimeType: 'image/jpeg' },
      ]);

      const createCalls = prismaMock.agentMessage.create.mock.calls.map((c: any[]) => c[0]);
      const assistantPhotoRow = createCalls.find((c: any) => c.data.role === 'assistant' && c.data.toolName === 'user_photos_uploaded');
      const toolResultPhotoRow = createCalls.find((c: any) => c.data.role === 'tool_result' && c.data.toolName === 'user_photos_uploaded');

      expect(assistantPhotoRow).toBeDefined();
      expect(toolResultPhotoRow).toBeDefined();
      const toolUseBlocks = JSON.parse(assistantPhotoRow.data.content);
      expect(toolUseBlocks[0]).toMatchObject({ type: 'tool_use', name: 'user_photos_uploaded' });
      const toolResultBlocks = JSON.parse(toolResultPhotoRow.data.content);
      const payload = JSON.parse(toolResultBlocks[0].content);
      expect(payload.photos).toEqual([
        expect.objectContaining({ url: 'https://fake.supabase.co/.../photo1.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/photo1.jpg', mimeType: 'image/jpeg' }),
      ]);
      expect(toolUseBlocks[0].id).toBe(toolResultBlocks[0].tool_use_id); // real tool_use_id pairing, same protocol as a real tool call

      // Persisted (and therefore visible to findToolResultsByName later)
      // BEFORE the Anthropic call for this turn.
      const photoRowIndex = createCalls.indexOf(assistantPhotoRow);
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(photoRowIndex).toBeLessThan(createCalls.length - 1); // there is at least the final assistant_summary row persisted after it
    });

    it('the model sees the attachment in its own message history for this turn', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      const snapshots = queueResponses(textOnlyResponse('Merci pour la photo !'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Voici une photo.', 'conv-1', [
        { url: 'https://fake.supabase.co/.../photo1.jpg', storagePath: 'p/photo1.jpg', mimeType: 'image/jpeg' },
      ]);

      const sentMessages = snapshots[0];
      const toolUseMessage = sentMessages.find((m: any) => Array.isArray(m.content) && m.content[0]?.name === 'user_photos_uploaded');
      expect(toolUseMessage).toBeDefined();
    });

    it('no attachments given -> no synthetic tool_use/tool_result rows at all (unchanged regression for a plain text turn)', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      createMock.mockResolvedValue(textOnlyResponse('Bonjour !'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Bonjour', 'conv-1');

      const createCalls = prismaMock.agentMessage.create.mock.calls.map((c: any[]) => c[0]);
      expect(createCalls.some((c: any) => c.data.toolName === 'user_photos_uploaded')).toBe(false);
    });

    it('an empty attachments array behaves exactly like no attachments at all', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      createMock.mockResolvedValue(textOnlyResponse('Bonjour !'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Bonjour', 'conv-1', []);

      const createCalls = prismaMock.agentMessage.create.mock.calls.map((c: any[]) => c[0]);
      expect(createCalls.some((c: any) => c.data.toolName === 'user_photos_uploaded')).toBe(false);
    });
  });

  /**
   * Real photo analysis (AI agent readiness audit, P0 fix): proves the
   * model actually receives a real Anthropic vision `image` content block
   * built from the attachment's real downloaded bytes — not just the
   * JSON-text metadata the previous describe block above already proved.
   * StorageService.downloadConversationImageBytes is spied on (never the
   * whole module mocked, so every OTHER tool's real StorageService import
   * stays untouched) and restored after each test — without a spy, the
   * real function runs and returns null (no Supabase credentials in this
   * test environment), which is exactly the "unavailable" case the last
   * few tests below exercise deliberately.
   */
  describe('Real photo analysis — actual vision content blocks sent to the model', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('a successfully downloaded photo becomes a real {type: "image", source: {type: "base64", ...}} block in the SAME tool_result message, after the text summary', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
      vi.spyOn(StorageService, 'downloadConversationImageBytes').mockResolvedValue({ buffer: pngBytes, mimeType: 'image/png' });
      const snapshots = queueResponses(textOnlyResponse('Je vois la photo.'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Voici une photo.', 'conv-1', [
        { url: 'https://fake.supabase.co/.../photo1.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/photo1.png', mimeType: 'image/png' },
      ]);

      const sentMessages = snapshots[0] as any[];
      const toolResultMessage = sentMessages.find(
        (m: any) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
      );
      expect(toolResultMessage).toBeDefined();
      const content = toolResultMessage.content[0].content as any[];
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]).toMatchObject({ type: 'text' });
      expect(content[1]).toMatchObject({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: pngBytes.toString('base64') },
      });
    });

    it('multiple photos become multiple image blocks, in the SAME order the reseller attached them', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      const bufferA = Buffer.from('photo-a-bytes');
      const bufferB = Buffer.from('photo-b-bytes');
      vi.spyOn(StorageService, 'downloadConversationImageBytes')
        .mockResolvedValueOnce({ buffer: bufferA, mimeType: 'image/jpeg' })
        .mockResolvedValueOnce({ buffer: bufferB, mimeType: 'image/jpeg' });
      const snapshots = queueResponses(textOnlyResponse('Je vois les deux photos.'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Deux photos.', 'conv-1', [
        { url: 'https://fake.supabase.co/.../a.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/a.jpg', mimeType: 'image/jpeg' },
        { url: 'https://fake.supabase.co/.../b.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/b.jpg', mimeType: 'image/jpeg' },
      ]);

      const sentMessages = snapshots[0] as any[];
      const toolResultMessage = sentMessages.find(
        (m: any) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
      );
      const imageBlocks = (toolResultMessage.content[0].content as any[]).filter((b) => b.type === 'image');
      expect(imageBlocks).toHaveLength(2);
      expect(imageBlocks[0].source.data).toBe(bufferA.toString('base64'));
      expect(imageBlocks[1].source.data).toBe(bufferB.toString('base64'));
    });

    it('a photo whose download fails gets NO image block — the model is told it is unavailable, never falsely told it was analyzed', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      vi.spyOn(StorageService, 'downloadConversationImageBytes').mockResolvedValue(null);
      const snapshots = queueResponses(textOnlyResponse("Je n'ai pas pu voir la photo."));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Voici une photo.', 'conv-1', [
        { url: 'https://fake.supabase.co/.../gone.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/gone.jpg', mimeType: 'image/jpeg' },
      ]);

      const sentMessages = snapshots[0] as any[];
      const toolResultMessage = sentMessages.find(
        (m: any) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
      );
      const content = toolResultMessage.content[0].content as any[];
      expect(content.filter((b) => b.type === 'image')).toHaveLength(0);
      const summary = JSON.parse(content[0].text);
      expect(summary.photos[0].status).toBe('unavailable');
    });

    it('with several photos, only the ones that actually downloaded get an image block — a failure for one never blocks the others', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      const bufferB = Buffer.from('photo-b-bytes');
      vi.spyOn(StorageService, 'downloadConversationImageBytes')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ buffer: bufferB, mimeType: 'image/jpeg' });
      const snapshots = queueResponses(textOnlyResponse('Je vois une des deux photos.'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Deux photos.', 'conv-1', [
        { url: 'https://fake.supabase.co/.../a.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/a.jpg', mimeType: 'image/jpeg' },
        { url: 'https://fake.supabase.co/.../b.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/b.jpg', mimeType: 'image/jpeg' },
      ]);

      const sentMessages = snapshots[0] as any[];
      const toolResultMessage = sentMessages.find(
        (m: any) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
      );
      const content = toolResultMessage.content[0].content as any[];
      const imageBlocks = content.filter((b) => b.type === 'image');
      expect(imageBlocks).toHaveLength(1);
      expect(imageBlocks[0].source.data).toBe(bufferB.toString('base64'));
      const summary = JSON.parse(content[0].text);
      expect(summary.photos[0].status).toBe('unavailable');
      expect(summary.photos[1].status).toBe('attached');
    });

    it('the PERSISTED tool_result row never contains the image bytes — only lightweight metadata (never resends the same bytes on a later turn)', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
      vi.spyOn(StorageService, 'downloadConversationImageBytes').mockResolvedValue({ buffer: pngBytes, mimeType: 'image/png' });
      createMock.mockResolvedValue(textOnlyResponse('Je vois la photo.'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Voici une photo.', 'conv-1', [
        { url: 'https://fake.supabase.co/.../photo1.png', storagePath: 'ws-1/_draft-uploads/conv-1/photo1.png', mimeType: 'image/png' },
      ]);

      const createCalls = prismaMock.agentMessage.create.mock.calls.map((c: any[]) => c[0]);
      const toolResultPhotoRow = createCalls.find((c: any) => c.data.role === 'tool_result' && c.data.toolName === 'user_photos_uploaded');
      expect(toolResultPhotoRow).toBeDefined();
      // Never contains the base64 image data or an 'image' content block —
      // only the same {photos, count} metadata shape the earlier, already-
      // passing tests in this file assert on.
      expect(toolResultPhotoRow.data.content).not.toContain(pngBytes.toString('base64'));
      expect(toolResultPhotoRow.data.content).not.toContain('"type":"image"');
      const parsed = JSON.parse(JSON.parse(toolResultPhotoRow.data.content)[0].content);
      expect(parsed.photos[0].status).toBe('attached');
    });

    it('a later turn in the same conversation never resends the earlier photo\'s bytes — loadHistory only ever replays the lightweight persisted metadata', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
      const downloadSpy = vi.spyOn(StorageService, 'downloadConversationImageBytes').mockResolvedValue({ buffer: pngBytes, mimeType: 'image/png' });
      queueResponses(textOnlyResponse('Je vois la photo.'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Voici une photo.', 'conv-1', [
        { url: 'https://fake.supabase.co/.../photo1.png', storagePath: 'ws-1/_draft-uploads/conv-1/photo1.png', mimeType: 'image/png' },
      ]);

      // Simulate the SAME persisted row being replayed as this turn's
      // history on a follow-up message with no new attachments — exactly
      // what loadHistory() does for a real conversation (role 'tool_result'
      // rows are read back from the DB, never re-derived from the earlier
      // in-memory ephemeral message).
      const createCalls = prismaMock.agentMessage.create.mock.calls.map((c: any[]) => c[0]);
      const persistedRows = createCalls.filter((c: any) => c.data.role === 'user' || c.data.role === 'assistant' || c.data.role === 'tool_result');
      // loadHistory's own real query uses orderBy: { createdAt: 'desc' }
      // and reverses the result itself — the mock must supply rows in that
      // same descending (most-recent-first) order, exactly like the
      // existing "continues it, loads prior history" test above already
      // documents, or this replay would come out in the wrong order.
      prismaMock.agentMessage.findMany.mockResolvedValue(
        [...persistedRows].reverse().map((c: any) => ({ role: c.data.role, content: c.data.content, createdAt: new Date() }))
      );
      downloadSpy.mockClear();
      const snapshots = queueResponses(textOnlyResponse('Et pour le prix ?'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'Et pour le prix ?', 'conv-1');

      // downloadConversationImageBytes must never be called again for a
      // turn with no new attachments — nothing left to download.
      expect(downloadSpy).not.toHaveBeenCalled();
      const secondTurnMessages = JSON.stringify(snapshots[0]);
      expect(secondTurnMessages).not.toContain(pngBytes.toString('base64'));
      expect(secondTurnMessages).not.toContain('"type":"image"');
    });
  });

  /**
   * P1-3 fix (final review finding) — a photo can pass every check in
   * downloadConversationImageBytes (size, signature, ownership) and STILL
   * be rejected by the Anthropic API itself once actually sent (e.g. a
   * payload shape it doesn't accept) — a genuine Anthropic.APIError, which
   * aborts the whole turn. These prove the user gets an honest, actionable
   * message (never a fake success, never a claim that a draft/listing was
   * created, no retry anywhere) for exactly that case, and that an
   * unrelated failure (not from the Anthropic API) never gets the
   * misleading photo-specific wording just because attachments happened
   * to be present.
   */
  describe('Provider rejects an image payload — honest error, no false success', () => {
    it('an Anthropic.APIError thrown while this turn had attachments surfaces an honest, actionable "photo could not be analyzed" message — never a generic/unrelated one', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      vi.spyOn(StorageService, 'downloadConversationImageBytes').mockResolvedValue({ buffer: Buffer.from('bytes'), mimeType: 'image/jpeg' });
      const ApiErrorCtor = (Anthropic as any).APIError;
      createMock.mockRejectedValue(new ApiErrorCtor(400, undefined, 'image payload rejected', 'invalid_request_error'));

      await expect(
        AiAgentService.sendMessage('ws-1', 'user-1', 'Voici une photo.', 'conv-1', [
          { url: 'https://fake.supabase.co/.../photo1.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/photo1.jpg', mimeType: 'image/jpeg' },
        ])
      ).rejects.toThrow(/could not analyze the attached photo.*smaller image.*JPEG, PNG, WEBP, or GIF/i);

      vi.restoreAllMocks();
    });

    it('never claims success or implies a draft/listing was created when the provider rejects the image', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      vi.spyOn(StorageService, 'downloadConversationImageBytes').mockResolvedValue({ buffer: Buffer.from('bytes'), mimeType: 'image/jpeg' });
      const ApiErrorCtor = (Anthropic as any).APIError;
      createMock.mockRejectedValue(new ApiErrorCtor(400, undefined, 'image payload rejected', 'invalid_request_error'));

      let caught: Error | undefined;
      try {
        await AiAgentService.sendMessage('ws-1', 'user-1', 'Voici une photo.', 'conv-1', [
          { url: 'https://fake.supabase.co/.../photo1.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/photo1.jpg', mimeType: 'image/jpeg' },
        ]);
      } catch (e) {
        caught = e as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).not.toMatch(/success|created|draft is ready|annonce/i);
      vi.restoreAllMocks();
    });

    it('never retries the request itself — createMock is called exactly once before the error propagates', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      vi.spyOn(StorageService, 'downloadConversationImageBytes').mockResolvedValue({ buffer: Buffer.from('bytes'), mimeType: 'image/jpeg' });
      const ApiErrorCtor = (Anthropic as any).APIError;
      createMock.mockRejectedValue(new ApiErrorCtor(400, undefined, 'image payload rejected', 'invalid_request_error'));

      await expect(
        AiAgentService.sendMessage('ws-1', 'user-1', 'Voici une photo.', 'conv-1', [
          { url: 'https://fake.supabase.co/.../photo1.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/photo1.jpg', mimeType: 'image/jpeg' },
        ])
      ).rejects.toThrow();

      expect(createMock).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    });

    it('a non-Anthropic failure (e.g. conversation ownership) with attachments present still gets the plain generic message, never the photo-specific one', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue(null); // ownership check fails before the model is ever called

      await expect(
        AiAgentService.sendMessage('ws-1', 'user-1', 'Voici une photo.', 'conv-1', [
          { url: 'https://fake.supabase.co/.../photo1.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/photo1.jpg', mimeType: 'image/jpeg' },
        ])
      ).rejects.toThrow('Conversation not found in this workspace');

      expect(createMock).not.toHaveBeenCalled();
    });

    it('an Anthropic.APIError with NO attachments this turn still gets the plain generic message, never the photo-specific one', async () => {
      prismaMock.agentConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      const ApiErrorCtor = (Anthropic as any).APIError;
      createMock.mockRejectedValue(new ApiErrorCtor(500, undefined, 'server error', 'api_error'));

      await expect(AiAgentService.sendMessage('ws-1', 'user-1', 'Bonjour', 'conv-1')).rejects.toThrow(
        'The AI agent is temporarily unavailable. Please try again shortly.'
      );
    });
  });
});
