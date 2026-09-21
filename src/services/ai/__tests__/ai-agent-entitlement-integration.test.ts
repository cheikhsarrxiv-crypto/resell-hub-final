/**
 * Integration tests proving AiEntitlementService is really wired into
 * AiAgentService's real tool-use dispatch loop — not just unit-tested in
 * isolation (see ai-entitlement-service.test.ts for the isolated
 * behavioral tests). Uses the REAL AiToolRegistry, REAL SubscriptionService,
 * and REAL AiEntitlementService — only Anthropic and the DB boundary
 * (prisma.workspace/plan/agentConversation/agentMessage) are mocked, plus
 * each individual tool's own downstream service, to prove a refused
 * capability stops the pipeline BEFORE that downstream service is ever
 * touched (the entitlement check runs before any preview()/handler()).
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

const { workspaceFindUniqueMock, planFindUniqueMock, searchMock, orderFindFirstMock } = vi.hoisted(() => ({
  workspaceFindUniqueMock: vi.fn(),
  planFindUniqueMock: vi.fn(),
  searchMock: vi.fn(),
  orderFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  let actionIdCounter = 0;
  const client = {
    workspace: { findUnique: workspaceFindUniqueMock },
    plan: { findUnique: planFindUniqueMock },
    agentConversation: { findFirst: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'conv-new' }) },
    agentMessage: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    order: { findFirst: orderFindFirstMock },
    // Only reached for an 'engage' tool whose capability check PASSES
    // (simulate_engage_action, which has no capability mapping at all) —
    // a refused engage tool never calls proposeAction, so never touches
    // this table (asserted directly for publish_listing/send_to_fulfillment
    // below).
    agentAction: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: any) => ({
        id: `action-${++actionIdCounter}`,
        confirmedAt: null,
        executedAt: null,
        result: null,
        error: null,
        ...data,
      })),
    },
  };
  return { default: client, prisma: client };
});

// Only reached by an AUTHORIZED search_products call — a refused one must
// never touch this at all (asserted explicitly below).
vi.mock('@/services/sourcing/SourcingService', () => ({
  SourcingService: { search: searchMock },
}));

import { AiAgentService } from '@/services/ai/AiAgentService';

const BUSINESS_PLAN = { id: 'plan-business', name: 'business', aiAssistant: true, fulfillmentEnabled: true };
const FREE_PLAN = { id: 'plan-free', name: 'free', aiAssistant: false, fulfillmentEnabled: false };
// No real seed.js plan has this exact combination — synthetic, used only
// to prove send_to_fulfillment's fulfillment capability is independently
// gated by fulfillmentEnabled, distinct from the broader aiAssistant gate
// every other capability here depends on alone.
const AI_ENABLED_NO_FULFILLMENT_PLAN = { id: 'plan-ai-no-fulfillment', name: 'ai-no-fulfillment', aiAssistant: true, fulfillmentEnabled: false };

function makeWorkspace(plan: typeof BUSINESS_PLAN) {
  return {
    id: 'ws-1',
    subscription: {
      id: 'sub-1',
      planId: plan.id,
      status: 'active',
      stripeSubscriptionId: 'sub_stripe_1',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-02-01'),
      plan,
    },
  };
}

function toolUseResponse(name: string, input: unknown, id = 'tooluse_1') {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] };
}
function textOnlyResponse(text: string) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}

describe('AiAgentService — AiEntitlementService really gates the real dispatch loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (AiAgentService as any).client = null;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    planFindUniqueMock.mockResolvedValue(FREE_PLAN);
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('Free plan (no AI capability at all) — every capability-gated tool is refused before its handler ever runs', () => {
    beforeEach(() => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace(FREE_PLAN));
    });

    it('sourcing: search_products is refused, SourcingService.search is never called', async () => {
      createMock
        .mockResolvedValueOnce(toolUseResponse('search_products', { query: 'Prada sneakers' }))
        .mockResolvedValueOnce(textOnlyResponse('Sourcing is not available on your plan.'));

      const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'find me Prada sneakers');

      const result: any = turn.toolCalls[0].result;
      expect(result.error).toContain('sourcing');
      expect(searchMock).not.toHaveBeenCalled();
    });

    it('listing_generation: generate_listing_draft is refused before it ever needs a real search_products result', async () => {
      createMock
        .mockResolvedValueOnce(toolUseResponse('generate_listing_draft', { sourceUrl: 'https://example.com/item' }))
        .mockResolvedValueOnce(textOnlyResponse('Listing generation is not available on your plan.'));

      const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'draft a listing for that item');

      const result: any = turn.toolCalls[0].result;
      expect(result.error).toContain('listing_generation');
    });

    it('marketplace_publish: publish_listing (an engage tool) is refused BEFORE any AgentAction is proposed — no pendingConfirmation', async () => {
      createMock
        .mockResolvedValueOnce(toolUseResponse('publish_listing', { sourceUrl: 'https://example.com/item', productId: 'product-1' }))
        .mockResolvedValueOnce(textOnlyResponse('Publishing is not available on your plan.'));

      const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'publish that listing');

      expect(turn.pendingConfirmation).toBeNull();
      const result: any = turn.toolCalls[0].result;
      expect(result.error).toContain('marketplace_publish');
    });

    it('fulfillment: send_to_fulfillment is refused, OrderService is never even queried', async () => {
      createMock
        .mockResolvedValueOnce(toolUseResponse('send_to_fulfillment', { orderId: 'order-1' }))
        .mockResolvedValueOnce(textOnlyResponse('Fulfillment is not available on your plan.'));

      const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'send order-1 to fulfillment');

      expect(turn.pendingConfirmation).toBeNull();
      const result: any = turn.toolCalls[0].result;
      expect(result.error).toContain('fulfillment');
      expect(orderFindFirstMock).not.toHaveBeenCalled();
    });
  });

  describe('Business plan (full AI Agent) — an authorized capability really reaches its real handler', () => {
    beforeEach(() => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace(BUSINESS_PLAN));
    });

    it('sourcing: search_products is authorized and really calls SourcingService.search', async () => {
      searchMock.mockResolvedValue({ status: 'SOURCE_NOT_CONFIGURED', results: [], providerErrors: [] });
      createMock
        .mockResolvedValueOnce(toolUseResponse('search_products', { query: 'Prada sneakers' }))
        .mockResolvedValueOnce(textOnlyResponse('No sourcing provider is configured.'));

      const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'find me Prada sneakers');

      expect(searchMock).toHaveBeenCalledTimes(1);
      const result: any = turn.toolCalls[0].result;
      expect(result.status).toBe('SOURCE_NOT_CONFIGURED');
    });
  });

  describe('fulfillment is independently gated by fulfillmentEnabled, not by aiAssistant alone', () => {
    beforeEach(() => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace(AI_ENABLED_NO_FULFILLMENT_PLAN));
    });

    it('aiAssistant true but fulfillmentEnabled false -> send_to_fulfillment still refused, other capabilities remain available', async () => {
      createMock
        .mockResolvedValueOnce(toolUseResponse('send_to_fulfillment', { orderId: 'order-1' }))
        .mockResolvedValueOnce(textOnlyResponse('Fulfillment is not available on your plan.'));

      const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'send order-1 to fulfillment');

      expect(turn.pendingConfirmation).toBeNull();
      const result: any = turn.toolCalls[0].result;
      expect(result.error).toContain('fulfillment');
      expect(orderFindFirstMock).not.toHaveBeenCalled();
    });

    it('sourcing still works on this same workspace (aiAssistant true is enough for a non-fulfillment capability)', async () => {
      searchMock.mockResolvedValue({ status: 'SOURCE_NOT_CONFIGURED', results: [], providerErrors: [] });
      createMock
        .mockResolvedValueOnce(toolUseResponse('search_products', { query: 'Prada sneakers' }))
        .mockResolvedValueOnce(textOnlyResponse('No sourcing provider is configured.'));

      await AiAgentService.sendMessage('ws-1', 'user-1', 'find me Prada sneakers');

      expect(searchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('simulate_engage_action has no capability mapping — never refused by AiEntitlementService, even on the Free plan', () => {
    beforeEach(() => {
      workspaceFindUniqueMock.mockResolvedValue(makeWorkspace(FREE_PLAN));
    });

    it('still proposes normally (the pre-existing global aiAssistant gate is the only thing that would ever block it, at the route level)', async () => {
      createMock
        .mockResolvedValueOnce(toolUseResponse('simulate_engage_action', { note: 'test' }))
        .mockResolvedValueOnce(textOnlyResponse('Proposed.'));

      const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'run the test action');

      expect(turn.pendingConfirmation).not.toBeNull();
      expect(turn.pendingConfirmation?.toolName).toBe('simulate_engage_action');
    });
  });
});
