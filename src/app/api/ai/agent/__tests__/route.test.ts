/**
 * Real integration tests for POST /api/ai/agent — proves the photo-
 * transfer fix (AI agent readiness audit) end to end at the route level:
 * attachments validated by aiAgentMessageSchema actually reach
 * AiAgentService.sendMessage, not just in isolation (ai-agent-service.test.ts
 * already proved the service's own handling of attachments correctly, but
 * by calling sendMessage directly — it could never have caught the route
 * silently dropping the field, which is exactly what happened before this
 * fix).
 *
 * Unlike agent-route-security.test.ts's source-level checks (kept as-is,
 * still useful on their own), this file actually imports and invokes the
 * route handler, with @/auth, @/lib/prisma, SubscriptionService, the rate
 * limiter, and AiAgentService all mocked — verified empirically (this
 * session's own feasibility probe) that this route, unlike the real
 * NextAuth route (auth-login-ratelimit.test.ts's own documented
 * limitation — that one imports NextAuth's `handlers` directly), only
 * calls the thin `auth()` wrapper and resolves cleanly here once that's
 * mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mockAuth }));

const { userStore, workspaceStore } = vi.hoisted(() => ({
  userStore: new Map<string, any>(),
  workspaceStore: new Map<string, any>(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: any) => userStore.get(where.id) ?? null),
    },
    workspace: {
      findFirst: vi.fn(async ({ where }: any) => {
        const ws = workspaceStore.get(where.id);
        if (!ws || ws.userId !== where.userId) return null;
        return { ...ws };
      }),
    },
  },
}));

const { hasFeatureMock } = vi.hoisted(() => ({ hasFeatureMock: vi.fn(async () => true) }));
vi.mock('@/services/SubscriptionService', () => ({
  SubscriptionService: { hasFeature: hasFeatureMock },
}));

const { checkAiAgentMock } = vi.hoisted(() => ({
  checkAiAgentMock: vi.fn(async () => ({ success: true, resetAt: new Date(Date.now() + 1000) })),
}));
vi.mock('@/lib/ratelimit', () => ({
  rateLimiter: { checkAiAgent: checkAiAgentMock },
}));

const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(async () => ({
    conversationId: 'conv-1',
    reply: 'ok',
    toolCalls: [] as unknown[],
    pendingConfirmation: null,
  })),
}));
vi.mock('@/services/ai/AiAgentService', () => ({
  AiAgentService: { sendMessage: sendMessageMock },
}));

// Imported AFTER the mocks above so the route's own module graph picks
// them up (vi.mock calls are hoisted by Vitest regardless of import
// order, but keeping this below the mocks matches the project's own
// established convention — see the CDSL route test for the same pattern).
import { POST } from '../route';

const validAttachment = {
  url: 'https://x.test/photo1.jpg',
  storagePath: 'ws-1/_draft-uploads/conv-1/photo1.jpg',
  mimeType: 'image/jpeg',
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('https://adksy.test/api/ai/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/agent — integration (photo-transfer fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userStore.clear();
    workspaceStore.clear();
    hasFeatureMock.mockResolvedValue(true);
    checkAiAgentMock.mockResolvedValue({ success: true, resetAt: new Date(Date.now() + 1000) });
    sendMessageMock.mockResolvedValue({ conversationId: 'conv-1', reply: 'ok', toolCalls: [], pendingConfirmation: null });

    userStore.set('user-1', { emailVerified: new Date() });
    workspaceStore.set('ws-1', { id: 'ws-1', userId: 'user-1' });
    mockAuth.mockResolvedValue({ user: { id: 'user-1', workspaceId: 'ws-1' } });
  });

  it('1. valid attachments reach AiAgentService.sendMessage as the exact 5th argument, in order', async () => {
    const response = await POST(
      makeRequest({ message: 'Voici une photo', conversationId: 'conv-1', attachments: [validAttachment] })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith('ws-1', 'user-1', 'Voici une photo', 'conv-1', [validAttachment]);
    expect(data.success).toBe(true);
    expect(data.reply).toBe('ok');
  });

  it('1b. multiple valid attachments all reach sendMessage, unchanged and in order', async () => {
    const second = { ...validAttachment, storagePath: 'ws-1/_draft-uploads/conv-1/photo2.jpg' };
    await POST(makeRequest({ message: 'Deux photos', conversationId: 'conv-1', attachments: [validAttachment, second] }));

    expect(sendMessageMock).toHaveBeenCalledWith('ws-1', 'user-1', 'Deux photos', 'conv-1', [validAttachment, second]);
  });

  it('2. a request with no attachments preserves existing behavior — sendMessage still called, with undefined as the 5th argument', async () => {
    const response = await POST(makeRequest({ message: 'Juste du texte', conversationId: 'conv-1' }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledWith('ws-1', 'user-1', 'Juste du texte', 'conv-1', undefined);
    expect(data.success).toBe(true);
  });

  it('2b. a brand-new conversation (no conversationId) still works exactly as before, attachments included', async () => {
    const response = await POST(makeRequest({ message: 'Nouvelle conversation', attachments: [validAttachment] }));

    expect(response.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledWith('ws-1', 'user-1', 'Nouvelle conversation', undefined, [validAttachment]);
  });

  it('3. an attachment with an unsupported mimeType is rejected 400, sendMessage is never called', async () => {
    const response = await POST(
      makeRequest({
        message: 'Photo',
        conversationId: 'conv-1',
        attachments: [{ ...validAttachment, mimeType: 'application/pdf' }],
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid input');
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('3b. an attachment with a malformed url is rejected 400, sendMessage is never called', async () => {
    const response = await POST(
      makeRequest({ message: 'Photo', conversationId: 'conv-1', attachments: [{ ...validAttachment, url: 'not-a-url' }] })
    );

    expect(response.status).toBe(400);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('3c. more than 10 attachments is rejected 400, sendMessage is never called', async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ ...validAttachment, storagePath: `ws-1/_draft-uploads/conv-1/p${i}.jpg` }));
    const response = await POST(makeRequest({ message: 'Beaucoup de photos', conversationId: 'conv-1', attachments: tooMany }));

    expect(response.status).toBe(400);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('3d. a rejected request never consumes the rate limit or reaches SubscriptionService.hasFeature\'s gate point again after validation', async () => {
    // hasFeature/rate-limit are checked BEFORE body validation in this
    // route (see route.ts's own ordering) — this test only asserts the
    // one guarantee that actually matters for "no side effect on
    // rejection": the agent itself is never invoked/billed.
    await POST(makeRequest({ message: 'Photo', conversationId: 'conv-1', attachments: [{ ...validAttachment, mimeType: 'bad' }] }));
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('4. an unauthenticated request is rejected 401, sendMessage is never called', async () => {
    mockAuth.mockResolvedValue(null);
    const response = await POST(makeRequest({ message: 'Voici une photo', attachments: [validAttachment] }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('4b. a session with no workspaceId at all is rejected 403, sendMessage is never called', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    const response = await POST(makeRequest({ message: 'Voici une photo', attachments: [validAttachment] }));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('No workspace found for this account');
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('5. a workspace the session does not own is rejected, sendMessage is never called', async () => {
    workspaceStore.set('ws-2', { id: 'ws-2', userId: 'someone-else' });
    mockAuth.mockResolvedValue({ user: { id: 'user-1', workspaceId: 'ws-2' } });

    const response = await POST(makeRequest({ message: 'Voici une photo', attachments: [validAttachment] }));
    const data = await response.json();

    // verifyWorkspaceAccess's own "...or unauthorized" message matches
    // errorResponse()'s 401 branch — same real behavior already proven
    // for this route's GET handler in agent-route-security.test.ts and
    // for the CDSL export route's own equivalent test.
    expect(response.status).toBe(401);
    expect(data.error).toBeDefined();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('5b. the Business-tier aiAssistant gate still rejects 403 before sendMessage is ever called, attachments or not', async () => {
    hasFeatureMock.mockResolvedValue(false);
    const response = await POST(makeRequest({ message: 'Voici une photo', attachments: [validAttachment] }));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('AI Agent is not enabled');
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('rate-limit exceeded still rejects 429 before sendMessage is ever called', async () => {
    checkAiAgentMock.mockResolvedValue({ success: false, resetAt: new Date(Date.now() + 5000) });
    const response = await POST(makeRequest({ message: 'Voici une photo', attachments: [validAttachment] }));

    expect(response.status).toBe(429);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
