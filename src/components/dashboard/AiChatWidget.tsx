'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, X, Send } from 'lucide-react';

const WELCOME_MESSAGE =
  "Hi! I'm ADKSY AI 👋\nI can help you understand ADKSY, manage your products, listings, orders and more.\n\nWhat can I help you with?";

type CurrentPage = 'dashboard' | 'products' | 'listings' | 'orders' | 'settings' | 'integrations';

function getCurrentPage(pathname: string): CurrentPage | undefined {
  if (pathname === '/dashboard') return 'dashboard';
  if (pathname.startsWith('/dashboard/products')) return 'products';
  if (pathname.startsWith('/dashboard/listings')) return 'listings';
  if (pathname.startsWith('/dashboard/orders')) return 'orders';
  if (pathname.startsWith('/dashboard/settings/integrations')) return 'integrations';
  if (pathname.startsWith('/dashboard/settings')) return 'settings';
  return undefined;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AiChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: WELCOME_MESSAGE },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open, sending]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const userMessage: ChatMessage = { id: makeId(), role: 'user', content: trimmed };
    // Only prior turns (not this one) are sent as history — the new
    // message is sent separately as `message`.
    const history = messages
      .filter((m) => m.id !== 'welcome')
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setError(null);
    setSending(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          currentPage: getCurrentPage(pathname || ''),
          history,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to get a response. Please try again.');
      }

      setMessages((prev) => [...prev, { id: makeId(), role: 'assistant', content: data.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get a response. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close ADKSY AI' : 'Open ADKSY AI'}
        aria-expanded={open}
        className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 w-14 h-14 rounded-full bg-[#FF5A1F] text-white flex items-center justify-center shadow-[0_8px_32px_rgba(255,90,31,0.35)] hover:bg-[#e64f18] transition-colors"
      >
        {open ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
      </button>

      {/* Chat panel — full-screen sheet on mobile, floating card on desktop */}
      {open && (
        <div
          role="dialog"
          aria-label="ADKSY AI Assistant"
          className="fixed inset-0 sm:inset-auto sm:bottom-24 sm:right-6 z-50 sm:w-[380px] sm:h-[560px] sm:max-h-[80vh] flex flex-col bg-[#0a0a0c] sm:border sm:border-white/[0.08] sm:rounded-2xl sm:shadow-[0_16px_48px_rgba(0,0,0,0.5)] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-[#FF5A1F]/10 text-[#FF5A1F] flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </span>
              <h2
                className="text-base font-semibold text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                ADKSY AI
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'ml-auto bg-[#FF5A1F] text-white'
                    : 'mr-auto bg-white/[0.05] border border-white/[0.08] text-gray-200'
                }`}
              >
                {m.content}
              </div>
            ))}

            {sending && (
              <div className="mr-auto max-w-[85%] rounded-2xl px-4 py-2.5 bg-white/[0.05] border border-white/[0.08] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 landing-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 landing-pulse" style={{ animationDelay: '0.15s' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 landing-pulse" style={{ animationDelay: '0.3s' }} />
              </div>
            )}

            {error && (
              <div className="rounded-xl px-4 py-2.5 text-sm bg-red-500/10 border border-red-500/20 text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-white/[0.06] p-3 sm:p-4 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask ADKSY AI anything..."
                rows={1}
                disabled={sending}
                className="flex-1 resize-none bg-white/[0.04] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/50 disabled:opacity-50 max-h-32"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !input.trim()}
                aria-label="Send message"
                className="w-10 h-10 rounded-full bg-[#FF5A1F] text-white flex items-center justify-center shrink-0 hover:bg-[#e64f18] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AiChatWidget;
