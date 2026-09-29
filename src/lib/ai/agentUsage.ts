/**
 * Pure fetch wrapper around GET /api/ai/agent/usage — same "plain async
 * function, no hook" pattern already used by fetchConversationHistory in
 * agentConversation.ts, kept in its own file since it's an unrelated
 * concern (usage display, not the conversation itself).
 */

export interface AgentUsageSnapshot {
  unitsConsumed: number;
  unitsReserved: number;
  unitsLimit: number;
  periodStart: string;
  periodEnd: string;
}

export type FetchAgentUsageOutcome =
  | { status: 'ok'; usage: AgentUsageSnapshot | null }
  | { status: 'error' };

function isValidSnapshot(raw: unknown): raw is AgentUsageSnapshot {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.unitsConsumed === 'number' &&
    typeof r.unitsReserved === 'number' &&
    typeof r.unitsLimit === 'number' &&
    typeof r.periodStart === 'string' &&
    typeof r.periodEnd === 'string'
  );
}

/**
 * Never throws. A network failure, a non-2xx response, or a malformed
 * body all resolve to `{status: 'error'}` — the caller's job is to hide
 * the usage indicator on error, never to block the Agent itself on it
 * (this is a display-only concern, not an authorization check).
 */
export async function fetchAgentUsage(): Promise<FetchAgentUsageOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/ai/agent/usage');
  } catch {
    return { status: 'error' };
  }

  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    return { status: 'error' };
  }

  if (data.usage === null) {
    return { status: 'ok', usage: null };
  }

  if (!isValidSnapshot(data.usage)) {
    return { status: 'error' };
  }

  return { status: 'ok', usage: data.usage };
}

/** True once a workspace's reserved+consumed units meet or exceed its limit — the exact threshold the UI uses to show the "limit reached" message. */
export function isUsageLimitReached(usage: AgentUsageSnapshot): boolean {
  return usage.unitsConsumed + usage.unitsReserved >= usage.unitsLimit;
}
