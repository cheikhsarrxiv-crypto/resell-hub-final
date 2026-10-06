'use client';

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { canSendAgentMessage, MAX_AGENT_MESSAGE_LENGTH } from '@/lib/ai/agentConversation';

interface AgentComposerProps {
  sending: boolean;
  onSend: (message: string) => void;
  /**
   * True on the welcome screen (no messages yet in the conversation) —
   * switches the composer to a larger, more premium presentation. Purely
   * visual: send logic/eligibility (canSendAgentMessage, handleSend) is
   * identical in both states.
   */
  isEmpty?: boolean;
}

/**
 * Deliberately spans several product categories (sneakers, furniture,
 * electronics, gaming, photo, fashion listing creation) so the rotating
 * placeholder itself demonstrates the Agent is not fashion-only — see
 * the Phase D/E read-only audits on search_products universality.
 */
const AGENT_EXAMPLE_PROMPTS = [
  'Trouve-moi une Air Force 1 taille 43 à moins de 100 €',
  'Trouve-moi une table moderne à moins de 150 €',
  'Trouve-moi un MacBook Air M2 à moins de 700 €',
  'Trouve-moi une PS5 d’occasion au meilleur prix',
  'Trouve-moi une caméra Sony à moins de 800 €',
  'Crée-moi une annonce pour cette veste',
  'Trouve-moi une chaise de bureau confortable à moins de 200 €',
];

/**
 * Same 7 examples, shorter — on a ~390px phone the composer's actual text
 * area is only ~220px wide (outer padding + the send button + the
 * field's own padding all eat into the 390px viewport), where the full
 * sentences above visibly truncate mid-word. Rendered below `sm` instead
 * of the array above (never both at once — see the two overlay spans in
 * the JSX), same order/index so the rotation and the focus pick-up stay
 * in sync with their desktop counterpart.
 */
const AGENT_EXAMPLE_PROMPTS_SHORT = [
  'Air Force 1 — taille 43 — moins de 100 €',
  'Table moderne — moins de 150 €',
  'MacBook Air M2 — moins de 700 €',
  'PS5 d’occasion — meilleur prix',
  'Caméra Sony — moins de 800 €',
  'Crée une annonce pour cette veste',
  'Chaise de bureau — moins de 200 €',
];

export function AgentComposer({ sending, onSend, isEmpty = false }: AgentComposerProps) {
  const [value, setValue] = useState('');
  const [exampleIndex, setExampleIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = canSendAgentMessage(value, sending);
  const trimmedLength = value.trim().length;
  const showCounter = trimmedLength > MAX_AGENT_MESSAGE_LENGTH * 0.9;

  // The rotating example is purely a visual overlay (see the textarea's
  // own onFocus below) — it only shows while the field is genuinely
  // empty, and disappears the instant a value exists (typed, pasted, or
  // picked up on focus), so it can never be confused with/sent as real
  // content, and the animation can never run while the user is typing.
  const showRotatingExample = value.length === 0;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handleChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!showRotatingExample || reducedMotion) return;
    const id = setInterval(() => {
      setExampleIndex((i) => (i + 1) % AGENT_EXAMPLE_PROMPTS.length);
    }, 3200);
    return () => clearInterval(id);
  }, [showRotatingExample, reducedMotion]);

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

  /**
   * Picks up the currently-displayed rotating example into the real field
   * on focus (click or keyboard) — the animation stops the same instant
   * (showRotatingExample becomes false once value is non-empty), and the
   * reseller can edit or clear it freely. Never fires once the field
   * already has content, so a returning focus never overwrites a
   * message being composed.
   */
  const handleFocus = () => {
    if (value.length > 0) return;
    // Picks from whichever array is actually on screen at the moment of
    // the click (the short one renders below the `sm` breakpoint — see
    // the two overlay spans in the JSX) so the injected value always
    // matches "l'exemple affiché", never the other viewport's wording.
    const isMobileViewport = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;
    const example = (isMobileViewport ? AGENT_EXAMPLE_PROMPTS_SHORT : AGENT_EXAMPLE_PROMPTS)[exampleIndex];
    setValue(example);
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(example.length, example.length);
    });
  };

  // Larger, more premium sizing on the welcome screen (isEmpty) — same
  // classes applied to both the textarea and its overlay(s) so the
  // rotating example text always lines up exactly with where real typed
  // text would sit. 16px (text-base) on mobile also avoids iOS Safari's
  // auto-zoom on focus, a correctness bonus of the premium sizing, not
  // just cosmetic. min-h-[76px] below `sm` reserves room for the short
  // mobile overlay's up-to-2-line wrap (see line-clamp-2 below) so it
  // never gets vertically clipped; sm:min-h-0 drops it back to the
  // content-driven height desktop already had.
  const fieldSizeClasses = isEmpty
    ? 'px-4 py-3.5 text-base sm:text-lg max-h-40 min-h-[76px] sm:min-h-0'
    : 'px-3.5 py-2.5 text-sm max-h-32';

  return (
    <div className={`border-t border-white/[0.06] shrink-0 ${isEmpty ? 'p-5 sm:p-8 bg-[#14161A]/60' : 'p-3 sm:p-4'}`}>
      <div className={isEmpty ? 'max-w-2xl mx-auto w-full' : ''}>
      <div className="flex items-end gap-2">
        <label htmlFor="agent-composer-input" className="sr-only">
          Écrire un message à l&apos;Agent ADKSY
        </label>
        <div className="relative flex-1">
          {showRotatingExample && (
            // Decorative only — aria-hidden so screen readers never read the
            // rotating examples in a loop; the field's real accessible name
            // comes from the stable sr-only <label> above. pointer-events-none
            // lets a click/tap pass straight through to the real textarea,
            // whose own onFocus picks the shown example up into the field.
            //
            // Two variants, toggled by Tailwind's `sm` breakpoint alone (no
            // JS/viewport state, so there's no hydration flash): below sm,
            // the composer's real text area is only ~220px wide (outer
            // padding + the send button eat into a 390px phone), where
            // the full sentence truncates mid-word — so mobile gets the
            // shorter wording instead, wrapped onto up to 2 lines
            // (line-clamp-2, no ellipsis) rather than cut. Desktop keeps the
            // full sentence, single-line truncate as a safety net.
            <>
              <span
                key={`full-${exampleIndex}`}
                aria-hidden="true"
                className={`agent-example-fade pointer-events-none absolute inset-0 hidden sm:flex items-center truncate text-gray-500 ${fieldSizeClasses}`}
              >
                {AGENT_EXAMPLE_PROMPTS[exampleIndex]}
              </span>
              <span
                key={`short-${exampleIndex}`}
                aria-hidden="true"
                className={`agent-example-fade pointer-events-none absolute inset-0 flex sm:hidden items-center text-gray-500 ${fieldSizeClasses}`}
              >
                {/* line-clamp sets its own display (-webkit-box), which
                    would fight the flex/items-center above if put on the
                    same element — kept on this inner span instead, so the
                    outer span still centers it vertically. */}
                <span className="line-clamp-2 whitespace-normal">{AGENT_EXAMPLE_PROMPTS_SHORT[exampleIndex]}</span>
              </span>
            </>
          )}
          <textarea
            ref={textareaRef}
            id="agent-composer-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            placeholder=""
            rows={1}
            maxLength={MAX_AGENT_MESSAGE_LENGTH}
            disabled={sending}
            aria-disabled={sending}
            className={`w-full resize-none bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/50 disabled:opacity-50 ${fieldSizeClasses}`}
          />
        </div>
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
      {isEmpty && (
        <p className="mt-3 text-xs text-[#F7F6F2]/35 text-center">
          L&apos;Agent recherche n&apos;importe quel type de produit — mode, high-tech, mobilier, et plus.
        </p>
      )}
      </div>
    </div>
  );
}

export default AgentComposer;
