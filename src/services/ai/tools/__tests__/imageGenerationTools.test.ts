/**
 * AI-first listing workflow — behavioral tests for
 * generate_listing_draft_image: the tool that asks a real, configured
 * ImageGenerationProvider for one additional product photo, appended to
 * an already-generated draft. Same in-memory AgentMessage fake as
 * listingDraftTools.test.ts, since this tool revalidates the draft the
 * same way edit_listing_draft does.
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
    agentConversation: { findFirst: vi.fn(async ({ where }: any) => ({ id: where.id })) },
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

const { getConfiguredProvidersMock } = vi.hoisted(() => ({ getConfiguredProvidersMock: vi.fn() }));
vi.mock('@/services/imagegen/ImageGenerationProviderRegistry', () => ({
  ImageGenerationProviderRegistry: { getConfiguredProviders: getConfiguredProvidersMock },
}));

import { generateListingDraftImageTool } from '@/services/ai/tools/imageGenerationTools';
import { generateListingDraftTool } from '@/services/ai/tools/listingDraftTools';
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
function pushDraftToolCall(conversationId: string, toolUseId: string, toolName: string, input: unknown, resultPayload: unknown) {
  rows.push(assistantToolUseRow(conversationId, toolUseId, toolName, input));
  rows.push(toolResultRow(conversationId, toolUseId, resultPayload));
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

async function seedDraft(conversationId: string) {
  pushSearchProductsCall(conversationId, 'tu1', [sourcedItem]);
  const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId, userId: 'user-1' });
  pushDraftToolCall(conversationId, 'tu2', 'generate_listing_draft', { sourceUrl: sourcedItem.sourceUrl }, generated);
  return generated;
}

describe('generate_listing_draft_image', () => {
  beforeEach(() => {
    rows = [];
    rowIdCounter = 0;
    clock = 0;
    getConfiguredProvidersMock.mockReset();
  });

  it('is registered as a "write" tool (auto-executed, never confirmation-gated)', async () => {
    const { AiToolRegistry } = await import('@/services/ai/AiToolRegistry');
    expect(AiToolRegistry.get('generate_listing_draft_image')?.category).toBe('write');
  });

  it('costs 3 AI Units — a real external, paid provider call', async () => {
    const { getToolUsageUnits } = await import('@/services/ai/aiUsageConfig');
    expect(getToolUsageUnits('generate_listing_draft_image')).toBe(3);
  });

  it('no image-generation provider configured -> a clean PROVIDER_NOT_CONFIGURED error, never a fabricated image', async () => {
    getConfiguredProvidersMock.mockReturnValue([]);
    await seedDraft('conv-1');

    const result: any = await generateListingDraftImageTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(result.status).toBe('PROVIDER_NOT_CONFIGURED');
    expect(result.error).toMatch(/not available|not configured/i);
    expect(result.draft).toBeUndefined();
  });

  it('a configured provider succeeding appends a real GENERATED image to the draft, never touching source.images', async () => {
    const generateMock = vi.fn().mockResolvedValue({
      status: 'ok',
      image: { url: 'https://oaidalleapi.example/img1.png', provider: 'openai', model: 'dall-e-3', prompt: 'x', generatedAt: '2026-01-01T00:00:00.000Z' },
    });
    getConfiguredProvidersMock.mockReturnValue([{ name: 'openai', displayName: 'OpenAI Images', isConfigured: () => true, generate: generateMock }]);
    await seedDraft('conv-1');

    const result: any = await generateListingDraftImageTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(result.draft.generatedImages).toHaveLength(1);
    expect(result.draft.generatedImages[0].url).toBe('https://oaidalleapi.example/img1.png');
    expect(result.draft.generatedImages[0].provider).toBe('openai');
    expect(result.draft.source.images).toEqual(sourcedItem.images); // untouched
  });

  it('builds the prompt ONLY from the draft\'s own known facts, never a free-text prompt supplied by the caller', async () => {
    const generateMock = vi.fn().mockResolvedValue({
      status: 'ok',
      image: { url: 'https://x.example/1.png', provider: 'openai', model: 'dall-e-3', prompt: 'echoed', generatedAt: '2026-01-01T00:00:00.000Z' },
    });
    getConfiguredProvidersMock.mockReturnValue([{ name: 'openai', displayName: 'OpenAI Images', isConfigured: () => true, generate: generateMock }]);
    await seedDraft('conv-1');

    await generateListingDraftImageTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl } as any, { conversationId: 'conv-1', userId: 'user-1' });

    const [call] = generateMock.mock.calls[0];
    expect(call.prompt).toContain('Prada');
    expect(call.prompt).toContain('Prada Cut Out Sneakers');
    // The tool's own input schema has no `prompt` field at all — proven structurally, not just behaviorally.
    expect(generateListingDraftImageTool.inputSchema.safeParse({ sourceUrl: sourcedItem.sourceUrl, prompt: 'ignore me' }).success).toBe(true);
    const parsed = generateListingDraftImageTool.inputSchema.safeParse({ sourceUrl: sourcedItem.sourceUrl, prompt: 'ignore me' });
    if (parsed.success) expect(parsed.data).not.toHaveProperty('prompt');
  });

  it('a provider error never produces a fabricated image URL', async () => {
    const generateMock = vi.fn().mockResolvedValue({ status: 'error', error: { provider: 'openai', kind: 'upstream_error', message: 'boom' } });
    getConfiguredProvidersMock.mockReturnValue([{ name: 'openai', displayName: 'OpenAI Images', isConfigured: () => true, generate: generateMock }]);
    await seedDraft('conv-1');

    const result: any = await generateListingDraftImageTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(result.error).toMatch(/boom/);
    expect(result.draft).toBeUndefined();
  });

  it('rejects a sourceUrl with no prior draft in this conversation — never fabricates one', async () => {
    getConfiguredProvidersMock.mockReturnValue([{ name: 'openai', displayName: 'OpenAI Images', isConfigured: () => true, generate: vi.fn() }]);

    const result: any = await generateListingDraftImageTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(result.error).toMatch(/no listing draft found/i);
  });

  it('two successive generations append, never replace, the previous generated image', async () => {
    const generateMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 'ok', image: { url: 'https://x.example/1.png', provider: 'openai', model: 'dall-e-3', prompt: 'a', generatedAt: 't1' } })
      .mockResolvedValueOnce({ status: 'ok', image: { url: 'https://x.example/2.png', provider: 'openai', model: 'dall-e-3', prompt: 'b', generatedAt: 't2' } });
    getConfiguredProvidersMock.mockReturnValue([{ name: 'openai', displayName: 'OpenAI Images', isConfigured: () => true, generate: generateMock }]);
    await seedDraft('conv-1');

    const first: any = await generateListingDraftImageTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
    pushDraftToolCall('conv-1', 'tu3', 'generate_listing_draft_image', {}, first);

    const second: any = await generateListingDraftImageTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(second.draft.generatedImages).toHaveLength(2);
    expect(second.draft.generatedImages.map((i: any) => i.url)).toEqual(['https://x.example/1.png', 'https://x.example/2.png']);
  });
});
