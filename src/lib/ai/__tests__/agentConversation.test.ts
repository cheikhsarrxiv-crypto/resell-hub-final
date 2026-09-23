import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  agentConversationReducer,
  initialAgentConversationState,
  canSendAgentMessage,
  buildAgentRequestBody,
  mapAgentErrorToMessage,
  mapAgentActionErrorToMessage,
  makeAgentMessageId,
  deserializeHistoryMessage,
  deserializeHistoryResponse,
  fetchConversationHistory,
  confirmAgentAction,
  cancelAgentAction,
  shouldStickToBottom,
  MAX_AGENT_MESSAGE_LENGTH,
  AUTO_SCROLL_THRESHOLD_PX,
  type AgentUiMessage,
  type AgentPendingAction,
} from '@/lib/ai/agentConversation';

describe('agentConversationReducer', () => {
  it('SEND_START appends the user message and sets sending=true, clears any prior error', () => {
    const userMessage: AgentUiMessage = { id: '1', role: 'user', content: 'hi' };
    const state = agentConversationReducer(
      { ...initialAgentConversationState, error: 'previous error' },
      { type: 'SEND_START', message: userMessage }
    );

    expect(state.messages).toEqual([userMessage]);
    expect(state.sending).toBe(true);
    expect(state.error).toBeNull();
  });

  it('SEND_SUCCESS appends the assistant message (with its own toolCalls attached), sets conversationId, clears sending/error', () => {
    const userMessage: AgentUiMessage = { id: '1', role: 'user', content: 'hi' };
    const afterStart = agentConversationReducer(initialAgentConversationState, { type: 'SEND_START', message: userMessage });

    const assistantMessage: AgentUiMessage = {
      id: '2',
      role: 'assistant',
      content: 'hello',
      toolCalls: [{ name: 'search_products', result: {} }],
    };
    const state = agentConversationReducer(afterStart, {
      type: 'SEND_SUCCESS',
      message: assistantMessage,
      conversationId: 'conv-1',
    });

    expect(state.messages).toEqual([userMessage, assistantMessage]);
    expect(state.conversationId).toBe('conv-1');
    expect(state.sending).toBe(false);
    expect(state.error).toBeNull();
    expect(state.messages[1].toolCalls).toEqual([{ name: 'search_products', result: {} }]);
  });

  it('a second message reuses the conversationId set by the first successful response', () => {
    const first = agentConversationReducer(initialAgentConversationState, {
      type: 'SEND_START',
      message: { id: '1', role: 'user', content: 'first' },
    });
    const afterFirstReply = agentConversationReducer(first, {
      type: 'SEND_SUCCESS',
      message: { id: '2', role: 'assistant', content: 'reply 1' },
      conversationId: 'conv-1',
    });

    // This is exactly what useAgentConversation.sendMessage does for the
    // next call: build the request body from the CURRENT state's
    // conversationId.
    const secondRequestBody = buildAgentRequestBody('second message', afterFirstReply.conversationId);
    expect(secondRequestBody).toEqual({ message: 'second message', conversationId: 'conv-1' });

    const afterSecondStart = agentConversationReducer(afterFirstReply, {
      type: 'SEND_START',
      message: { id: '3', role: 'user', content: 'second' },
    });
    expect(afterSecondStart.conversationId).toBe('conv-1'); // unchanged by SEND_START
  });

  it('SEND_ERROR sets the error and clears sending, without touching messages (the user message stays visible)', () => {
    const userMessage: AgentUiMessage = { id: '1', role: 'user', content: 'hi' };
    const afterStart = agentConversationReducer(initialAgentConversationState, { type: 'SEND_START', message: userMessage });

    const state = agentConversationReducer(afterStart, { type: 'SEND_ERROR', error: 'network down' });

    expect(state.messages).toEqual([userMessage]);
    expect(state.sending).toBe(false);
    expect(state.error).toBe('network down');
  });

  it('RESET returns exactly the initial state (resetConversation)', () => {
    const dirty = agentConversationReducer(initialAgentConversationState, {
      type: 'SEND_SUCCESS',
      message: { id: '1', role: 'assistant', content: 'x', toolCalls: [{ some: 'result' }] },
      conversationId: 'conv-1',
    });

    const state = agentConversationReducer(dirty, { type: 'RESET' });

    expect(state).toEqual(initialAgentConversationState);
    expect(state.messages).toEqual([]);
    expect(state.conversationId).toBeNull();
  });
});

describe('canSendAgentMessage', () => {
  it('an empty message cannot be sent', () => {
    expect(canSendAgentMessage('', false)).toBe(false);
  });

  it('a whitespace-only message cannot be sent', () => {
    expect(canSendAgentMessage('   \n  ', false)).toBe(false);
  });

  it('a real message can be sent when not already sending', () => {
    expect(canSendAgentMessage('Find me some sneakers', false)).toBe(true);
  });

  it('nothing can be sent while a previous message is still in flight', () => {
    expect(canSendAgentMessage('Find me some sneakers', true)).toBe(false);
  });

  it('a message exactly at the backend limit (4000) can be sent', () => {
    expect(canSendAgentMessage('a'.repeat(MAX_AGENT_MESSAGE_LENGTH), false)).toBe(true);
  });

  it('a message over the backend limit cannot be sent', () => {
    expect(canSendAgentMessage('a'.repeat(MAX_AGENT_MESSAGE_LENGTH + 1), false)).toBe(false);
  });
});

describe('buildAgentRequestBody — never sends workspaceId/userId/credentials', () => {
  it('first message (no conversationId yet) sends only {message}', () => {
    const body = buildAgentRequestBody('hello', null);
    expect(body).toEqual({ message: 'hello' });
    expect(body).not.toHaveProperty('conversationId');
  });

  it('a follow-up message includes conversationId, and nothing else', () => {
    const body = buildAgentRequestBody('follow up', 'conv-42');
    expect(body).toEqual({ message: 'follow up', conversationId: 'conv-42' });
    expect(Object.keys(body).sort()).toEqual(['conversationId', 'message']);
  });

  it('trims the message before sending', () => {
    const body = buildAgentRequestBody('  hello  ', null);
    expect(body.message).toBe('hello');
  });

  it('never includes workspaceId, userId, subscription, or any credential-shaped field, regardless of input', () => {
    const body = buildAgentRequestBody('hello', 'conv-1') as Record<string, unknown>;
    expect(body).not.toHaveProperty('workspaceId');
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('subscription');
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('token');
  });
});

describe('mapAgentErrorToMessage', () => {
  it('401 -> session expired message', () => {
    expect(mapAgentErrorToMessage(401)).toBe('Votre session a expiré. Veuillez vous reconnecter.');
  });

  it('403 with a Business-plan backend message -> the Business upsell message', () => {
    expect(mapAgentErrorToMessage(403, 'The AI Agent is available on the Business plan. Upgrade to unlock it.')).toBe(
      'Agent IA est disponible avec le forfait Business.'
    );
  });

  it('403 without a Business-plan backend message -> a generic access message, not a fabricated upsell claim', () => {
    expect(mapAgentErrorToMessage(403, 'No workspace found for this account')).toBe(
      "Vous n'avez pas accès à l'Agent IA pour le moment."
    );
  });

  it('403 with no backend message at all -> the generic access message', () => {
    expect(mapAgentErrorToMessage(403)).toBe("Vous n'avez pas accès à l'Agent IA pour le moment.");
  });

  it('429 -> rate limit message', () => {
    expect(mapAgentErrorToMessage(429)).toBe('Trop de demandes. Veuillez réessayer dans quelques instants.');
  });

  it('400 -> invalid input message', () => {
    expect(mapAgentErrorToMessage(400)).toBe("Votre message n'a pas pu être envoyé. Vérifiez son contenu.");
  });

  it('500 -> generic error message', () => {
    expect(mapAgentErrorToMessage(500)).toBe('Une erreur est survenue. Veuillez réessayer.');
  });

  it('null (network-level failure, fetch itself threw) -> connectivity message', () => {
    expect(mapAgentErrorToMessage(null)).toBe('Impossible de contacter ADKSY. Vérifiez votre connexion.');
  });

  it('an unexpected status code -> falls back to the generic error message, never a raw code', () => {
    const message = mapAgentErrorToMessage(418);
    expect(message).toBe('Une erreur est survenue. Veuillez réessayer.');
    expect(message).not.toContain('418');
  });

  it('never echoes the raw backend message text back to the user', () => {
    const message = mapAgentErrorToMessage(500, 'Prisma error: connection to database at ... failed');
    expect(message).not.toContain('Prisma');
    expect(message).not.toContain('database');
  });
});

describe('makeAgentMessageId', () => {
  it('generates a non-empty, unique id each time', () => {
    const a = makeAgentMessageId();
    const b = makeAgentMessageId();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('mapAgentErrorToMessage — 404 (Phase 11D)', () => {
  it('404 -> "conversation not found", regardless of whether it truly does not exist or belongs to another workspace', () => {
    expect(mapAgentErrorToMessage(404)).toBe('Cette conversation est introuvable.');
  });
});

describe('agentConversationReducer — HYDRATE_* (Phase 11D)', () => {
  it('HYDRATE_START sets historyLoading and clears any prior historyError', () => {
    const state = agentConversationReducer(
      { ...initialAgentConversationState, historyError: 'old error' },
      { type: 'HYDRATE_START' }
    );

    expect(state.historyLoading).toBe(true);
    expect(state.historyError).toBeNull();
  });

  it('HYDRATE_SUCCESS restores messages and conversationId exactly as given, in the order provided (never re-sorted)', () => {
    const restored: AgentUiMessage[] = [
      { id: 'm1', role: 'user', content: 'first' },
      { id: 'm2', role: 'assistant', content: 'second', toolCalls: [{ name: 'search_products', result: {} }] },
    ];

    const state = agentConversationReducer(
      { ...initialAgentConversationState, historyLoading: true },
      { type: 'HYDRATE_SUCCESS', conversationId: 'conv-1', messages: restored }
    );

    expect(state.messages).toEqual(restored);
    expect(state.conversationId).toBe('conv-1');
    expect(state.historyLoading).toBe(false);
    expect(state.historyError).toBeNull();
  });

  it('HYDRATE_ERROR sets historyError, never touches messages/sending/error (a separate concern from send failures)', () => {
    const state = agentConversationReducer(
      { ...initialAgentConversationState, historyLoading: true, error: 'unrelated send error' },
      { type: 'HYDRATE_ERROR', error: 'Cette conversation est introuvable.' }
    );

    expect(state.historyLoading).toBe(false);
    expect(state.historyError).toBe('Cette conversation est introuvable.');
    expect(state.error).toBe('unrelated send error'); // untouched
    expect(state.messages).toEqual([]);
  });

  it('RESET also clears historyLoading/historyError', () => {
    const dirty = agentConversationReducer(initialAgentConversationState, {
      type: 'HYDRATE_ERROR',
      error: 'Cette conversation est introuvable.',
    });

    const state = agentConversationReducer(dirty, { type: 'RESET' });

    expect(state.historyLoading).toBe(false);
    expect(state.historyError).toBeNull();
  });
});

describe('deserializeHistoryMessage', () => {
  it('accepts a real, fully-shaped user message', () => {
    expect(deserializeHistoryMessage({ id: 'm1', role: 'user', content: 'hi' })).toEqual({
      id: 'm1',
      role: 'user',
      content: 'hi',
      toolCalls: undefined,
    });
  });

  it('accepts a real assistant message with toolCalls', () => {
    const toolCalls = [{ name: 'calculate_margin', result: {} }];
    expect(deserializeHistoryMessage({ id: 'm2', role: 'assistant', content: 'here', toolCalls })).toEqual({
      id: 'm2',
      role: 'assistant',
      content: 'here',
      toolCalls,
    });
  });

  it('rejects null/undefined/non-objects, never crashes', () => {
    expect(deserializeHistoryMessage(null)).toBeNull();
    expect(deserializeHistoryMessage(undefined)).toBeNull();
    expect(deserializeHistoryMessage('a string')).toBeNull();
    expect(deserializeHistoryMessage(42)).toBeNull();
  });

  it('rejects a message with a missing/fabricated role', () => {
    expect(deserializeHistoryMessage({ id: 'm1', role: 'system', content: 'x' })).toBeNull();
    expect(deserializeHistoryMessage({ id: 'm1', content: 'x' })).toBeNull();
  });

  it('rejects a message with a non-string id or content', () => {
    expect(deserializeHistoryMessage({ id: 42, role: 'user', content: 'x' })).toBeNull();
    expect(deserializeHistoryMessage({ id: 'm1', role: 'user', content: 42 })).toBeNull();
  });

  it('a malformed toolCalls field is dropped WITHOUT dropping the whole message — its text stays visible', () => {
    const result = deserializeHistoryMessage({ id: 'm1', role: 'assistant', content: 'still here', toolCalls: 'not an array' });

    expect(result).toEqual({ id: 'm1', role: 'assistant', content: 'still here', toolCalls: undefined });
  });
});

describe('deserializeHistoryResponse', () => {
  it('an empty/malformed top-level shape returns an empty array, never throws', () => {
    expect(deserializeHistoryResponse(null)).toEqual([]);
    expect(deserializeHistoryResponse({})).toEqual([]);
    expect(deserializeHistoryResponse({ messages: 'not an array' })).toEqual([]);
  });

  it('message A valid, message B with malformed toolCalls, message C valid -> A and C stay fully intact, B keeps its text', () => {
    const response = {
      conversationId: 'conv-1',
      messages: [
        { id: 'A', role: 'user', content: 'valid A' },
        { id: 'B', role: 'assistant', content: 'valid text B', toolCalls: { not: 'an array' } },
        { id: 'C', role: 'user', content: 'valid C' },
      ],
    };

    const messages = deserializeHistoryResponse(response);

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ id: 'A', role: 'user', content: 'valid A', toolCalls: undefined });
    expect(messages[1]).toEqual({ id: 'B', role: 'assistant', content: 'valid text B', toolCalls: undefined });
    expect(messages[2]).toEqual({ id: 'C', role: 'user', content: 'valid C', toolCalls: undefined });
  });

  it('a genuinely malformed individual message (not even a valid role/content) is excluded, without dropping the rest', () => {
    const response = {
      messages: [
        { id: 'A', role: 'user', content: 'valid A' },
        { totally: 'broken' },
        { id: 'C', role: 'user', content: 'valid C' },
      ],
    };

    const messages = deserializeHistoryResponse(response);

    expect(messages.map((m) => m.id)).toEqual(['A', 'C']);
  });

  it('preserves chronological order exactly as given — never re-sorts', () => {
    const response = {
      messages: [
        { id: '3', role: 'user', content: 'third' },
        { id: '1', role: 'user', content: 'first' },
        { id: '2', role: 'user', content: 'second' },
      ],
    };

    expect(deserializeHistoryResponse(response).map((m) => m.id)).toEqual(['3', '1', '2']);
  });
});

describe('fetchConversationHistory (Phase 11D)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a successful response returns the deserialized messages and conversationId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          conversationId: 'conv-1',
          messages: [{ id: 'm1', role: 'user', content: 'hi' }],
        }),
      })
    );

    const outcome = await fetchConversationHistory('conv-1');

    expect(outcome).toEqual({
      status: 'ok',
      conversationId: 'conv-1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', toolCalls: undefined }],
    });
  });

  it('requests the exact conversationId given, URL-encoded, via a plain GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, conversationId: 'x', messages: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await fetchConversationHistory('conv with spaces');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ai/agent?conversationId=conv%20with%20spaces');
  });

  it('never sends a workspaceId in the request — the URL only ever contains conversationId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, conversationId: 'x', messages: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await fetchConversationHistory('conv-1');

    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain('workspaceId');
  });

  it('a 404 response maps to the "conversation not found" message, never the raw backend error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Conversation not found' }) }));

    const outcome = await fetchConversationHistory('conv-missing');

    expect(outcome).toEqual({ status: 'error', error: 'Cette conversation est introuvable.' });
  });

  it('a 401 response maps to the session-expired message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) }));

    const outcome = await fetchConversationHistory('conv-1');

    expect(outcome).toEqual({ status: 'error', error: 'Votre session a expiré. Veuillez vous reconnecter.' });
  });

  it('a 500 response maps to the generic error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Internal error' }) }));

    const outcome = await fetchConversationHistory('conv-1');

    expect(outcome).toEqual({ status: 'error', error: 'Une erreur est survenue. Veuillez réessayer.' });
  });

  it('a network-level failure (fetch itself throws) maps to the connectivity message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const outcome = await fetchConversationHistory('conv-1');

    expect(outcome).toEqual({ status: 'error', error: 'Impossible de contacter ADKSY. Vérifiez votre connexion.' });
  });

  it('a malformed JSON body never crashes the whole call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }));

    await expect(fetchConversationHistory('conv-1')).resolves.not.toThrow();
  });
});

describe('agentConversationReducer — ACTION_UPDATE (Phase 12A)', () => {
  const pendingAction: AgentPendingAction = {
    actionId: 'action-1',
    toolName: 'publish_listing',
    status: 'PENDING_CONFIRMATION',
    expiresAt: '2026-01-01T12:15:00.000Z',
    summary: { title: 'x' },
  };

  it('replaces the pendingAction on exactly the matching message, by id', () => {
    const state: typeof initialAgentConversationState = {
      ...initialAgentConversationState,
      messages: [
        { id: 'm1', role: 'user', content: 'hi' },
        { id: 'm2', role: 'assistant', content: 'ok', pendingAction },
      ],
    };

    const updated = agentConversationReducer(state, {
      type: 'ACTION_UPDATE',
      messageId: 'm2',
      pendingAction: { ...pendingAction, status: 'COMPLETED' },
    });

    expect(updated.messages[0]).toEqual(state.messages[0]); // untouched
    expect(updated.messages[1].pendingAction?.status).toBe('COMPLETED');
  });

  it('a messageId that matches no message is a no-op (never throws, never mutates the wrong message)', () => {
    const state: typeof initialAgentConversationState = {
      ...initialAgentConversationState,
      messages: [{ id: 'm1', role: 'assistant', content: 'ok', pendingAction }],
    };

    const updated = agentConversationReducer(state, {
      type: 'ACTION_UPDATE',
      messageId: 'does-not-exist',
      pendingAction: { ...pendingAction, status: 'CANCELLED' },
    });

    expect(updated.messages).toEqual(state.messages);
  });
});

describe('mapAgentActionErrorToMessage (Phase 12A)', () => {
  it('401 -> session expired message', () => {
    expect(mapAgentActionErrorToMessage(401)).toBe('Votre session a expiré. Veuillez vous reconnecter.');
  });

  it('403 -> access message', () => {
    expect(mapAgentActionErrorToMessage(403)).toBe("Vous n'avez pas accès à cette action.");
  });

  it('404 -> action not found message', () => {
    expect(mapAgentActionErrorToMessage(404)).toBe('Cette action est introuvable.');
  });

  it('409 -> "no longer available" message (already executed/cancelled/expired)', () => {
    expect(mapAgentActionErrorToMessage(409)).toBe("Cette action n'est plus disponible (déjà traitée, annulée ou expirée).");
  });

  it('null (network failure) -> connectivity message', () => {
    expect(mapAgentActionErrorToMessage(null)).toBe('Impossible de contacter ADKSY. Vérifiez votre connexion.');
  });

  it('never echoes the raw backend message text back to the user', () => {
    const message = mapAgentActionErrorToMessage(500, 'Prisma error: connection to database at ... failed');
    expect(message).not.toContain('Prisma');
    expect(message).not.toContain('database');
  });
});

describe('confirmAgentAction / cancelAgentAction (Phase 12A)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('confirmAgentAction POSTs to the exact confirm URL for the given actionId, URL-encoded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        action: { id: 'action-1', type: 'publish_listing', status: 'COMPLETED', expiresAt: '2026-01-01T12:15:00.000Z', summary: {} },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await confirmAgentAction('action with spaces');

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/agent/actions/action%20with%20spaces/confirm', { method: 'POST' });
    expect(outcome).toEqual({
      status: 'ok',
      pendingAction: { actionId: 'action-1', toolName: 'publish_listing', status: 'COMPLETED', expiresAt: '2026-01-01T12:15:00.000Z', summary: {}, result: undefined, error: undefined },
    });
  });

  it('cancelAgentAction POSTs to the exact cancel URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        action: { id: 'action-1', type: 'publish_listing', status: 'CANCELLED', expiresAt: '2026-01-01T12:15:00.000Z', summary: {} },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cancelAgentAction('action-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/agent/actions/action-1/cancel', { method: 'POST' });
  });

  it('a 409 response still surfaces the real current action state from its body (e.g. already COMPLETED), not a generic error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: 'Action already completed',
          action: { id: 'action-1', type: 'publish_listing', status: 'COMPLETED', expiresAt: '2026-01-01T12:15:00.000Z', summary: {}, result: { simulated: true } },
        }),
      })
    );

    const outcome = await confirmAgentAction('action-1');

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.pendingAction.status).toBe('COMPLETED');
    }
  });

  it('a 404 with no action body maps to the generic "not found" error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Action not found' }) }));

    const outcome = await confirmAgentAction('does-not-exist');

    expect(outcome).toEqual({ status: 'error', error: 'Cette action est introuvable.' });
  });

  it('a network-level failure maps to the connectivity message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const outcome = await confirmAgentAction('action-1');

    expect(outcome).toEqual({ status: 'error', error: 'Impossible de contacter ADKSY. Vérifiez votre connexion.' });
  });
});

describe('shouldStickToBottom (Phase 11E — auto-scroll decision)', () => {
  it('scrolled exactly to the bottom -> sticks', () => {
    expect(shouldStickToBottom(500, 600, 100)).toBe(true); // distance = 0
  });

  it('within the threshold of the bottom -> sticks', () => {
    expect(shouldStickToBottom(500 - AUTO_SCROLL_THRESHOLD_PX, 600, 100)).toBe(true);
  });

  it('scrolled up well past the threshold -> does not stick, never yanks the reader back down', () => {
    expect(shouldStickToBottom(0, 1000, 100)).toBe(false); // distance = 900
  });

  it('a short conversation that does not overflow the viewport (no real scroll possible) always sticks', () => {
    expect(shouldStickToBottom(0, 100, 400)).toBe(true); // distance = -300, clamped by <= threshold
  });

  it('a custom threshold is honored', () => {
    expect(shouldStickToBottom(400, 600, 100)).toBe(false); // distance = 100, default threshold 80
    expect(shouldStickToBottom(400, 600, 100, 150)).toBe(true); // same distance, wider threshold
  });
});
