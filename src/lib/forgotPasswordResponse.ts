/**
 * Pure interpretation of POST /api/auth/forgot-password's response —
 * extracted out of the page component so the real decision (429 vs. a
 * genuine server failure vs. the normal "check your inbox" outcome) is
 * unit-testable without jsdom/@testing-library (not installed in this
 * project — see src/lib/ai/agentConversation.ts for the established
 * precedent of keeping this kind of logic out of the component itself).
 *
 * Before this existed, the page only branched on status === 429 and
 * treated every other status — including a real 500 — as success,
 * silently hiding a genuine EmailService/Resend failure from the user.
 */
export type ForgotPasswordOutcome =
  | { kind: 'submitted' }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'failed'; message: string };

const RATE_LIMIT_FALLBACK_MESSAGE = 'Trop de tentatives. Réessaie plus tard.';
const GENERIC_FAILURE_FALLBACK_MESSAGE =
  "Impossible d'envoyer l'e-mail pour le moment. Réessaie dans quelques instants.";

/**
 * Reads only the response's status and its own `error` string field (if
 * present) — never any other field, so a technical cause/stack trace the
 * API might ever add elsewhere can't leak into the UI through this path.
 */
export async function interpretForgotPasswordResponse(response: Response): Promise<ForgotPasswordOutcome> {
  if (response.status === 429) {
    const data = await response.json().catch(() => ({}) as Record<string, unknown>);
    const message = typeof data?.error === 'string' ? data.error : RATE_LIMIT_FALLBACK_MESSAGE;
    return { kind: 'rate_limited', message };
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}) as Record<string, unknown>);
    const message = typeof data?.error === 'string' ? data.error : GENERIC_FAILURE_FALLBACK_MESSAGE;
    return { kind: 'failed', message };
  }

  return { kind: 'submitted' };
}
