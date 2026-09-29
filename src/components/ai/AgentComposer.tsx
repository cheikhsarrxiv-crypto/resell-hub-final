'use client';

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { canSendAgentMessage, MAX_AGENT_MESSAGE_LENGTH } from '@/lib/ai/agentConversation';

interface AgentComposerProps {
  sending: boolean;
  onSend: (message: string) => void;
}

export function AgentComposer({ sending, onSend }: AgentComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = canSendAgentMessage(value, sending);
  const trimmedLength = value.trim().length;
  const showCounter = trimmedLength > MAX_AGENT_MESSAGE_LENGTH * 0.9;

  // Grows the textarea with a multi-line message (Shift+Enter) instead of
  // trapping it in a single-line scrolling box — bounded by the existing
  // max-h-32 below, which still wins over this inline height once the
  // content is taller (CSS max-height always caps a taller inline height).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const handleSend = () => {
    if (!canSend) return;
    onSend(value);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-white/[0.06] p-3 sm:p-4 shrink-0">
      <div className="flex items-end gap-2">
        <label htmlFor="agent-composer-input" className="sr-only">
          Écrire un message à l&apos;Agent ADKSY
        </label>
        <textarea
          ref={textareaRef}
          id="agent-composer-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Écrire un message..."
          rows={1}
          maxLength={MAX_AGENT_MESSAGE_LENGTH}
          disabled={sending}
          aria-disabled={sending}
          className="flex-1 resize-none bg-white/[0.04] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/50 disabled:opacity-50 max-h-32"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Envoyer le message"
          className="w-10 h-10 rounded-full bg-[#FF5A1F] text-white flex items-center justify-center shrink-0 hover:bg-[#e64f18] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      {showCounter && (
        <p className="mt-1.5 text-xs text-gray-500 text-right" aria-live="polite">
          {trimmedLength} / {MAX_AGENT_MESSAGE_LENGTH}
        </p>
      )}
    </div>
  );
}

export default AgentComposer;
