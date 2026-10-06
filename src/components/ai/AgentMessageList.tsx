'use client';

import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import type { AgentUiMessage } from '@/lib/ai/agentConversation';
import { shouldStickToBottom } from '@/lib/ai/agentConversation';
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
}

export function AgentMessageList({ messages, sending, onConfirmAction, onCancelAction, onSend }: AgentMessageListProps) {
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
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center overflow-y-auto">
        <div className="w-14 h-14 rounded-2xl bg-[#FF5A1F]/10 border border-[#FF5A1F]/20 flex items-center justify-center mb-5">
          <Sparkles className="w-6 h-6 text-[#FF5A1F]" />
        </div>
        <h2 className="text-xl sm:text-2xl font-semibold text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          Que puis-je rechercher pour vous ?
        </h2>
        <p className="text-sm text-gray-500 max-w-md">
          Décrivez n&apos;importe quel produit — mode, high-tech, mobilier, et plus — l&apos;Agent le recherche et
          analyse sa marge potentielle.
        </p>
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
