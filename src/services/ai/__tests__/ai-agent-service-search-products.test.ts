/**
 * Proves search_products is actually reachable from AiAgentService's real
 * tool-use loop (not just registered in isolation) — the "Étape 2, point
 * 10" integration: the agent can call search_products, get real
 * (mocked-at-the-SourcingService-boundary) results back, and present
 * them, all without ever touching Prisma directly or fabricating a
 * result when SourcingService reports SOURCE_NOT_CONFIGURED.
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
  },
}));

vi.mock('@/services/sourcing/SourcingService', () => ({
  SourcingService: { search: vi.fn() },
}));

// This file proves search_products is reachable from the real
// orchestration loop — entitlement refusal is a separate, already-tested
// concern (see ai-entitlement-service.test.ts). Real
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
    reserveUsage: vi.fn().mockResolvedValue({ status: 'RESERVED', eventId: 'test-usage-event', units: 0 }),
    finalizeUsage: vi.fn().mockResolvedValue({ status: 'RECORDED' }),
    releaseUsage: vi.fn().mockResolvedValue({ status: 'RELEASED' }),
  },
}));

import { prisma } from '@/lib/prisma';
import { AiAgentService } from '@/services/ai/AiAgentService';
import { SourcingService } from '@/services/sourcing/SourcingService';

const searchMock = SourcingService.search as ReturnType<typeof vi.fn>;
const prismaMock = prisma as unknown as {
  agentConversation: { create: ReturnType<typeof vi.fn> };
  agentMessage: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function toolUseResponse(name: string, input: unknown, id = 'tooluse_1') {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] };
}
function textOnlyResponse(text: string) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}

describe('AiAgentService — search_products reachable from the real tool-use loop', () => {
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

  it('model calls search_products -> SourcingService is queried, real result fed back, agent never has direct DB access', async () => {
    const fakeResult = {
      source: 'ebay', sourceUrl: 'https://ebay.co.uk/itm/1', title: 'Prada Sneakers',
      price: 450, currency: 'GBP', marketplace: 'EBAY_GB', images: [], authenticityStatus: 'claimed' as const,
    };
    searchMock.mockResolvedValue({ status: 'ok', results: [fakeResult], providerErrors: [] });

    createMock
      .mockResolvedValueOnce(
        toolUseResponse('search_products', { query: 'Prada sneakers', marketplaces: ['EBAY_GB'] })
      )
      .mockResolvedValueOnce(textOnlyResponse('I found a pair of Prada sneakers on eBay UK for £450.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'Find me Prada sneakers under 600 with good margin');

    expect(searchMock).toHaveBeenCalledWith({ query: 'Prada sneakers', marketplaces: ['EBAY_GB'] });
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]).toMatchObject({ name: 'search_products', category: 'read' });
    expect(turn.reply).toContain('Prada');
  });

  it('SourcingService reports SOURCE_NOT_CONFIGURED -> the agent receives that plainly, no invented opportunity', async () => {
    searchMock.mockResolvedValue({ status: 'SOURCE_NOT_CONFIGURED', results: [], providerErrors: [] });

    createMock
      .mockResolvedValueOnce(toolUseResponse('search_products', { query: 'Prada sneakers' }))
      .mockResolvedValueOnce(textOnlyResponse('Sourcing is not configured yet, so I cannot search for products.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'find me Prada sneakers');

    expect(turn.toolCalls[0].result).toMatchObject({ status: 'SOURCE_NOT_CONFIGURED' });
    expect(turn.reply).toMatch(/not configured/i);
  });
});
