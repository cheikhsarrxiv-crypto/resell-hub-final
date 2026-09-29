/**
 * AI-first listing workflow — proves propose_listing_generation is
 * actually reachable from AiAgentService's real tool-use loop (not just
 * registered in isolation), same convention as
 * ai-agent-service-search-products.test.ts. This is the structural
 * backbone of the "the reseller never needs to type 'génère mon
 * annonce'" requirement: the model calls this free, auto-executed tool
 * the moment a selection is recognized, and the UI renders the proposal
 * buttons from its real result — never from parsing the model's prose.
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

interface FakeRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
}

let rows: FakeRow[] = [];
let rowIdCounter = 0;
let clock = 0;

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentConversation: {
      findFirst: vi.fn(async ({ where }: any) => ({ id: where.id })),
      create: vi.fn(async () => ({ id: 'conv-1' })),
    },
    agentMessage: {
      findMany: vi.fn(async ({ where }: any) => {
        const roleFilter: string[] | undefined = where?.role?.in;
        return rows
          .filter((r) => r.conversationId === where.conversationId)
          .filter((r) => !roleFilter || roleFilter.includes(r.role))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
      create: vi.fn(async ({ data }: any) => {
        const row: FakeRow = { id: `row-${++rowIdCounter}`, conversationId: data.conversationId, role: data.role, content: data.content, createdAt: new Date(++clock) };
        rows.push(row);
        return row;
      }),
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
    reserveUsage: vi.fn().mockResolvedValue({ status: 'RESERVED', eventId: 'evt-1', units: 0 }),
    finalizeUsage: vi.fn().mockResolvedValue({ status: 'RECORDED' }),
    releaseUsage: vi.fn().mockResolvedValue({ status: 'RELEASED' }),
  },
}));

import { AiAgentService } from '@/services/ai/AiAgentService';

function toolUseResponse(name: string, input: unknown, id = 'tooluse_1') {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] };
}
function textOnlyResponse(text: string) {
  return { stop_reason: 'end_turn', content: [{ type: 'text', text }] };
}

function pushSearchProductsRows(conversationId: string) {
  const toolUseId = 'tu-search';
  rows.push({
    id: `row-${++rowIdCounter}`,
    conversationId,
    role: 'assistant',
    content: JSON.stringify([{ type: 'tool_use', id: toolUseId, name: 'search_products', input: { query: 'Prada Cut' } }]),
    createdAt: new Date(++clock),
  });
  rows.push({
    id: `row-${++rowIdCounter}`,
    conversationId,
    role: 'tool_result',
    content: JSON.stringify([
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: JSON.stringify({
          status: 'ok',
          results: [
            {
              source: 'web', sourceUrl: 'https://vinted.fr/items/1', title: 'Prada Cut',
              price: 280, currency: 'EUR', marketplace: 'vinted', images: [], authenticityStatus: 'unverified',
            },
          ],
          providerErrors: [],
        }),
      },
    ]),
    createdAt: new Date(++clock),
  });
}

describe('AiAgentService — propose_listing_generation reachable from the real tool-use loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (AiAgentService as any).client = null;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    rows = [];
    rowIdCounter = 0;
    clock = 0;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('the model can call propose_listing_generation for a real, already-searched item, and it auto-executes without any confirmation step', async () => {
    pushSearchProductsRows('conv-1');

    createMock
      .mockResolvedValueOnce(toolUseResponse('propose_listing_generation', { sourceUrl: 'https://vinted.fr/items/1' }))
      .mockResolvedValueOnce(
        textOnlyResponse("J'ai trouvé ce produit. Veux-tu que je crée automatiquement ton annonce ?")
      );

    const turn = await AiAgentService.sendMessage('ws-1', 'user-1', 'J\'ai sélectionné ce produit : "Prada Cut" (https://vinted.fr/items/1).', 'conv-1');

    expect(turn.pendingConfirmation).toBeNull(); // never gated behind a confirmation — read category, zero side effect
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]).toMatchObject({ name: 'propose_listing_generation', category: 'read' });
    expect((turn.toolCalls[0].result as any).selected).toBe(true);
    expect(turn.reply).toContain('Veux-tu que je crée automatiquement ton annonce');
  });

  it('propose_listing_generation is offered to the model as a real available tool', async () => {
    pushSearchProductsRows('conv-1');
    createMock.mockResolvedValueOnce(textOnlyResponse('ok'));

    await AiAgentService.sendMessage('ws-1', 'user-1', 'hello', 'conv-1');

    const [firstCallArgs] = createMock.mock.calls[0];
    const toolNames = firstCallArgs.tools.map((t: any) => t.name);
    expect(toolNames).toContain('propose_listing_generation');
  });
});
