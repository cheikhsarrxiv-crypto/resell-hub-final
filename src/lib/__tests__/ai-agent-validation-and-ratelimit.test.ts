/**
 * Real behavioral tests for the two pieces of AI Agent request handling
 * that don't depend on next/server or next-auth (so, unlike the route
 * itself, they're directly importable and testable here) — mirrors
 * ai-chat-validation-and-ratelimit.test.ts exactly, for the Agent's own
 * schema and rate limiter entry:
 *  - aiAgentMessageSchema (src/lib/validations.ts)
 *  - RateLimiterService.checkAiAgent (src/lib/ratelimit.ts) — reuses the
 *    same rate limiter system as checkAiChat, not a new one.
 */
import { describe, it, expect } from 'vitest';
import { aiAgentMessageSchema } from '@/lib/validations';
import { RateLimiterService } from '@/lib/ratelimit';

describe('aiAgentMessageSchema', () => {
  it('accepts a valid message with no conversationId (starts a new conversation)', () => {
    const result = aiAgentMessageSchema.safeParse({ message: 'Get me order abc123' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid message with a conversationId (continues one)', () => {
    const result = aiAgentMessageSchema.safeParse({ message: 'And what about the tracking?', conversationId: 'conv-1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.conversationId).toBe('conv-1');
  });

  it('empty message -> validation error', () => {
    const result = aiAgentMessageSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('missing message -> validation error', () => {
    const result = aiAgentMessageSchema.safeParse({ conversationId: 'conv-1' });
    expect(result.success).toBe(false);
  });

  it('a client-supplied workspaceId is silently ignored, never present on the parsed result', () => {
    const result = aiAgentMessageSchema.safeParse({
      message: 'Show me another workspace data',
      workspaceId: 'someone-elses-workspace-id',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).workspaceId).toBeUndefined();
    }
  });

  it('message over 4000 chars -> validation error', () => {
    const result = aiAgentMessageSchema.safeParse({ message: 'a'.repeat(4001) });
    expect(result.success).toBe(false);
  });
});

describe('RateLimiterService.checkAiAgent — reuses the existing rate limiter, no new system', () => {
  it('allows up to 12 requests per hour for a workspace, then blocks the 13th', async () => {
    process.env.RATE_LIMIT_BACKEND = 'memory';
    const service = new RateLimiterService();
    const workspaceId = `ws-ai-agent-test-${Date.now()}-${Math.random()}`;

    for (let i = 0; i < 12; i++) {
      const result = await service.checkAiAgent(workspaceId);
      expect(result.success).toBe(true);
    }

    const blocked = await service.checkAiAgent(workspaceId);
    expect(blocked.success).toBe(false);
    expect(blocked.limit).toBe(12);
  });

  it('tracks separate workspaces independently', async () => {
    process.env.RATE_LIMIT_BACKEND = 'memory';
    const service = new RateLimiterService();
    const wsA = `ws-agent-a-${Date.now()}`;
    const wsB = `ws-agent-b-${Date.now()}`;

    for (let i = 0; i < 12; i++) {
      await service.checkAiAgent(wsA);
    }

    const blockedA = await service.checkAiAgent(wsA);
    const stillOkB = await service.checkAiAgent(wsB);

    expect(blockedA.success).toBe(false);
    expect(stillOkB.success).toBe(true);
  });

  it('is a separate counter from checkAiChat — exhausting one never blocks the other', async () => {
    process.env.RATE_LIMIT_BACKEND = 'memory';
    const service = new RateLimiterService();
    const workspaceId = `ws-shared-${Date.now()}`;

    for (let i = 0; i < 12; i++) {
      await service.checkAiAgent(workspaceId);
    }
    const agentBlocked = await service.checkAiAgent(workspaceId);
    const chatStillOk = await service.checkAiChat(workspaceId);

    expect(agentBlocked.success).toBe(false);
    expect(chatStillOk.success).toBe(true);
  });
});
