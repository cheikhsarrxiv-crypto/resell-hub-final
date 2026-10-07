'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAgentConversation } from '@/hooks/useAgentConversation';
import { useAgentUsage } from '@/hooks/useAgentUsage';
import { AgentMessageList } from '@/components/ai/AgentMessageList';
import { AgentComposer } from '@/components/ai/AgentComposer';
import { AgentErrorBanner } from '@/components/ai/AgentErrorBanner';
import { AgentUsageBanner } from '@/components/ai/AgentUsageBanner';
import { AgentOnboarding } from '@/components/ai/AgentOnboarding';
import { recordToProfileInput, type AgentProfileInput } from '@/lib/ai/agentProfile';

/**
 * Phase 11A — text-only Agent conversation page. Phase 11D — restores a
 * persisted conversation from ?conversationId=... in the URL, and keeps
 * the URL in sync once a brand new conversation gets its id (so a
 * refresh right after the very first message still restores it). Talks
 * to the existing /api/ai/agent (auth/workspace/aiAssistant gate/rate
 * limit all enforced server-side, unchanged; GET added in Phase 11D
 * follows the exact same auth/workspace/gate order). `toolCalls` on each
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

  const { usage } = useAgentUsage();

  // AI Agent Personalization V1 — checked once per page load, via an
  // effect (never during the initial synchronous render, which always
  // shows the normal Agent UI first — see showOnboarding below). Once the
  // check resolves, profileChecked flips to true and the view switches to
  // onboarding if there is genuinely no profile yet, or if explicitly
  // requested. ?editProfile=1 (from Settings — see
  // src/app/dashboard/settings/page.tsx) forces the onboarding open again
  // even when a profile already exists, pre-filled from it.
  const editProfileRequested = searchParams.get('editProfile') === '1';
  const [profileChecked, setProfileChecked] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [existingProfileForEdit, setExistingProfileForEdit] = useState<AgentProfileInput | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/agent/profile')
      .then((res) => res.json().catch(() => null))
      .then((data: any) => {
        if (cancelled) return;
        const profile = data?.profile ?? null;
        setHasProfile(Boolean(profile));
        if (profile) setExistingProfileForEdit(recordToProfileInput(profile));
        setProfileChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        // A failed check never blocks access to the Agent — treated the
        // exact same way as "no profile yet" (onboarding would show, but
        // "Terminer maintenant"/"Passer" always let the reseller through
        // immediately; the Agent itself works identically either way).
        setHasProfile(false);
        setProfileChecked(true);
      });
    return () => {
      cancelled = true;
    };
    // Checked once per page load only — a completed/edited onboarding
    // flips hasProfile directly via handleOnboardingComplete below,
    // never by re-running this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setHasProfile(true);
    if (editProfileRequested) {
      router.replace(pathname);
    }
  }, [editProfileRequested, pathname, router]);

  const showOnboarding = profileChecked && (!hasProfile || editProfileRequested);

  // Lets a click on one of AgentMessageList's "Exemples de demandes" cards
  // fill AgentComposer's field — the two are siblings with no shared
  // state otherwise, so this one small piece of state is the connector.
  // `nonce` (not just the text) so clicking the same card twice in a row
  // still re-triggers AgentComposer's own prefill effect. Never sends
  // anything itself — see AgentComposer's own `prefill` prop doc.
  const [exampleToFill, setExampleToFill] = useState<{ text: string; nonce: number } | null>(null);

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
    <div
      className={`agent-glow-bg flex flex-col min-h-[420px] border border-white/[0.06] rounded-2xl ${
        // Bounded, internally-scrolling "chat window" height only makes
        // sense once there are real messages to scroll through. The empty
        // welcome state (hero + "Exemples de demandes" + composer) is
        // meant to flow naturally and let the page itself scroll (the
        // dashboard shell's own <main> is already overflow-auto) — no
        // fixed height, no overflow-hidden, so nothing gets clipped into
        // a hidden internal scrollbar.
        messages.length === 0 ? '' : 'h-[70vh] max-h-[720px] overflow-hidden'
      }`}
    >
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.06] shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            Agent ADKSY
          </h1>
          <p className="text-sm text-gray-500">Votre assistant pour rechercher et analyser des produits de revente.</p>
        </div>
        {!showOnboarding && messages.length > 0 && (
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

      {showOnboarding ? (
        <AgentOnboarding onComplete={handleOnboardingComplete} initialAnswers={editProfileRequested ? existingProfileForEdit : null} />
      ) : (
        <>
          {usage && <AgentUsageBanner usage={usage} />}

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
              onExampleSelect={(text) => setExampleToFill({ text, nonce: Date.now() })}
            />
          )}

          {error && <AgentErrorBanner message={error} />}

          <AgentComposer sending={sending} onSend={sendMessage} isEmpty={messages.length === 0} prefill={exampleToFill} />
        </>
      )}
    </div>
  );
}
