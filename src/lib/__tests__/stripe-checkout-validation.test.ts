/**
 * D-3 fix: stripeCheckoutSchema is the strict server-side gate on
 * POST /api/stripe/checkout's body — billingPeriod must be exactly
 * 'monthly' or 'annual', nothing else, and no price value is ever
 * accepted from the client at all (the schema has no such field).
 */
import { describe, it, expect } from 'vitest';
import { stripeCheckoutSchema } from '@/lib/validations';

describe('stripeCheckoutSchema', () => {
  it('accepts a valid monthly request', () => {
    const result = stripeCheckoutSchema.safeParse({ planId: 'plan-1', billingPeriod: 'monthly' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid annual request', () => {
    const result = stripeCheckoutSchema.safeParse({ planId: 'plan-1', billingPeriod: 'annual' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing billingPeriod', () => {
    const result = stripeCheckoutSchema.safeParse({ planId: 'plan-1' });
    expect(result.success).toBe(false);
  });

  it('rejects an arbitrary billingPeriod string, never silently defaulting to monthly', () => {
    const result = stripeCheckoutSchema.safeParse({ planId: 'plan-1', billingPeriod: 'yearly' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing planId', () => {
    const result = stripeCheckoutSchema.safeParse({ billingPeriod: 'monthly' });
    expect(result.success).toBe(false);
  });

  it('never has a price/priceId field at all — a client-supplied price can never reach this schema', () => {
    const shape = stripeCheckoutSchema.shape as Record<string, unknown>;
    expect(Object.keys(shape).sort()).toEqual(['billingPeriod', 'planId']);
  });

  it('a client-supplied price/priceId field is silently stripped, never passed through (Zod default strip behavior)', () => {
    const result = stripeCheckoutSchema.safeParse({
      planId: 'plan-1',
      billingPeriod: 'monthly',
      price: 'price_attacker_supplied',
      stripePriceId: 'price_attacker_supplied',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ planId: 'plan-1', billingPeriod: 'monthly' });
    }
  });
});
