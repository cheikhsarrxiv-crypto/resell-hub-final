/**
 * Phase 12A — the AgentAction state machine, kept pure and framework-free
 * (no Prisma, no React) so its transition rules are directly unit-testable
 * with plain Vitest, following the same pattern established for the Agent
 * UI's own logic in src/lib/ai/agentConversation.ts. AiActionService is
 * the only caller — this module decides what's legal, never what's true
 * (it doesn't touch the database or the clock beyond the `now`/`expiresAt`
 * it's given).
 */

export type AgentActionStatus =
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export const TERMINAL_ACTION_STATUSES: readonly AgentActionStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
];

export function isTerminalActionStatus(status: AgentActionStatus): boolean {
  return (TERMINAL_ACTION_STATUSES as string[]).includes(status);
}

/**
 * The complete, explicit allow-list of legal transitions. Anything not
 * listed here — including every transition out of a terminal status, and
 * every attempt to move "backwards" (e.g. COMPLETED -> EXECUTING) — is
 * illegal. AiActionService's own DB updates always go through this before
 * writing a new status, so an illegal transition can never reach the
 * database even under a bug elsewhere in the call chain.
 */
const ALLOWED_TRANSITIONS: Record<AgentActionStatus, readonly AgentActionStatus[]> = {
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['EXECUTING'],
  EXECUTING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: AgentActionStatus, to: AgentActionStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** 15 minutes — see AiActionService.proposeAction. */
export const ACTION_CONFIRMATION_TTL_MS = 15 * 60 * 1000;
