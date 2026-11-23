/**
 * B.11.1-R — durable, atomic, multi-instance single-use of an OAuth state.
 *
 * B.11.1 "consumed" the state only by telling the browser to delete its cookie. That is not a guarantee: a copy of
 * the cookie (second tab, parallel request, proxy, exfiltrated value) is still valid for its 10 minutes and the
 * server kept no memory, so the same callback could run several times (several code exchanges and
 * MarketplaceConnection writes) — shown by oauth-state-replay.test.ts against the pre-fix route.
 *
 * Now the first callback that passes the cookie verification INSERTS a row in the existing WebhookLog idempotency
 * ledger (schema: `@@unique([workspaceId, marketplace, eventId])`), BEFORE any code exchange:
 *   workspaceId = the verified workspace that started the flow, marketplace = 'oauth_state',
 *   eventId = '<marketplace>:<sha256(state)>'  (the state itself is never stored).
 * A unique index makes the insert atomic across concurrent requests, instances and restarts: exactly one caller
 * gets the row, every other one gets P2002 -> 'replay'. This is the same precedent as the Stripe webhook dedup
 * (`marketplace: 'stripe'`) and needs no migration. Any OTHER database error is thrown (fail closed: the caller
 * must not exchange the code when consumption could not be recorded).
 */
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export const OAUTH_STATE_LEDGER_MARKETPLACE = 'oauth_state';

export type OAuthStateConsumption = 'consumed' | 'replay';

export function oauthStateLedgerEventId(marketplace: string, state: string): string {
  return `${marketplace.toLowerCase()}:${crypto.createHash('sha256').update(state).digest('hex')}`;
}

export async function consumeOAuthState(input: { workspaceId: string; marketplace: string; state: string }): Promise<OAuthStateConsumption> {
  try {
    await prisma.webhookLog.create({
      data: {
        workspaceId: input.workspaceId,
        marketplace: OAUTH_STATE_LEDGER_MARKETPLACE,
        eventId: oauthStateLedgerEventId(input.marketplace, input.state),
        eventType: 'oauth_state.consumed',
        payload: '{}',
        status: 'processed',
        processedAt: new Date(),
      },
    });
    return 'consumed';
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'P2002') return 'replay';
    throw error;
  }
}
