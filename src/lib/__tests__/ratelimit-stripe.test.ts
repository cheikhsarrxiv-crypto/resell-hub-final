/**
 * Proves the Stripe rate-limiting fix: /api/stripe/checkout and
 * /api/stripe/portal now call rateLimiter.checkStripe() before doing any
 * Stripe work. This tests the tier itself (the exact mechanism both
 * routes call) directly, matching this repo's existing convention of
 * testing services/business logic directly rather than through HTTP route
 * mocking.
 */
import { describe, it, expect } from 'vitest';
import { RateLimiterService } from '@/lib/ratelimit';

describe('RateLimiterService.checkStripe — backing /api/stripe/checkout and /api/stripe/portal', () => {
  it('allows requests up to the configured limit, then blocks', async () => {
    const limiter = new RateLimiterService();
    const identifier = `stripe-ratelimit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let result;
    for (let i = 0; i < 50; i++) {
      result = await limiter.checkStripe(identifier);
      expect(result.success).toBe(true);
    }

    const blocked = await limiter.checkStripe(identifier);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('tracks different identifiers (users) independently', async () => {
    const limiter = new RateLimiterService();
    const userA = `stripe-ratelimit-a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userB = `stripe-ratelimit-b-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Exhaust user A's quota.
    for (let i = 0; i < 50; i++) {
      await limiter.checkStripe(userA);
    }
    const blockedA = await limiter.checkStripe(userA);
    expect(blockedA.success).toBe(false);

    // User B is unaffected.
    const resultB = await limiter.checkStripe(userB);
    expect(resultB.success).toBe(true);
  });
});
