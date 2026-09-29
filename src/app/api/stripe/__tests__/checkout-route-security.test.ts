/**
 * Source-level checks for /api/stripe/checkout/route.ts — same convention
 * as agent-route-security.test.ts (this route imports next/server + @/auth
 * via getAuthSession, which fails to resolve directly in this Vitest
 * setup, so wiring is checked at the source level; real
 * price-selection/refusal behavior is covered behaviorally in
 * stripe-checkout-billing-period.test.ts).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/stripe/checkout/route.ts'),
  'utf-8'
);

describe('/api/stripe/checkout route — D-3 billingPeriod wiring', () => {
  it('validates the body with stripeCheckoutSchema before calling StripeService', () => {
    const validateIndex = routeSource.indexOf('stripeCheckoutSchema.safeParse(body)');
    const serviceCallIndex = routeSource.indexOf('StripeService.createCheckoutSession(');
    expect(validateIndex).toBeGreaterThan(-1);
    expect(serviceCallIndex).toBeGreaterThan(validateIndex);
  });

  it('responds 400 when validation fails, without ever reaching StripeService', () => {
    const validateIndex = routeSource.indexOf('stripeCheckoutSchema.safeParse(body)');
    const nextFewLines = routeSource.slice(validateIndex, validateIndex + 300);
    expect(nextFewLines).toContain('status: 400');
  });

  it('passes the parsed billingPeriod through to StripeService.createCheckoutSession — never a raw, unvalidated request field', () => {
    expect(routeSource).toContain('const { planId, billingPeriod } = parsed.data');
    expect(routeSource).toContain('billingPeriod,');
  });

  it('never reads a price or priceId field from the request body — only planId/billingPeriod', () => {
    expect(routeSource).not.toMatch(/\bpriceId\b/);
    expect(routeSource).not.toMatch(/body\.price\b/);
  });
});
