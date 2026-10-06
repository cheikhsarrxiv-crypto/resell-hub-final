'use client';

import { useEffect, useRef } from 'react';
import { Sparkles, Footprints, Sofa, Laptop, Gamepad2, Camera, Shirt, Armchair, ArrowRight } from 'lucide-react';
import type { AgentUiMessage } from '@/lib/ai/agentConversation';
import { shouldStickToBottom } from '@/lib/ai/agentConversation';
import { AGENT_EXAMPLE_PROMPTS } from '@/lib/ai/agentExamples';
import { AgentLoadingIndicator } from './AgentLoadingIndicator';
import { SourcingResultsGrid } from './SourcingResultsGrid';
import { MarginSummaryList } from './MarginSummaryList';
import { ListingDraftList } from './ListingDraftList';
import { AgentConfirmation } from './AgentConfirmation';
import { SelectionProposalCard } from './SelectionProposalCard';

interface AgentMessageListProps {
  messages: AgentUiMessage[];
  sending: boolean;
  /** Phase 12A — forwarded to AgentConfirmation for the message that carries a pendingAction. */
  onConfirmAction?: (messageId: string) => void | Promise<void>;
  onCancelAction?: (messageId: string) => void | Promise<void>;
  /**
   * Phase 4 — forwarded to SourcingResultsGrid so a sourcing result card's
   * "Créer un produit" can send a real chat message (same function the
   * composer itself calls) — never a direct call into create_product.
   * Omit to render sourcing cards read-only (no button).
   */
  onSend?: (message: string) => void;
  /**
   * Fired when the reseller clicks one of the "Exemples de demandes" cards
   * in the empty state — fills the composer with that exact text (see
   * AgentComposer's own `prefill` prop), never sends it automatically.
   * Same "illustrative suggestion, never auto-send" rule as the composer's
   * own rotating placeholder.
   */
  onExampleSelect?: (text: string) => void;
}

/** One icon per example, in the same order as AGENT_EXAMPLE_PROMPTS — purely decorative. */
const EXAMPLE_ICONS = [Footprints, Sofa, Laptop, Gamepad2, Camera, Shirt, Armchair];

export function AgentMessageList({ messages, sending, onConfirmAction, onCancelAction, onSend, onExampleSelect }: AgentMessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Starts true: the very first paint of a non-empty list (a freshly
  // restored conversation, or the first message of a brand new one)
  // should land at the bottom, not wherever the browser happens to put
  // it. Updated on every scroll so a user who scrolls up to re-read
  // earlier history is never yanked back down by a new message.
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    stickToBottomRef.current = shouldStickToBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
  };

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 sm:px-6 py-8 sm:py-10 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FF5A1F]/30 bg-[#FF5A1F]/10 px-3 py-1 text-xs font-medium text-[#FF5A1F] mb-5 sm:mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          Agent IA
        </span>
        <h2
          className="text-2xl sm:text-3xl md:text-4xl font-semibold text-white mb-3 sm:mb-4 max-w-2xl leading-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Transforme ton idée en une boutique <span className="text-[#FF5A1F]">prête à vendre</span> en quelques
          minutes.
        </h2>
        <p className="text-sm sm:text-base text-gray-400 max-w-md mb-8 sm:mb-10">
          Décris n&apos;importe quel produit — mode, high-tech, mobilier, et plus — l&apos;Agent le recherche,
          compare les prix et prépare ta prochaine annonce.
        </p>

        <div className="w-full max-w-xl text-left">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[#FF5A1F]/80 mb-3 px-1">
            <Sparkles className="w-3.5 h-3.5" />
            Exemples de demandes
          </p>
          <div className="flex flex-col gap-2">
            {AGENT_EXAMPLE_PROMPTS.map((prompt, i) => {
              const Icon = EXAMPLE_ICONS[i] ?? Sparkles;
              return (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onExampleSelect?.(prompt)}
                  className="group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-left transition-colors hover:border-[#FF5A1F]/40 hover:bg-[#FF5A1F]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60"
                >
                  <span className="shrink-0 w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-gray-400 group-hover:text-[#FF5A1F] group-hover:border-[#FF5A1F]/30 transition-colors">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="flex-1 text-sm text-gray-300 group-hover:text-white transition-colors">{prompt}</span>
                  <ArrowRight className="w-4 h-4 shrink-0 text-gray-600 group-hover:text-[#FF5A1F] transition-colors" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Conversation avec l'Agent ADKSY"
    >
      {messages.map((m) => (
        <div key={m.id} className="space-y-2">
          <div
            className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
              m.role === 'user'
                ? 'ml-auto bg-[#FF5A1F] text-white'
                : 'mr-auto bg-white/[0.05] border border-white/[0.08] text-gray-200'
            }`}
          >
            {/* Rendered as plain React text content — never
                dangerouslySetInnerHTML, never a markdown/HTML parser. Safe
                by construction even if the agent's reply or a future
                seller-sourced string contained markup-looking text. */}
            {m.content}
          </div>
          {m.role === 'assistant' && (
            <>
              {/* onSend withheld while a turn is in flight, same as the
                  composer's own send button being disabled — never two
                  overlapping agent requests from one page. */}
              <SourcingResultsGrid toolCalls={m.toolCalls} onSend={sending ? undefined : onSend} />
              <MarginSummaryList toolCalls={m.toolCalls} />
              <SelectionProposalCard toolCalls={m.toolCalls} onSend={sending ? undefined : onSend} />
              <ListingDraftList toolCalls={m.toolCalls} onSend={sending ? undefined : onSend} />
              {m.pendingAction && (
                <AgentConfirmation
                  pendingAction={m.pendingAction}
                  onConfirm={() => onConfirmAction?.(m.id)}
                  onCancel={() => onCancelAction?.(m.id)}
                />
              )}
            </>
          )}
        </div>
      ))}
      {sending && <AgentLoadingIndicator />}
    </div>
  );
}

export default AgentMessageList;
