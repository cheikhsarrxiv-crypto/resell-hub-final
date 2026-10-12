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

/**
 * Bug fix (AI agent readiness audit, photo-transfer fix): this schema
 * previously had no `attachments` field at all, so Zod silently stripped
 * it from result.data before /api/ai/agent/route.ts ever saw it — a real
 * photo the reseller uploaded via POST /api/ai/agent/photos (and that
 * buildAgentRequestBody genuinely includes in the next message's JSON
 * body) never reached AiAgentService.sendMessage. These tests cover the
 * new field directly, matching the exact shape
 * POST /api/ai/agent/photos returns ({url, storagePath, mimeType}).
 */
describe('aiAgentMessageSchema — attachments (AI-first "free listing creation" photo transfer)', () => {
  const validAttachment = {
    url: 'https://example.supabase.co/storage/v1/object/public/conversation-images/ws-1/_draft-uploads/conv-1/photo1.jpg',
    storagePath: 'ws-1/_draft-uploads/conv-1/photo1.jpg',
    mimeType: 'image/jpeg',
  };

  it('accepts a message with one valid attachment, and attachments round-trips unchanged', () => {
    const result = aiAgentMessageSchema.safeParse({ message: 'Voici une photo.', attachments: [validAttachment] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments).toEqual([validAttachment]);
    }
  });

  it('accepts a message with several valid attachments', () => {
    const result = aiAgentMessageSchema.safeParse({
      message: 'Voici deux photos.',
      attachments: [validAttachment, { ...validAttachment, storagePath: 'ws-1/_draft-uploads/conv-1/photo2.jpg' }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.attachments).toHaveLength(2);
  });

  it('accepts a message with attachments entirely omitted (unchanged regression for a plain text turn)', () => {
    const result = aiAgentMessageSchema.safeParse({ message: 'Juste du texte.' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.attachments).toBeUndefined();
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])(
    'accepts every mimeType StorageService.ALLOWED_MIME_TYPES actually allows (%s)',
    (mimeType) => {
      const result = aiAgentMessageSchema.safeParse({ message: 'Photo.', attachments: [{ ...validAttachment, mimeType }] });
      expect(result.success).toBe(true);
    }
  );

  it('rejects an attachment with an unsupported mimeType', () => {
    const result = aiAgentMessageSchema.safeParse({
      message: 'Photo.',
      attachments: [{ ...validAttachment, mimeType: 'application/pdf' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an attachment with a malformed url', () => {
    const result = aiAgentMessageSchema.safeParse({
      message: 'Photo.',
      attachments: [{ ...validAttachment, url: 'not-a-real-url' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an attachment with a missing/empty storagePath', () => {
    const result = aiAgentMessageSchema.safeParse({
      message: 'Photo.',
      attachments: [{ ...validAttachment, storagePath: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an attachment missing a required field entirely', () => {
    const { url, ...withoutUrl } = validAttachment;
    const result = aiAgentMessageSchema.safeParse({ message: 'Photo.', attachments: [withoutUrl] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 attachments on one message', () => {
    const result = aiAgentMessageSchema.safeParse({
      message: 'Beaucoup de photos.',
      attachments: Array.from({ length: 11 }, (_, i) => ({ ...validAttachment, storagePath: `ws-1/_draft-uploads/conv-1/photo${i}.jpg` })),
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 10 attachments (the documented limit)', () => {
    const result = aiAgentMessageSchema.safeParse({
      message: 'Dix photos.',
      attachments: Array.from({ length: 10 }, (_, i) => ({ ...validAttachment, storagePath: `ws-1/_draft-uploads/conv-1/photo${i}.jpg` })),
    });
    expect(result.success).toBe(true);
  });

  it('an unexpected extra field inside an attachment is silently stripped, never causes a validation error', () => {
    const result = aiAgentMessageSchema.safeParse({
      message: 'Photo.',
      attachments: [{ ...validAttachment, uploaderIsAdmin: true }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.attachments?.[0] as Record<string, unknown>).uploaderIsAdmin).toBeUndefined();
    }
  });

  it('rejects attachments that is not an array at all', () => {
    const result = aiAgentMessageSchema.safeParse({ message: 'Photo.', attachments: 'not-an-array' });
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
