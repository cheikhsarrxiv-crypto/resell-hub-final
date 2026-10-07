/**
 * AI Agent Personalization V1 — AiAgentService.buildSystemPrompt's own
 * <user_profile> injection. Same mocking convention as
 * ai-agent-service.test.ts (real AiToolRegistry/search_products, only
 * Anthropic + Prisma mocked at the module boundary).
 *
 * Core guarantees under test:
 * - no profile -> prompt unchanged (no <user_profile> block at all);
 * - a profile lookup failure degrades the same way, never throws;
 * - a profile present -> block appears, phrased as context/preference;
 * - the profile is NEVER merged into a tool call's own input — it only
 *   ever reaches the model as prompt text, never programmatically
 *   injected into search_products (SourcingService/the tool itself are
 *   untouched by this feature).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number;
    type?: string | null;
    constructor(status?: number, _error?: unknown, message?: string, type?: string | null) {
      super(message);
      this.status = status;
      this.type = type ?? null;
    }
  }
  class RateLimitError extends APIError {}
  class MockAnthropic {
    messages = { create: createMock };
    constructor(_opts: { apiKey: string }) {}
  }
  (MockAnthropic as any).APIError = APIError;
  (MockAnthropic as any).RateLimitError = RateLimitError;
  return { default: MockAnthropic };
});

const { agentProfileStore, loggerErrorMock, loggerWarnMock } = vi.hoisted(() => ({
  agentProfileStore: new Map<string, any>(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

// Pre-commit review: a real Prisma/DB failure on the profile lookup must
// be traced at 'error' severity (never 'warn'), even though the turn
// itself still degrades gracefully — see buildSystemPrompt's own comment.
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: loggerWarnMock, error: loggerErrorMock, debug: vi.fn() }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentConversation: { findFirst: vi.fn(), create: vi.fn() },
    agentMessage: { findMany: vi.fn(), create: vi.fn() },
    order: { findFirst: vi.fn() },
    agentProfile: {
      findUnique: vi.fn(async ({ where }: any) => agentProfileStore.get(where.workspaceId) ?? null),
    },
  },
}));

vi.mock('@/services/ai/AiEntitlementService', async () => {
  const actual = await vi.importActual<typeof import('@/services/ai/AiEntitlementService')>('@/services/ai/AiEntitlementService');
  return { ...actual, AiEntitlementService: { canUseCapability: vi.fn().mockResolvedValue(true) } };
});

vi.mock('@/services/ai/AiUsageService', () => ({
  AiUsageService: {
    hasQuotaRemaining: vi.fn().mockResolvedValue({ allowed: true }),
    reserveUsage: vi.fn().mockResolvedValue({ status: 'RESERVED', eventId: 'test-usage-event', units: 0 }),
    finalizeUsage: vi.fn().mockResolvedValue({ status: 'RECORDED' }),
    releaseUsage: vi.fn().mockResolvedValue({ status: 'RELEASED' }),
  },
}));

// The real search_products tool calls the real SourcingService — mocked
// here only to make its handler return deterministically and fast; what
// matters for this file is the INPUT it receives, never its output.
const { sourcingSearchMock } = vi.hoisted(() => ({
  sourcingSearchMock: vi.fn().mockResolvedValue({ status: 'ok', results: [], providersSearched: [] }),
}));
vi.mock('@/services/sourcing/SourcingService', () => ({
  SourcingService: { search: sourcingSearchMock },
}));

import { prisma } from '@/lib/prisma';
import { AiAgentService } from '@/services/ai/AiAgentService';

const prismaMock = prisma as unknown as {
  agentConversation: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  agentMessage: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function textOnlyResponse(text: string) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}

function toolUseResponse(name: string, input: unknown, id = 'tooluse_1') {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] };
}

function queueResponses(...responses: unknown[]) {
  const queue = [...responses];
  createMock.mockImplementation(async () => queue.shift());
}

beforeEach(() => {
  vi.clearAllMocks();
  agentProfileStore.clear();
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  prismaMock.agentConversation.findFirst.mockResolvedValue(null);
  prismaMock.agentConversation.create.mockResolvedValue({ id: 'conv-1' });
  prismaMock.agentMessage.findMany.mockResolvedValue([]);
  prismaMock.agentMessage.create.mockResolvedValue({});
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('AiAgentService — no AgentProfile', () => {
  it('the system prompt never contains a <user_profile> block', async () => {
    queueResponses(textOnlyResponse('ok'));
    await AiAgentService.sendMessage('ws-1', 'user-1', 'Bonjour');
    const system = createMock.mock.calls[0][0].system as string;
    expect(system).not.toContain('<user_profile>');
  });

  it('a profile-lookup failure degrades the same way — never throws, never blocks the turn', async () => {
    (prisma.agentProfile.findUnique as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB hiccup'));
    queueResponses(textOnlyResponse('ok'));
    const result = await AiAgentService.sendMessage('ws-1', 'user-1', 'Bonjour');
    expect(result.reply).toBe('ok');
    const system = createMock.mock.calls[0][0].system as string;
    expect(system).not.toContain('<user_profile>');
  });

  it('a profile-lookup failure is traced at ERROR severity, with the real error and workspaceId — never silently indistinguishable from "no profile yet"', async () => {
    (prisma.agentProfile.findUnique as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB hiccup'));
    queueResponses(textOnlyResponse('ok'));
    await AiAgentService.sendMessage('ws-1', 'user-1', 'Bonjour');

    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    const [, errorArg, contextArg] = loggerErrorMock.mock.calls[0];
    expect(errorArg).toBeInstanceOf(Error);
    expect((errorArg as Error).message).toBe('DB hiccup');
    expect(contextArg).toMatchObject({ workspaceId: 'ws-1' });
    // Never downgraded to a mere warning — this is a real failure, not
    // the expected "profile genuinely absent" case.
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });
});

describe('AiAgentService — AgentProfile present', () => {
  it('injects a <user_profile> block phrased as context/preference, never an instruction', async () => {
    agentProfileStore.set('ws-1', {
      usageType: 'resell',
      budgetRange: '50_100',
      customBudgetEur: null,
      sellingPlatforms: ['vinted'],
      preferredCategories: ['sneakers'],
      monthlyGoal: '3000',
      priority: 'margin',
      qualityVsPrice: null,
    });
    queueResponses(textOnlyResponse('ok'));
    await AiAgentService.sendMessage('ws-1', 'user-1', 'Trouve-moi des Nike Dunk');

    const system = createMock.mock.calls[0][0].system as string;
    expect(system).toContain('<user_profile>');
    expect(system).toContain('achat-revente');
    expect(system).toContain('50–100 €');
    expect(system.toLowerCase()).toContain('la demande actuelle');
  });

  it('a different workspace with no profile of its own never sees another workspace\'s block', async () => {
    agentProfileStore.set('ws-other', { usageType: 'resell', budgetRange: '50_100', customBudgetEur: null, sellingPlatforms: [], preferredCategories: [], monthlyGoal: null, priority: null, qualityVsPrice: null });
    queueResponses(textOnlyResponse('ok'));
    await AiAgentService.sendMessage('ws-1', 'user-1', 'Bonjour');
    const system = createMock.mock.calls[0][0].system as string;
    expect(system).not.toContain('<user_profile>');
  });

  it('search_products receives EXACTLY the model-provided input — the profile is never merged into a tool call', async () => {
    agentProfileStore.set('ws-1', {
      usageType: 'resell',
      budgetRange: '50_100',
      customBudgetEur: null,
      sellingPlatforms: ['vinted'],
      preferredCategories: ['sneakers'],
      monthlyGoal: null,
      priority: null,
      qualityVsPrice: null,
    });
    const explicitToolInput = { query: 'Nike Dunk', maxPrice: 30, currency: 'EUR' };
    queueResponses(toolUseResponse('search_products', explicitToolInput), textOnlyResponse('ok'));

    await AiAgentService.sendMessage('ws-1', 'user-1', 'Trouve-moi des Nike Dunk sous 30 euros');

    expect(sourcingSearchMock).toHaveBeenCalledTimes(1);
    // Exactly what the model sent — never maxPrice:50 or any field derived
    // from the profile's budgetRange ('50_100'), never a platform filter
    // silently added from sellingPlatforms.
    expect(sourcingSearchMock).toHaveBeenCalledWith(explicitToolInput);
  });

  it('a profile with only usageType set (every optional field skipped) still injects a minimal, valid block', async () => {
    agentProfileStore.set('ws-1', {
      usageType: 'personal',
      budgetRange: null,
      customBudgetEur: null,
      sellingPlatforms: [],
      preferredCategories: [],
      monthlyGoal: null,
      priority: null,
      qualityVsPrice: null,
    });
    queueResponses(textOnlyResponse('ok'));
    await AiAgentService.sendMessage('ws-1', 'user-1', 'Bonjour');
    const system = createMock.mock.calls[0][0].system as string;
    expect(system).toContain('<user_profile>');
    expect(system).toContain('achats personnels');
  });
});
