/**
 * Real behavioral tests for the two pieces of ADKSY AI Assistant request
 * handling that don't depend on next/server or next-auth (so, unlike the
 * route itself, they're directly importable and testable here):
 *  - aiChatMessageSchema (src/lib/validations.ts) — proves a client-
 *    supplied workspaceId is never even parsed into the validated object,
 *    and that an empty message is rejected.
 *  - RateLimiterService.checkAiChat (src/lib/ratelimit.ts) — the same
 *    rate limiter already used by login/signup/uploads/etc., not a new
 *    system, exercised against its real in-memory backend.
 */
import { describe, it, expect } from 'vitest';
import { aiChatMessageSchema } from '@/lib/validations';
import { RateLimiterService } from '@/lib/ratelimit';

describe('aiChatMessageSchema', () => {
  it('accepts a valid message with no page context', () => {
    const result = aiChatMessageSchema.safeParse({ message: 'How do I add a product?' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid currentPage value', () => {
    const result = aiChatMessageSchema.safeParse({ message: 'Help', currentPage: 'products' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currentPage).toBe('products');
  });

  it('rejects an unrecognized currentPage value rather than passing it through', () => {
    const result = aiChatMessageSchema.safeParse({ message: 'Help', currentPage: 'not-a-real-page' });
    expect(result.success).toBe(false);
  });

  it('empty message -> validation error', () => {
    const result = aiChatMessageSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('missing message -> validation error', () => {
    const result = aiChatMessageSchema.safeParse({ currentPage: 'dashboard' });
    expect(result.success).toBe(false);
  });

  it('a client-supplied workspaceId is silently ignored, never present on the parsed result', () => {
    const result = aiChatMessageSchema.safeParse({
      message: 'Show me another workspace data',
      workspaceId: 'someone-elses-workspace-id',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).workspaceId).toBeUndefined();
    }
  });

  it('history is capped at 20 prior turns', () => {
    const tooLong = Array.from({ length: 21 }, (_, i) => ({
      role: 'user' as const,
      content: `turn ${i}`,
    }));
    const result = aiChatMessageSchema.safeParse({ message: 'hi', history: tooLong });
    expect(result.success).toBe(false);
  });

  it('history defaults to an empty array when omitted', () => {
    const result = aiChatMessageSchema.safeParse({ message: 'hi' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.history).toEqual([]);
  });
});

describe('RateLimiterService.checkAiChat — reuses the existing rate limiter, no new system', () => {
  it('allows up to 20 requests per hour for a workspace, then blocks the 21st', async () => {
    process.env.RATE_LIMIT_BACKEND = 'memory';
    const service = new RateLimiterService();
    const workspaceId = `ws-ai-chat-test-${Date.now()}-${Math.random()}`;

    for (let i = 0; i < 20; i++) {
      const result = await service.checkAiChat(workspaceId);
      expect(result.success).toBe(true);
    }

    const blocked = await service.checkAiChat(workspaceId);
    expect(blocked.success).toBe(false);
    expect(blocked.limit).toBe(20);
  });

  it('tracks separate workspaces independently', async () => {
    process.env.RATE_LIMIT_BACKEND = 'memory';
    const service = new RateLimiterService();
    const wsA = `ws-a-${Date.now()}`;
    const wsB = `ws-b-${Date.now()}`;

    for (let i = 0; i < 20; i++) {
      await service.checkAiChat(wsA);
    }

    const blockedA = await service.checkAiChat(wsA);
    const stillOkB = await service.checkAiChat(wsB);

    expect(blockedA.success).toBe(false);
    expect(stillOkB.success).toBe(true);
  });
});
