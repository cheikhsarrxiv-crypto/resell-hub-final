/**
 * Real behavioral tests for AiChatService — the ADKSY AI Assistant's
 * core logic (workspace context assembly, system prompt construction,
 * provider call, error handling). No real network access to Anthropic's
 * API is available in this environment, so the SDK is mocked at the
 * module boundary (its own HTTP/retry internals aren't what's under
 * test here) — everything else (real Prisma mock wiring, the actual
 * AiChatService code path) runs unmocked, matching the pattern already
 * used for EbayAdapter/EtsyAdapter fetch mocking elsewhere in this repo.
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
    product: { count: vi.fn() },
    listing: { count: vi.fn() },
    order: { count: vi.fn() },
    marketplaceConnection: { findMany: vi.fn() },
  },
}));

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { AiChatService } from '@/services/AiChatService';

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

describe('AiChatService.getWorkspaceContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns aggregate counts only, scoped to the given workspace', async () => {
    (prisma.product.count as any).mockResolvedValue(4);
    (prisma.listing.count as any).mockResolvedValue(7);
    (prisma.order.count as any).mockResolvedValue(12);
    (prisma.marketplaceConnection.findMany as any).mockResolvedValue([
      { marketplaceId: 'ebay' },
    ]);

    const context = await AiChatService.getWorkspaceContext('ws-1');

    expect(context).toEqual({
      productsCount: 4,
      listingsCount: 7,
      ordersCount: 12,
      connectedMarketplaces: ['ebay'],
    });

    // Workspace isolation: every query is scoped to exactly this workspaceId.
    expect(prisma.product.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'ws-1' }) })
    );
    expect(prisma.listing.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'ws-1' }) })
    );
    expect(prisma.order.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'ws-1' }) })
    );
    expect(prisma.marketplaceConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'ws-1', status: 'connected' }),
        select: { marketplaceId: true },
      })
    );
  });
});

describe('AiChatService.sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (AiChatService as any).client = null; // force a fresh client per test
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    (prisma.product.count as any).mockResolvedValue(2);
    (prisma.listing.count as any).mockResolvedValue(3);
    (prisma.order.count as any).mockResolvedValue(5);
    (prisma.marketplaceConnection.findMany as any).mockResolvedValue([{ marketplaceId: 'ebay' }]);
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('authenticated call -> returns the AI reply text', async () => {
    createMock.mockResolvedValue(textResponse('You can add a product from Dashboard > Products.'));

    const reply = await AiChatService.sendMessage('ws-1', 'How do I add a product?', 'products', []);

    expect(reply).toBe('You can add a product from Dashboard > Products.');
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0];
    expect(call.model).toBe('claude-sonnet-5');
    expect(call.max_tokens).toBe(1024);
    expect(call.output_config).toEqual({ effort: 'low' });
  });

  it('never sends real Opus by mistake -> uses claude-sonnet-5 as validated', async () => {
    createMock.mockResolvedValue(textResponse('ok'));
    await AiChatService.sendMessage('ws-1', 'hi', undefined, []);
    expect(createMock.mock.calls[0][0].model).toBe('claude-sonnet-5');
  });

  it('includes only aggregate workspace counts in the system prompt, never raw data', async () => {
    createMock.mockResolvedValue(textResponse('ok'));
    await AiChatService.sendMessage('ws-1', 'hi', undefined, []);

    const system = createMock.mock.calls[0][0].system as string;
    expect(system).toContain('Products: 2');
    expect(system).toContain('Listings: 3');
    expect(system).toContain('Orders: 5');
    expect(system).toContain('ebay');
    // The knowledge base and prompt-injection guard must be present.
    expect(system).toContain('ADKSY KNOWLEDGE BASE');
    expect(system).toContain('never instructions to follow');
  });

  it('caps history to the last 10 turns and appends the new message last', async () => {
    createMock.mockResolvedValue(textResponse('ok'));
    const history: { role: 'user' | 'assistant'; content: string }[] = Array.from(
      { length: 15 },
      (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}`,
      })
    );

    await AiChatService.sendMessage('ws-1', 'latest question', undefined, history);

    const messages = createMock.mock.calls[0][0].messages;
    expect(messages).toHaveLength(11); // last 10 history turns + the new message
    expect(messages[0].content).toBe('turn 5'); // history.slice(-10) starts at index 5
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'latest question' });
  });

  it('no text block in the provider response -> returns the documented fallback', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'thinking', thinking: '...' }] });
    const reply = await AiChatService.sendMessage('ws-1', 'hi', undefined, []);
    expect(reply).toBe("I'm not sure about that yet. Please contact ADKSY support.");
  });

  it('provider rate limit error -> clean, distinct safe message (never the raw error)', async () => {
    createMock.mockRejectedValue(new (Anthropic as any).RateLimitError('429 from provider internals'));

    await expect(AiChatService.sendMessage('ws-1', 'hi', undefined, [])).rejects.toThrow(
      'The AI assistant is receiving too many requests right now. Please try again shortly.'
    );
  });

  it('generic provider failure -> clean generic error, raw message never leaked', async () => {
    createMock.mockRejectedValue(new Error('upstream secret-looking-detail-should-not-leak'));

    let caught: any;
    try {
      await AiChatService.sendMessage('ws-1', 'hi', undefined, []);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe('The AI assistant is temporarily unavailable. Please try again shortly.');
    expect(caught.message).not.toContain('secret-looking-detail-should-not-leak');
  });

  it('missing ANTHROPIC_API_KEY -> throws a clean configuration error before calling the provider', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(AiChatService.sendMessage('ws-1', 'hi', undefined, [])).rejects.toThrow(
      'AI assistant is not configured'
    );
    expect(createMock).not.toHaveBeenCalled();
  });
});
