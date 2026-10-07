/**
 * Pure, framework-free logic for the Agent conversation UI (Phase 11A).
 *
 * Deliberately has zero React import: state transitions, error mapping,
 * and request-body construction all live here as plain functions so they
 * can be unit-tested directly with Vitest (environment: 'node', see
 * vitest.config.ts) without needing a DOM/React renderer — this project
 * has no @testing-library/react or jsdom installed, and Phase 11A must
 * not add a new test dependency. src/hooks/useAgentConversation.ts is a
 * thin `useReducer` + `fetch` wrapper around exactly these functions.
 */

export type AgentActionStatus =
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

/**
 * Phase 12A — the UI's view of one AgentAction: a real, persisted,
 * backend-computed proposal the reseller can confirm or cancel. `summary`
 * is exactly what AiActionService stored (see that service's own preview
 * step) — never re-derived or embellished on the frontend.
 */
export interface AgentPendingAction {
  actionId: string;
  toolName: string;
  summary: Record<string, unknown>;
  expiresAt: string;
  status: AgentActionStatus;
  result?: unknown;
  error?: string;
}

export interface AgentUiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /**
   * Phase 11B: the raw `toolCalls` from the backend response that
   * produced THIS assistant message — never set on a 'user' message.
   * Kept as `unknown[]` here (same as the backend's own
   * AgentToolCallRecord.result: unknown) because this module has no
   * runtime dependency on backend code; src/lib/ai/sourcingResults.ts
   * validates/narrows it defensively before anything renders from it.
   */
  toolCalls?: unknown[];
  /**
   * Phase 12A: set only when this exact assistant turn asked for an
   * 'engage' tool — the confirm/cancel UI (AgentConfirmation) reads and
   * updates this via ACTION_UPDATE as the reseller acts on it.
   */
  pendingAction?: AgentPendingAction;
}

export interface AgentConversationState {
  messages: AgentUiMessage[];
  conversationId: string | null;
  sending: boolean;
  error: string | null;
  /** Phase 11D — restoring a persisted conversation from ?conversationId=... is a separate concern from sending a new message, so it gets its own loading/error state rather than reusing sending/error (a failed history load must never be confused with a failed send). */
  historyLoading: boolean;
  historyError: string | null;
}

export const MAX_AGENT_MESSAGE_LENGTH = 4000;
/** Mirrors AiAgentService's own MAX_UI_HISTORY_MESSAGES — documented here only for reference; the actual cap is enforced server-side. */
export const MAX_UI_HISTORY_MESSAGES = 50;

export const initialAgentConversationState: AgentConversationState = {
  messages: [],
  conversationId: null,
  sending: false,
  error: null,
  historyLoading: false,
  historyError: null,
};

export type AgentConversationAction =
  | { type: 'SEND_START'; message: AgentUiMessage }
  | { type: 'SEND_SUCCESS'; message: AgentUiMessage; conversationId: string }
  | { type: 'SEND_ERROR'; error: string }
  | { type: 'HYDRATE_START' }
  | { type: 'HYDRATE_SUCCESS'; conversationId: string; messages: AgentUiMessage[] }
  | { type: 'HYDRATE_ERROR'; error: string }
  | { type: 'RESET' }
  /**
   * Phase 12A — replaces the pendingAction on exactly one message (by id)
   * after a confirm/cancel request resolves. Never touches any other
   * message, and never re-derives which message to update from anything
   * but the id the caller already knows (the hook always calls this with
   * the same messageId the pendingAction came from).
   */
  | { type: 'ACTION_UPDATE'; messageId: string; pendingAction: AgentPendingAction };

export function agentConversationReducer(
  state: AgentConversationState,
  action: AgentConversationAction
): AgentConversationState {
  switch (action.type) {
    case 'SEND_START':
      return { ...state, messages: [...state.messages, action.message], sending: true, error: null };
    case 'SEND_SUCCESS':
      return {
        ...state,
        messages: [...state.messages, action.message],
        sending: false,
        error: null,
        conversationId: action.conversationId,
      };
    case 'SEND_ERROR':
      // The user's own message (already appended by SEND_START) is never
      // rolled back on failure — they can see exactly what they tried to
      // send, next to the error banner explaining it didn't go through.
      return { ...state, sending: false, error: action.error };
    case 'HYDRATE_START':
      return { ...state, historyLoading: true, historyError: null };
    case 'HYDRATE_SUCCESS':
      // Replaces messages/conversationId wholesale — this only ever runs
      // once, right after mount, before the user could have sent
      // anything of their own into this fresh state (see
      // useAgentConversation's staleness guard).
      return { ...state, messages: action.messages, conversationId: action.conversationId, historyLoading: false, historyError: null };
    case 'HYDRATE_ERROR':
      return { ...state, historyLoading: false, historyError: action.error };
    case 'RESET':
      return initialAgentConversationState;
    case 'ACTION_UPDATE':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId ? { ...m, pendingAction: action.pendingAction } : m
        ),
      };
    default:
      return state;
  }
}

/** Non-empty (after trim), within the backend's own limit, and not already sending. */
/**
 * AI-first "free listing creation" workflow — one real photo already
 * uploaded via POST /api/ai/agent/photos (see that route), ready to be
 * attached to the NEXT chat turn. Never raw bytes here — only the
 * already-durable {url, storagePath, mimeType} that route returned.
 */
export interface AgentPhotoAttachment {
  url: string;
  storagePath: string;
  mimeType: string;
}

/**
 * Image-search feature (Phase 1) — first-message UX fix: the attach
 * control in AgentComposer is never gated on a conversationId already
 * existing (POST /api/ai/agent/photos now creates that row itself when
 * none is given — see that route's own comment). This is the exact
 * decision AgentComposer makes, both when deciding which conversationId
 * to send on the NEXT photo upload in the same not-yet-sent turn (so a
 * second photo pick reuses the conversation the first one just created,
 * never creating a second one) and when deciding which conversationId to
 * pass as sendMessage's override for the eventual send. `conversationId`
 * is the real prop (the hook's own state, authoritative once set);
 * `locallyResolvedConversationId` is the id this one composer instance
 * already received back from an earlier upload in the same turn, if any.
 * The real prop always wins once it exists.
 */
export function resolveKnownConversationId(
  conversationId: string | null,
  locallyResolvedConversationId: string | null
): string | null {
  return conversationId ?? locallyResolvedConversationId;
}

/**
 * AI-first "free listing creation" workflow — `hasAttachments` lets the
 * composer send with an EMPTY text field when at least one real photo is
 * already attached (e.g. the reseller just sends a photo with no caption)
 * — the message text itself is still required by the backend
 * (aiAgentMessageSchema.message), so the composer is expected to fill in a
 * plain default caption in that case (see AgentComposer's own handleSend),
 * never leave it genuinely empty.
 */
export function canSendAgentMessage(message: string, sending: boolean, hasAttachments: boolean = false): boolean {
  const trimmed = message.trim();
  if (sending) return false;
  if (hasAttachments) return trimmed.length <= MAX_AGENT_MESSAGE_LENGTH;
  return trimmed.length > 0 && trimmed.length <= MAX_AGENT_MESSAGE_LENGTH;
}

/**
 * The exact body sent to POST /api/ai/agent. Its return type has no
 * workspaceId/userId/subscription/credentials field at all — the server
 * derives the workspace from the authenticated session
 * (verifyWorkspaceAccess), never from the request body — so there is no
 * field here to accidentally populate with one. `attachments`, when
 * given, is always already-uploaded, real photo references (see
 * AgentPhotoAttachment) — never raw file bytes over this JSON body.
 */
export function buildAgentRequestBody(
  message: string,
  conversationId: string | null,
  attachments?: AgentPhotoAttachment[]
): { message: string; conversationId?: string; attachments?: AgentPhotoAttachment[] } {
  const trimmed = message.trim();
  const body: { message: string; conversationId?: string; attachments?: AgentPhotoAttachment[] } = conversationId
    ? { message: trimmed, conversationId }
    : { message: trimmed };
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  return body;
}

/**
 * Maps an HTTP status (or `null` for a network-level failure — fetch()
 * itself threw, never reached the server) to a plain-language message.
 * Never echoes the raw backend error text or a stack trace.
 */
export function mapAgentErrorToMessage(status: number | null, backendMessage?: string): string {
  if (status === null) {
    return 'Impossible de contacter ADKSY. Vérifiez votre connexion.';
  }
  if (status === 401) {
    return 'Votre session a expiré. Veuillez vous reconnecter.';
  }
  if (status === 403) {
    // The AI Agent is available on every plan today — a 403 here means
    // something other than "wrong plan" (e.g. the on/off kill switch is
    // off, or workspace access failed) — never a Business-specific
    // upsell claim, which would now be misleading.
    return "Vous n'avez pas accès à l'Agent IA pour le moment.";
  }
  if (status === 429) {
    return 'Trop de demandes. Veuillez réessayer dans quelques instants.';
  }
  if (status === 400) {
    return "Votre message n'a pas pu être envoyé. Vérifiez son contenu.";
  }
  if (status === 404) {
    // Phase 11D — GET /api/ai/agent?conversationId=... returns this both
    // when the id genuinely doesn't exist and when it belongs to another
    // workspace (see AiAgentService.getConversationHistory's own
    // comment) — the UI message stays equally generic for both, on
    // purpose.
    return 'Cette conversation est introuvable.';
  }
  // Includes 500 and any other/unexpected status — a generic, honest
  // message rather than guessing at a more specific cause.
  return 'Une erreur est survenue. Veuillez réessayer.';
}

/**
 * Phase 12A — maps a confirm/cancel response status to a plain-language
 * message. 409 covers every "nothing changed" outcome the backend
 * reports (already executing, already cancelled, expired) — the caller
 * (useAgentConversation) still applies whatever real status AiActionService
 * returned in the body, this is only the fallback banner text.
 */
export function mapAgentActionErrorToMessage(status: number | null, backendMessage?: string): string {
  if (status === null) {
    return 'Impossible de contacter ADKSY. Vérifiez votre connexion.';
  }
  if (status === 401) {
    return 'Votre session a expiré. Veuillez vous reconnecter.';
  }
  if (status === 403) {
    return "Vous n'avez pas accès à cette action.";
  }
  if (status === 404) {
    return 'Cette action est introuvable.';
  }
  if (status === 409) {
    return "Cette action n'est plus disponible (déjà traitée, annulée ou expirée).";
  }
  void backendMessage; // never echoed — same rule as mapAgentErrorToMessage
  return 'Une erreur est survenue. Veuillez réessayer.';
}

function deserializePendingAction(raw: unknown): AgentPendingAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.type !== 'string' || typeof r.status !== 'string' || typeof r.expiresAt !== 'string') {
    return null;
  }
  const summary = r.summary && typeof r.summary === 'object' ? (r.summary as Record<string, unknown>) : {};
  return {
    actionId: r.id,
    toolName: r.type,
    summary,
    expiresAt: r.expiresAt,
    status: r.status as AgentActionStatus,
    result: r.result,
    error: typeof r.error === 'string' ? r.error : undefined,
  };
}

export type ActionRequestOutcome =
  | { status: 'ok'; pendingAction: AgentPendingAction }
  | { status: 'error'; error: string };

async function postActionRequest(url: string): Promise<ActionRequestOutcome> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST' });
  } catch {
    return { status: 'error', error: mapAgentActionErrorToMessage(null) };
  }

  const data: any = await response.json().catch(() => null);

  // 409 still carries a real, current action state in its body (e.g.
  // "already COMPLETED") — surface that instead of a generic error
  // whenever the backend actually returned one, since it's the truth,
  // not a fabricated guess.
  const pendingAction = data?.action ? deserializePendingAction(data.action) : null;
  if (!response.ok && !pendingAction) {
    return { status: 'error', error: mapAgentActionErrorToMessage(response.status, data?.error) };
  }
  if (!pendingAction) {
    return { status: 'error', error: mapAgentActionErrorToMessage(response.status, data?.error) };
  }

  return { status: 'ok', pendingAction };
}

/** Pure wrapper around POST /api/ai/agent/actions/:id/confirm — see fetchConversationHistory's own comment for why this pattern (a plain async function, no hook) is used. */
export async function confirmAgentAction(actionId: string): Promise<ActionRequestOutcome> {
  return postActionRequest(`/api/ai/agent/actions/${encodeURIComponent(actionId)}/confirm`);
}

/** Pure wrapper around POST /api/ai/agent/actions/:id/cancel. */
export async function cancelAgentAction(actionId: string): Promise<ActionRequestOutcome> {
  return postActionRequest(`/api/ai/agent/actions/${encodeURIComponent(actionId)}/cancel`);
}

export function makeAgentMessageId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Phase 11D — validates one persisted message from GET's response
 * defensively (it's our own DB, but AiAgentService.getConversationHistory
 * already types its result as `unknown` from the frontend's point of
 * view, exactly like every backend tool result this UI already treats
 * this way). A message missing/mistyped id/role/content is dropped
 * entirely (never included as a broken bubble); a mistyped `toolCalls` is
 * dropped from that one message WITHOUT dropping the message itself —
 * its text stays visible, it just won't show product/margin cards (see
 * the Phase 11D brief's own "A and C must stay displayable" example).
 */
export function deserializeHistoryMessage(raw: unknown): AgentUiMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== 'string' || typeof r.content !== 'string' || (r.role !== 'user' && r.role !== 'assistant')) {
    return null;
  }

  const toolCalls = Array.isArray(r.toolCalls) ? r.toolCalls : undefined;
  return { id: r.id, role: r.role, content: r.content, toolCalls };
}

/**
 * Validates the overall shape of GET's response body. Never sorts/
 * reorders — messages are trusted to already be chronological (the
 * backend's own createdAt-ascending order), matching the brief's "ne
 * trie pas côté frontend d'une manière différente."
 */
export function deserializeHistoryResponse(raw: unknown): AgentUiMessage[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.messages)) return [];

  return r.messages.map(deserializeHistoryMessage).filter((m): m is AgentUiMessage => m !== null);
}

/**
 * Phase 11E — how close to the bottom (in px) counts as "still following
 * the conversation" for auto-scroll purposes.
 */
export const AUTO_SCROLL_THRESHOLD_PX = 80;

/**
 * Pure near-bottom-vs-scrolled-up decision for the message list's
 * auto-scroll behavior: a user who has scrolled up to re-read earlier
 * history must never be yanked back down by a new message or the loading
 * indicator appearing/disappearing, while someone already at (or within
 * `threshold` of) the bottom should stay pinned there. Kept framework-free
 * so the decision itself is unit-testable without a DOM — AgentMessageList
 * is the only caller, supplying real scrollTop/scrollHeight/clientHeight
 * measurements from the browser.
 */
export function shouldStickToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number = AUTO_SCROLL_THRESHOLD_PX
): boolean {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= threshold;
}

export type FetchHistoryOutcome =
  | { status: 'ok'; conversationId: string; messages: AgentUiMessage[] }
  | { status: 'error'; error: string };

/**
 * The entire GET request/response/error-mapping pipeline as one pure,
 * framework-free async function — no React, no hook, so it's directly
 * unit-testable (mocking global.fetch) exactly like buildAgentRequestBody/
 * mapAgentErrorToMessage already are. useAgentConversation's useEffect is
 * a thin wrapper that calls this and dispatches the result, plus a
 * staleness guard (a request unrelated to React state, so it lives in
 * the hook, not here).
 */
export async function fetchConversationHistory(conversationId: string): Promise<FetchHistoryOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/ai/agent?conversationId=${encodeURIComponent(conversationId)}`);
  } catch {
    return { status: 'error', error: mapAgentErrorToMessage(null) };
  }

  const data: any = await response.json().catch(() => null);

  if (!response.ok || !data?.success) {
    return { status: 'error', error: mapAgentErrorToMessage(response.status, data?.error) };
  }

  return {
    status: 'ok',
    conversationId: data.conversationId,
    messages: deserializeHistoryResponse(data),
  };
}
