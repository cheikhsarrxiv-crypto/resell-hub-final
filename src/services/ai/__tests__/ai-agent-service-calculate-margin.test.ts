/**
 * Proves calculate_margin is reachable from AiAgentService's real
 * tool-use loop — the backend (PricingService, real and unmocked here)
 * is the source of truth for the numbers, never the model. Mirrors
 * ai-agent-service-search-products.test.ts's structure.
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

// This file proves calculate_margin is reachable from the real
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

describe('AiAgentService — calculate_margin reachable from the real tool-use loop, real PricingService math', () => {
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

  it('model calls calculate_margin -> real PricingService computes it, agent never invents the number itself', async () => {
    createMock
      .mockResolvedValueOnce(
        toolUseResponse('calculate_margin', { purchasePrice: 450, purchaseCurrency: 'GBP', targetCurrency: 'GBP', resalePrice: 600 })
      )
      .mockResolvedValueOnce(textOnlyResponse('Buying at £450 and reselling at £600 gives a net profit of £150 (25% margin, 33.33% ROI).'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'What margin would I make buying at 450 and reselling at 600?');

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]).toMatchObject({ name: 'calculate_margin', category: 'read' });
    const toolResult: any = turn.toolCalls[0].result;
    expect(toolResult.netProfit).toBe(150);
    expect(toolResult.marginPercent).toBe(25);
    expect(toolResult.roi).toBeCloseTo(33.33, 2);
  });

  it('missing resale price -> the tool result reports it as missing, not a fabricated margin', async () => {
    createMock
      .mockResolvedValueOnce(toolUseResponse('calculate_margin', { purchasePrice: 450, purchaseCurrency: 'GBP', targetCurrency: 'GBP' }))
      .mockResolvedValueOnce(textOnlyResponse('I need a resale price to calculate margin — only the cost side is known so far.'));

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'What margin would I make on a 450 GBP item?');

    const toolResult: any = turn.toolCalls[0].result;
    expect(toolResult.marginPercent).toBeNull();
    expect(toolResult.missingData).toContain('resalePrice');
  });
});
