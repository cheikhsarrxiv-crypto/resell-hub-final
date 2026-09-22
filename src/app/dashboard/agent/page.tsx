'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAgentConversation } from '@/hooks/useAgentConversation';
import { AgentMessageList } from '@/components/ai/AgentMessageList';
import { AgentComposer } from '@/components/ai/AgentComposer';
import { AgentErrorBanner } from '@/components/ai/AgentErrorBanner';

/**
 * Phase 11A — text-only Agent conversation page. Phase 11D — restores a
 * persisted conversation from ?conversationId=... in the URL, and keeps
 * the URL in sync once a brand new conversation gets its id (so a
 * refresh right after the very first message still restores it). Talks
 * to the existing /api/ai/agent (auth/workspace/Business gate/rate limit
 * all enforced server-side, unchanged; GET added in Phase 11D follows
 * the exact same auth/workspace/gate order). `toolCalls` on each
 * assistant message — whether it came from a live POST or a restored
 * GET — are rendered by AgentMessageList via SourcingResultsGrid/
 * MarginSummaryList (Phase 11B/11C), unchanged here.
 */
export default function AgentPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const initialConversationId = searchParams.get('conversationId') ?? undefined;
  const {
    messages,
    conversationId,
    sending,
    error,
    historyLoading,
    historyError,
    sendMessage,
    resetConversation,
    confirmAction,
    cancelAction,
  } = useAgentConversation(initialConversationId);

  // Once a brand new conversation gets its real id (first message ever
  // sent on this page load, so the URL had none yet), reflect it in the
  // URL — a refresh right after that first exchange must still be able
  // to restore it. Never fires while restoring FROM the URL (conversationId
  // already equals initialConversationId in that case) and never loops
  // back into useAgentConversation's own hydration (frozen at mount —
  // see that hook's own comment).
  useEffect(() => {
    if (!conversationId || conversationId === initialConversationId) return;
    router.replace(`${pathname}?conversationId=${conversationId}`);
  }, [conversationId, initialConversationId, pathname, router]);

  const handleNewConversation = () => {
    resetConversation();
    router.replace(pathname);
    // The button that was just clicked disappears once messages resets to
    // empty (see the conditional below) — without this, focus would be
    // silently dropped to <body>, disorienting a keyboard/screen-reader
    // user. The composer is the next natural place to type.
    document.getElementById('agent-composer-input')?.focus();
  };

  const showHistoryLoading = historyLoading && messages.length === 0;

  return (
    <div className="flex flex-col h-[70vh] max-h-[720px] min-h-[420px] bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.06] shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            Agent ADKSY
          </h1>
          <p className="text-sm text-gray-500">Votre assistant pour rechercher et analyser des produits de revente.</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleNewConversation}
            disabled={sending}
            className="text-sm text-gray-400 hover:text-white transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60 rounded-md px-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400"
          >
            Nouvelle conversation
          </button>
        )}
      </div>

      {showHistoryLoading ? (
        <div className="flex-1 flex items-center justify-center" role="status">
          <p className="text-sm text-gray-500">Chargement de la conversation…</p>
        </div>
      ) : historyError ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center">
          <AgentErrorBanner message={historyError} />
        </div>
      ) : (
        <AgentMessageList
          messages={messages}
          sending={sending}
          onConfirmAction={confirmAction}
          onCancelAction={cancelAction}
          onSend={sendMessage}
        />
      )}

      {error && <AgentErrorBanner message={error} />}

      <AgentComposer sending={sending} onSend={sendMessage} />
    </div>
  );
}
