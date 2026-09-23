import type { AgentActionStatus as Status } from '@/lib/ai/agentConversation';

/**
 * Phase 12A — a small status badge for an AgentAction, reusing the same
 * dark-theme "positive/negative" palette already used elsewhere in the
 * dashboard (emerald for success — see src/app/dashboard/orders/page.tsx
 * — and the existing red error-banner tones from AgentErrorBanner), not a
 * new color system.
 */
const STATUS_LABEL: Record<Status, string> = {
  PENDING_CONFIRMATION: 'En attente de confirmation',
  CONFIRMED: 'Confirmée',
  EXECUTING: 'En cours…',
  COMPLETED: 'Terminée',
  FAILED: 'Échouée',
  CANCELLED: 'Annulée',
  EXPIRED: 'Expirée',
};

const STATUS_CLASSES: Record<Status, string> = {
  PENDING_CONFIRMATION: 'bg-white/[0.06] text-gray-300 border-white/[0.1]',
  CONFIRMED: 'bg-white/[0.06] text-gray-300 border-white/[0.1]',
  EXECUTING: 'bg-[#FF5A1F]/10 text-[#FF5A1F] border-[#FF5A1F]/20',
  COMPLETED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  FAILED: 'bg-red-500/10 text-red-300 border-red-500/20',
  CANCELLED: 'bg-white/[0.06] text-gray-400 border-white/[0.1]',
  EXPIRED: 'bg-white/[0.06] text-gray-400 border-white/[0.1]',
};

export function AgentActionStatus({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export default AgentActionStatus;
