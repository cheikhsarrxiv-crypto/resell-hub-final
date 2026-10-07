'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Send, Paperclip, X, Loader2 } from 'lucide-react';
import {
  canSendAgentMessage,
  MAX_AGENT_MESSAGE_LENGTH,
  resolveKnownConversationId,
  type AgentPhotoAttachment,
} from '@/lib/ai/agentConversation';
import { AGENT_EXAMPLE_PROMPTS, AGENT_EXAMPLE_PROMPTS_SHORT } from '@/lib/ai/agentExamples';

// Image-search feature (Phase 1) — mirrors StorageService's own
// ALLOWED_MIME_TYPES/MAX_FILE_SIZE exactly (that file is server-only —
// Supabase service role + Prisma — and must never be imported into a
// 'use client' bundle; ImageUploadZone.tsx already duplicates the same
// two values for the same reason). Client-side validation here is purely
// a fast, friendly rejection — StorageService re-validates both
// server-side regardless, which remains the real enforcement.
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface AgentComposerProps {
  sending: boolean;
  onSend: (message: string, attachments?: AgentPhotoAttachment[], conversationIdOverride?: string) => void;
  /**
   * True on the welcome screen (no messages yet in the conversation) —
   * switches the composer to a larger, more premium presentation. Purely
   * visual: send logic/eligibility (canSendAgentMessage, handleSend) is
   * identical in both states.
   */
  isEmpty?: boolean;
  /**
   * Set when the reseller clicks one of the static "Exemples de demandes"
   * cards elsewhere on the page (AgentMessageList) — fills the field with
   * that exact text and focuses it, exactly like clicking the rotating
   * placeholder already does. `nonce` only exists so clicking the SAME
   * card twice in a row still re-triggers the effect below (a changed
   * primitive value, not object identity). Purely additive: never sends
   * anything itself, never touches canSendAgentMessage/handleSend.
   */
  prefill?: { text: string; nonce: number } | null;
  /**
   * Image-search feature (Phase 1) — the real, already-persisted
   * AgentConversation id, once one exists. null before the conversation's
   * first message has actually been sent. The attach control is NEVER
   * gated on this being set — POST /api/ai/agent/photos now creates the
   * AgentConversation row itself when no id exists yet (see that route's
   * own comment), so a reseller can attach a photo on a brand new
   * conversation's very first turn too (see this component's own
   * `uploadedConversationId` state for how the id that creates returns
   * then flows into the eventual send).
   */
  conversationId?: string | null;
}

interface PendingImageAttachment {
  file: File;
  preview: string;
  uploading: boolean;
  error: string | null;
  uploaded: AgentPhotoAttachment | null;
}

export function AgentComposer({ sending, onSend, isEmpty = false, prefill = null, conversationId = null }: AgentComposerProps) {
  const [value, setValue] = useState('');
  const [exampleIndex, setExampleIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [attachment, setAttachment] = useState<PendingImageAttachment | null>(null);
  // Image-search feature (Phase 1) — first-message UX fix: set only when
  // uploadAttachment's own call to POST /api/ai/agent/photos had to
  // create a brand new AgentConversation row (conversationId prop was
  // still null at the time), from that response's own returned id. Lets
  // a SECOND photo pick (after removing the first, before ever sending)
  // reuse the SAME just-created conversation instead of creating another
  // one, and lets handleSend pass it as sendMessage's conversationId
  // override. Reset whenever conversationId genuinely goes back to null
  // (a real "Nouvelle conversation" reset — see the effect below); once a
  // real send completes, the `conversationId` prop itself becomes
  // authoritative again and this value stops being read (see
  // `effectiveConversationId` below).
  const [uploadedConversationId, setUploadedConversationId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revokes the previous blob: preview URL whenever it's replaced, and on
  // unmount — the only two moments a given preview URL is ever discarded.
  useEffect(() => {
    return () => {
      if (attachment?.preview) URL.revokeObjectURL(attachment.preview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment?.preview]);

  // Image-search feature (Phase 1) — a conversationId that goes back to
  // null only ever means an explicit reset ("Nouvelle conversation" —
  // see AgentPage's own resetConversation): any photo/conversation this
  // composer resolved for the PREVIOUS conversation must never leak into
  // the new one. A no-op on first mount (conversationId already starts
  // null, so this just confirms the already-null initial state).
  useEffect(() => {
    if (conversationId === null) {
      setUploadedConversationId(null);
      clearAttachment();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Additive only — reacts to an external "fill the composer" request
  // (see prefill's own doc comment above). Intentionally keyed on
  // prefill?.nonce alone, not prefill?.text, so the effect fires again
  // even if the same example is clicked twice in a row.
  useEffect(() => {
    if (!prefill) return;
    setValue(prefill.text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(prefill.text.length, prefill.text.length);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  const hasUploadedAttachment = Boolean(attachment?.uploaded);
  const canSend = canSendAgentMessage(value, sending, hasUploadedAttachment) && !attachment?.uploading;
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

  const clearAttachment = () => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * Image-search feature (Phase 1) — uploads the chosen file through the
   * EXISTING POST /api/ai/agent/photos endpoint (same route/StorageService
   * method already used by the FREE listing creation workflow — see that
   * route's own comment) as soon as it's picked, so the real
   * {url, storagePath, mimeType} is already available by the time the
   * reseller hits Send. Never sends raw file bytes over the chat's own
   * JSON body — only this already-uploaded reference, exactly like
   * AgentPhotoAttachment already expects.
   */
  const uploadAttachment = async (file: File) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
      setAttachment({
        file,
        preview: URL.createObjectURL(file),
        uploading: false,
        error: "Format d'image non pris en charge (JPEG, PNG, WebP ou GIF uniquement).",
        uploaded: null,
      });
      return;
    }
    if (file.size > MAX_IMAGE_FILE_SIZE) {
      setAttachment({
        file,
        preview: URL.createObjectURL(file),
        uploading: false,
        error: 'Image trop volumineuse (10 Mo maximum).',
        uploaded: null,
      });
      return;
    }

    setAttachment({ file, preview: URL.createObjectURL(file), uploading: true, error: null, uploaded: null });

    // Image-search feature (Phase 1) — first-message UX fix: send
    // whichever conversationId this composer already knows about, if
    // any (the real prop once a conversation exists, or one THIS
    // composer instance already had the upload route create for an
    // earlier photo pick in the same not-yet-sent turn) — omitted
    // entirely otherwise, letting the route create a brand new
    // AgentConversation row itself (see that route's own comment).
    const knownConversationId = resolveKnownConversationId(conversationId, uploadedConversationId);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (knownConversationId) formData.append('conversationId', knownConversationId);
      const response = await fetch('/api/ai/agent/photos', { method: 'POST', body: formData });
      const data: any = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setAttachment((current) =>
          current ? { ...current, uploading: false, error: data?.error || "L'envoi de la photo a échoué." } : current
        );
        return;
      }

      if (!knownConversationId && typeof data.conversationId === 'string') {
        setUploadedConversationId(data.conversationId);
      }

      setAttachment((current) =>
        current
          ? { ...current, uploading: false, error: null, uploaded: { url: data.url, storagePath: data.storagePath, mimeType: data.mimeType } }
          : current
      );
    } catch {
      setAttachment((current) => (current ? { ...current, uploading: false, error: 'Connexion impossible. Réessayez.' } : current));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadAttachment(file);
  };

  const handleSend = () => {
    if (!canSend) return;
    // aiAgentMessageSchema.message still requires non-empty text even
    // when a photo is attached — a reseller sending just a photo with no
    // caption gets a real, honest, generic default here, never a
    // silently invented product description.
    const textToSend = value.trim().length > 0 ? value : 'Je cherche ce produit.';
    // Image-search feature (Phase 1) — first-message UX fix: when this
    // composer's own photo upload is what created the conversation (no
    // conversationId prop yet), pass that exact id through so sendMessage
    // uses it instead of the hook's own (still-null) state — see
    // useAgentConversation.sendMessage's own comment on this parameter.
    const conversationIdOverride = resolveKnownConversationId(conversationId, uploadedConversationId) ?? undefined;
    onSend(textToSend, attachment?.uploaded ? [attachment.uploaded] : undefined, conversationIdOverride);
    setValue('');
    clearAttachment();
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
      {attachment && (
        <div className="mb-2 flex items-center gap-2">
          <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-white/[0.06] shrink-0">
            <Image src={attachment.preview} alt="Photo jointe" fill className="object-cover" />
            {attachment.uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {attachment.error ? (
              <p className="text-xs text-red-400 truncate">{attachment.error}</p>
            ) : attachment.uploading ? (
              <p className="text-xs text-gray-500">Envoi de la photo…</p>
            ) : (
              <p className="text-xs text-gray-500 truncate">{attachment.file.name}</p>
            )}
          </div>
          <button
            type="button"
            onClick={clearAttachment}
            aria-label="Retirer la photo"
            className="w-7 h-7 rounded-full bg-white/[0.08] text-gray-400 hover:text-white hover:bg-white/[0.14] flex items-center justify-center shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/40"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor="agent-composer-input" className="sr-only">
          Écrire un message à l&apos;Agent ADKSY
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFileChange}
          // Image-search feature (Phase 1) — first-message UX fix: no
          // longer gated on conversationId existing yet — POST
          // /api/ai/agent/photos now creates the AgentConversation row
          // itself when none exists (see that route's own comment), so a
          // photo can be attached before the very first message is sent.
          disabled={sending || Boolean(attachment)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || Boolean(attachment)}
          aria-label="Joindre une photo"
          title="Joindre une photo"
          className="w-10 h-10 rounded-full bg-white/[0.06] text-gray-400 hover:text-white hover:bg-white/[0.1] flex items-center justify-center shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/40"
        >
          <Paperclip className="w-4 h-4" />
        </button>
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
            className={`w-full resize-none bg-white/[0.04] rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/50 disabled:opacity-50 transition-shadow ${
              isEmpty
                ? 'border border-[#FF5A1F]/25 shadow-[0_0_30px_-10px_rgba(255,90,31,0.35)] focus:shadow-[0_0_30px_-6px_rgba(255,90,31,0.5)]'
                : 'border border-white/10'
            } ${fieldSizeClasses}`}
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
          L&apos;Agent recherche les produits que tu veux sourcer — mode, high-tech, mobilier, et plus.
        </p>
      )}
      </div>
    </div>
  );
}

export default AgentComposer;
