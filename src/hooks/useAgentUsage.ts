'use client';

import { useEffect, useState } from 'react';
import { fetchAgentUsage, type AgentUsageSnapshot } from '@/lib/ai/agentUsage';

/**
 * Fetches the current workspace's AI Units usage snapshot once, on
 * mount, for display on /dashboard/agent — never on the strength of this
 * data is any Agent action ever blocked client-side; that authorization
 * happens server-side (AiUsageService.reserveUsage), regardless of what
 * this hook shows.
 */
export function useAgentUsage() {
  const [usage, setUsage] = useState<AgentUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchAgentUsage().then((outcome) => {
      if (cancelled) return;
      setUsage(outcome.status === 'ok' ? outcome.usage : null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { usage, loading };
}

export default useAgentUsage;
