'use client';

import { useState } from 'react';
import { resultHasImageAttachmentWarning, type AgentPendingAction } from '@/lib/ai/agentConversation';
import { AgentActionPreview } from './AgentActionPreview';
import { AgentActionStatus } from './AgentActionStatus';

interface AgentConfirmationProps {
  pendingAction: AgentPendingAction;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

/**
 * Phase 12A — the confirm/cancel control for an 'engage' action.
 * `pendingAction` is the exact server-side AgentAction state (see
 * useAgentConversation's ACTION_UPDATE) — this component never decides
 * for itself whether the action succeeded, expired, or is still pending;
 * it only reflects what the backend already told it. Confirming/
 * cancelling always goes through the backend
 * (POST /api/ai/agent/actions/[id]/confirm|cancel) — clicking a button
 * here never executes anything on its own.
 */
export function AgentConfirmation({ pendingAction, onConfirm, onCancel }: AgentConfirmationProps) {
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const isPending = pendingAction.status === 'PENDING_CONFIRMATION';
  // Gated strictly on THIS action's own, just-received result — never on
  // the model's text, conversation history, or any other action's result
  // (pendingAction is replaced wholesale per-message on every
  // confirm/cancel response, so there is nothing here to leak from a
  // prior action). Checked only when COMPLETED: a FAILED/CANCELLED/
  // EXPIRED action's own error/status handling below is untouched.
  const hasImageAttachmentWarning =
    pendingAction.status === 'COMPLETED' && resultHasImageAttachmentWarning(pendingAction.result);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy('confirm');
    try {
      await onConfirm();
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    if (busy) return;
    setBusy('cancel');
    try {
      await onCancel();
    } finally {
      setBusy(null);
    }
  };

  let expiresLabel: string | null = null;
  try {
    expiresLabel = new Date(pendingAction.expiresAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    expiresLabel = null;
  }

  return (
    <div className="mr-auto max-w-[85%] sm:max-w-[70%] rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-white">Confirmation requise</span>
        <AgentActionStatus status={pendingAction.status} />
      </div>

      <AgentActionPreview summary={pendingAction.summary} />

      {pendingAction.error && (
        <p role="alert" className="text-xs text-red-300">
          {pendingAction.error}
        </p>
      )}

      {isPending && (
        <>
          {expiresLabel && <p className="text-xs text-gray-500">Cette confirmation expire à {expiresLabel}.</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy !== null}
              className="flex-1 rounded-xl bg-[#FF5A1F] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#e64f18] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60"
            >
              {busy === 'confirm' ? 'Confirmation…' : 'Confirmer'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy !== null}
              className="flex-1 rounded-xl border border-white/[0.1] px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60"
            >
              {busy === 'cancel' ? 'Annulation…' : 'Annuler'}
            </button>
          </div>
        </>
      )}

      {pendingAction.status === 'COMPLETED' && hasImageAttachmentWarning && (
        <p className="text-xs text-amber-400">
          Produit créé, mais les images n&apos;ont pas pu être ajoutées. Vous devrez les joindre manuellement.
        </p>
      )}
      {pendingAction.status === 'COMPLETED' && !hasImageAttachmentWarning && (
        <p className="text-xs text-emerald-400">Action confirmée et exécutée.</p>
      )}
      {pendingAction.status === 'FAILED' && (
        <p className="text-xs text-red-300">{pendingAction.error ?? "L'exécution a échoué."}</p>
      )}
      {pendingAction.status === 'EXPIRED' && (
        <p className="text-xs text-gray-500">Le délai de confirmation est dépassé. Redemandez cette action si besoin.</p>
      )}
      {pendingAction.status === 'CANCELLED' && <p className="text-xs text-gray-500">Action annulée — rien n&apos;a été exécuté.</p>}
    </div>
  );
}

export default AgentConfirmation;
