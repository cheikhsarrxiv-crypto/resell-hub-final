import { getStatusLabel } from '@/lib/utils';

/**
 * Dark-theme status pill. Reuses getStatusLabel() from lib/utils (pure
 * text, no visuals) but defines its own color mapping — the existing
 * getStatusColor() returns light-theme classes (bg-green-100 etc.) that
 * don't read well on a dark surface.
 */
const TONE_MAP: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  // Orders
  pending: 'warning',
  processing: 'info',
  shipped: 'info',
  delivered: 'success',
  cancelled: 'error',
  error: 'error',
  // Fulfillment
  accepted: 'info',
  failed: 'error',
  // Listings
  active: 'success',
  delisted: 'neutral',
  sold_out: 'error',
  paused: 'warning',
  // Sync
  synced: 'success',
  syncing: 'info',
  not_synced: 'neutral',
  // Connections
  connected: 'success',
  not_connected: 'neutral',
  mock: 'warning',
  expired: 'neutral',
};

const TONE_CLASSES: Record<string, string> = {
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  neutral: 'bg-white/[0.06] text-gray-400 border-white/10',
};

interface StatusBadgeProps {
  status: string;
  /** Override the displayed text while keeping the color mapped from
   * `status` — needed where a page already shows different wording than
   * getStatusLabel() for the same status domain (e.g. Listings' syncStatus
   * shows "Published" for "synced", not getStatusLabel's "Synchronisé"),
   * and that existing wording must not change as part of a UI-only redesign. */
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const tone = TONE_MAP[status] || 'neutral';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${TONE_CLASSES[tone]}`}
    >
      {label ?? getStatusLabel(status)}
    </span>
  );
}
