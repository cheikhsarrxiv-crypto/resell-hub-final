import Link from 'next/link';
import { isUsageLimitReached, type AgentUsageSnapshot } from '@/lib/ai/agentUsage';

interface AgentUsageBannerProps {
  usage: AgentUsageSnapshot;
}

/**
 * Displays the workspace's AI Units usage for the current billing period.
 * Available on every plan (Free included, per this task's own brief) —
 * this never blocks the composer; it's a display-only indicator. When the
 * quota is exhausted, shows the exact message the brief asked for plus an
 * upgrade link — the real refusal (and its message) still comes from the
 * server, tool by tool, this is only the proactive heads-up.
 */
export function AgentUsageBanner({ usage }: AgentUsageBannerProps) {
  const limitReached = isUsageLimitReached(usage);
  const used = Math.min(usage.unitsConsumed + usage.unitsReserved, usage.unitsLimit);

  if (limitReached) {
    return (
      <div className="mx-4 sm:mx-6 mt-3 rounded-xl px-4 py-2.5 text-sm bg-[#FF5A1F]/10 border border-[#FF5A1F]/20 text-[#FF5A1F] shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span>Vous avez atteint votre limite d&apos;utilisation de l&apos;Agent IA pour cette période.</span>
        <Link
          href="/dashboard/subscription"
          className="text-white bg-[#FF5A1F] hover:bg-[#FF5A1F]/90 rounded-lg px-3 py-1.5 text-xs font-medium shrink-0 text-center transition-colors"
        >
          Améliorer mon forfait
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-4 sm:mx-6 mt-3 text-xs text-gray-500 shrink-0">
      {used} / {usage.unitsLimit} unités IA utilisées cette période
    </div>
  );
}

export default AgentUsageBanner;
