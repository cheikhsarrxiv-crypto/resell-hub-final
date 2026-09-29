'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  agentConversationReducer,
  initialAgentConversationState,
  canSendAgentMessage,
  buildAgentRequestBody,
  mapAgentErrorToMessage,
  makeAgentMessageId,
  fetchConversationHistory,
  confirmAgentAction,
  cancelAgentAction,
  type AgentUiMessage,
  type AgentPendingAction,
} from '@/lib/ai/agentConversation';

/**
 * Drives POST /api/ai/agent for the Agent page, and (Phase 11D) restores
 * a persisted conversation via GET when `initialConversationId` is given
 * (read from the URL by the page — this hook never touches routing
 * itself). Each assistant message carries the `toolCalls` from the
 * response that produced it (Phase 11B: AgentMessageList extracts
 * search_products results from these to render product cards — see
 * src/lib/ai/sourcingResults.ts), whether that response came from a live
 * POST or a restored GET — SourcingResultsGrid/MarginSummaryList don't
 * know or care which.
 *
 * Never sends workspaceId/userId/subscription/credentials — the request
 * body comes only from buildAgentRequestBody(), whose return type has no
 * such field; the server derives the workspace from the authenticated
 * session (see /api/ai/agent/route.ts's own verifyWorkspaceAccess call).
 */
export function useAgentConversation(initialConversationId?: string) {
  const [state, dispatch] = useReducer(agentConversationReducer, initialAgentConversationState);

  // Phase 11D §21 (concurrency): guards against a late-resolving history
  // fetch overwriting state a newer effect run (or a message the user
  // already sent) has since replaced. Not React state on purpose — it
  // must be readable synchronously inside the async callback below,
  // never triggering its own re-render.
  const hydrationRequestIdRef = useRef(0);
  // Frozen at mount, deliberately never updated afterward: this hook
  // restores a conversation ONCE, from whatever id the page had in its
  // URL at first render. If the page's OWN conversationId later changes
  // the URL (e.g. right after creating a brand new conversation — see
  // AgentPage's own sync effect), that must never re-trigger a hydration
  // fetch for a conversation this exact session just created itself
  // (§27: no redundant GET after a POST already returned everything).
  const conversationIdToHydrateRef = useRef(initialConversationId);

  useEffect(() => {
    const idToHydrate = conversationIdToHydrateRef.current;
    if (!idToHydrate) return;

    const requestId = ++hydrationRequestIdRef.current;
    dispatch({ type: 'HYDRATE_START' });

    fetchConversationHistory(idToHydrate).then((outcome) => {
      if (hydrationRequestIdRef.current !== requestId) return; // superseded — discard silently, never overwrite newer state

      if (outcome.status === 'ok') {
        dispatch({ type: 'HYDRATE_SUCCESS', conversationId: outcome.conversationId, messages: outcome.messages });
      } else {
        dispatch({ type: 'HYDRATE_ERROR', error: outcome.error });
      }
    });
    // Runs exactly once, at mount — see conversationIdToHydrateRef's own
    // comment for why this must never react to a later-changing prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      if (!canSendAgentMessage(rawMessage, state.sending)) return;

      const userMessage: AgentUiMessage = { id: makeAgentMessageId(), role: 'user', content: rawMessage.trim() };
      dispatch({ type: 'SEND_START', message: userMessage });

      let response: Response;
      try {
        response = await fetch('/api/ai/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildAgentRequestBody(rawMessage, state.conversationId)),
        });
      } catch {
        // fetch() itself threw — a network-level failure, never reached
        // the server. status: null is exactly what mapAgentErrorToMessage
        // maps to the "check your connection" message.
        dispatch({ type: 'SEND_ERROR', error: mapAgentErrorToMessage(null) });
        return;
      }

      const data: any = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        dispatch({ type: 'SEND_ERROR', error: mapAgentErrorToMessage(response.status, data?.error) });
        return;
      }

      // Phase 12A: the model asked for an 'engage' tool this turn — a
      // real, persisted, confirmable AgentAction already exists
      // server-side (see AiAgentService.sendMessage's own comment).
      // Attached to THIS assistant message only, never any other.
      const pendingAction: AgentPendingAction | undefined =
        data.pendingConfirmation && typeof data.pendingConfirmation.actionId === 'string'
          ? {
              actionId: data.pendingConfirmation.actionId,
              toolName: data.pendingConfirmation.toolName,
              summary:
                data.pendingConfirmation.summary && typeof data.pendingConfirmation.summary === 'object'
                  ? data.pendingConfirmation.summary
                  : {},
              expiresAt: data.pendingConfirmation.expiresAt,
              status: 'PENDING_CONFIRMATION',
            }
          : undefined;

      const assistantMessage: AgentUiMessage = {
        id: makeAgentMessageId(),
        role: 'assistant',
        content:
          typeof data.reply === 'string' && data.reply.length > 0
            ? data.reply
            : "Désolé, je n'ai pas pu générer de réponse.",
        toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : undefined,
        pendingAction,
      };

      dispatch({
        type: 'SEND_SUCCESS',
        message: assistantMessage,
        conversationId: data.conversationId,
      });
    },
    [state.sending, state.conversationId]
  );

  const resetConversation = useCallback(() => dispatch({ type: 'RESET' }), []);

  /**
   * Phase 12A — the [Confirmer] control's handler. Reads the CURRENT
   * pendingAction off the message (never a stale closure value) so a
   * retry after a prior confirm error still uses the right actionId.
   * Never executes anything itself — POST .../confirm on the backend is
   * the only place that happens (see AiActionService.confirmAndExecute).
   */
  const confirmAction = useCallback(
    async (messageId: string) => {
      const message = state.messages.find((m) => m.id === messageId);
      const current = message?.pendingAction;
      if (!current) return;

      const outcome = await confirmAgentAction(current.actionId);
      if (outcome.status === 'ok') {
        dispatch({ type: 'ACTION_UPDATE', messageId, pendingAction: outcome.pendingAction });
      } else {
        // Keep the existing pendingAction (still confirmable/retryable)
        // but surface what went wrong.
        dispatch({ type: 'ACTION_UPDATE', messageId, pendingAction: { ...current, error: outcome.error } });
      }
    },
    [state.messages]
  );

  /** The [Annuler] control's handler — same pattern as confirmAction. */
  const cancelAction = useCallback(
    async (messageId: string) => {
      const message = state.messages.find((m) => m.id === messageId);
      const current = message?.pendingAction;
      if (!current) return;

      const outcome = await cancelAgentAction(current.actionId);
      if (outcome.status === 'ok') {
        dispatch({ type: 'ACTION_UPDATE', messageId, pendingAction: outcome.pendingAction });
      } else {
        dispatch({ type: 'ACTION_UPDATE', messageId, pendingAction: { ...current, error: outcome.error } });
      }
    },
    [state.messages]
  );

  return {
    messages: state.messages,
    conversationId: state.conversationId,
    sending: state.sending,
    error: state.error,
    historyLoading: state.historyLoading,
    historyError: state.historyError,
    sendMessage,
    resetConversation,
    confirmAction,
    cancelAction,
  };
}

export default useAgentConversation;
