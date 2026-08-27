/**
 * Proves the payment-bypass fix: a client could previously POST
 * /api/subscriptions with an arbitrary planId and get upgraded to any paid
 * plan with zero Stripe involvement (SubscriptionService.changePlan wrote
 * subscription.planId directly). Both the route's POST handler and the
 * service method have been removed — this asserts neither exists anymore,
 * so the only way to change plans is through Stripe Checkout (upgrade) or
 * the Stripe customer portal + webhooks (downgrade/cancel).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SubscriptionService } from '@/services/SubscriptionService';

// The route file is checked at the source level rather than imported live:
// importing it pulls in next-auth -> next/server, which fails to resolve
// in this Vitest/Node setup for reasons unrelated to this fix (a
// pre-existing environment issue, reproducible even for an otherwise
// untouched route file). Reading the route's exports is exactly what
// determines Next.js's real runtime behavior (an HTTP method with no
// matching export gets Next's standard 405), so this still verifies the
// actual guarantee.
const routeSource = readFileSync(
  join(__dirname, '../../app/api/subscriptions/route.ts'),
  'utf-8'
);

describe('Payment bypass removed — plan changes require Stripe', () => {
  it('the /api/subscriptions route no longer exports a POST handler (Next.js returns 405 for a missing method export)', () => {
    expect(routeSource).not.toMatch(/export\s+(async\s+)?function\s+POST/);
    // GET (read-only: current subscription + available plans) must still work.
    expect(routeSource).toMatch(/export\s+async\s+function\s+GET/);
  });

  it('SubscriptionService no longer exposes a direct changePlan() method', () => {
    expect((SubscriptionService as any).changePlan).toBeUndefined();
  });
});
