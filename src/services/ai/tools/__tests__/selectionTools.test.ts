/**
 * AI-first listing workflow — behavioral tests for
 * propose_listing_generation: the structured, zero-side-effect signal
 * that backs the proactive "veux-tu que je crée ton annonce ?" proposal.
 * Same in-memory AgentMessage fake as listingDraftTools.test.ts, since
 * this tool revalidates a sourceUrl against this exact conversation's own
 * search_products results the same way.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    },
    agentMessage: {
      findMany: vi.fn(async ({ where }: any) => {
        const roleFilter: string[] | undefined = where?.role?.in;
        return rows
          .filter((r) => r.conversationId === where.conversationId)
          .filter((r) => !roleFilter || roleFilter.includes(r.role))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
    },
  },
}));

import { proposeListingGenerationTool } from '@/services/ai/tools/selectionTools';
import type { NormalizedSourcingResult } from '@/services/sourcing/types';

function assistantToolUseRow(conversationId: string, toolUseId: string, toolName: string, input: unknown): FakeRow {
  return {
    id: `row-${++rowIdCounter}`,
    conversationId,
    role: 'assistant',
    content: JSON.stringify([{ type: 'tool_use', id: toolUseId, name: toolName, input }]),
    createdAt: new Date(++clock),
  };
}

function toolResultRow(conversationId: string, toolUseId: string, resultPayload: unknown): FakeRow {
  return {
    id: `row-${++rowIdCounter}`,
    conversationId,
    role: 'tool_result',
    content: JSON.stringify([{ type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(resultPayload) }]),
    createdAt: new Date(++clock),
  };
}

function pushSearchProductsCall(conversationId: string, toolUseId: string, results: NormalizedSourcingResult[]) {
  rows.push(assistantToolUseRow(conversationId, toolUseId, 'search_products', { query: 'prada' }));
  rows.push(toolResultRow(conversationId, toolUseId, { status: 'ok', results, providerErrors: [] }));
}

const sourcedItem: NormalizedSourcingResult = {
  source: 'ebay',
  sourceId: 'v1|111|0',
  sourceUrl: 'https://www.ebay.co.uk/itm/111',
  title: 'Prada Cut Out Sneakers',
  brand: 'Prada',
  price: 380,
  currency: 'GBP',
  marketplace: 'EBAY_GB',
  images: ['https://img.ebay.com/main.jpg'],
  condition: 'USED_EXCELLENT',
  authenticityStatus: 'claimed',
};

describe('propose_listing_generation', () => {
  beforeEach(() => {
    rows = [];
    rowIdCounter = 0;
    clock = 0;
  });

  it('is registered as a "read" tool (auto-executed, zero side effect)', async () => {
    const { AiToolRegistry } = await import('@/services/ai/AiToolRegistry');
    expect(AiToolRegistry.get('propose_listing_generation')?.category).toBe('read');
  });

  it('costs 0 AI Units — a pure revalidation, never metered', async () => {
    const { getToolUsageUnits } = await import('@/services/ai/aiUsageConfig');
    expect(getToolUsageUnits('propose_listing_generation')).toBeNull();
  });

  it('confirms a real selection and returns the item\'s own real fields', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    const result: any = await proposeListingGenerationTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.selected).toBe(true);
    expect(result.title).toBe(sourcedItem.title);
    expect(result.price).toBe(380);
    expect(result.currency).toBe('GBP');
  });

  it('a sourceUrl never returned by search_products in this conversation is refused, never fabricated', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    const result: any = await proposeListingGenerationTool.handler(
      'ws-1',
      { sourceUrl: 'https://www.ebay.co.uk/itm/999-never-searched' },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.selected).toBe(false);
    expect(result.error).toMatch(/not found among this conversation/i);
  });

  it('a sourceUrl that only appeared in a DIFFERENT conversation is refused (workspace/conversation isolation)', async () => {
    pushSearchProductsCall('conv-OTHER', 'tu1', [sourcedItem]);

    const result: any = await proposeListingGenerationTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.selected).toBe(false);
  });

  it('never calls or implies generate_listing_draft/create_product itself — the result carries no draft/product data at all', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    const result: any = await proposeListingGenerationTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result).not.toHaveProperty('draft');
    expect(result).not.toHaveProperty('productId');
  });

  it('missing conversation context is refused cleanly', async () => {
    const result: any = await proposeListingGenerationTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl });
    expect(result.error).toBeDefined();
  });

  it('rejects a non-URL sourceUrl before the handler ever runs', () => {
    const parsed = proposeListingGenerationTool.inputSchema.safeParse({ sourceUrl: 'not-a-url' });
    expect(parsed.success).toBe(false);
  });
});
