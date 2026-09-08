/**
 * Proves the password reset rate limits: /api/auth/forgot-password and
 * /api/auth/reset-password call these three RateLimiterService methods,
 * each backed by the shared DEFAULT_CONFIGS-driven limiter — no second
 * rate-limiting system. Matches this repo's existing convention of
 * testing the tier directly (see ratelimit-stripe.test.ts,
 * auth-login-ratelimit.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { RateLimiterService } from '@/lib/ratelimit';

describe('RateLimiterService.checkForgotPasswordIP — 5/hour per IP', () => {
  it('allows up to 5 requests, then blocks the 6th', async () => {
    const limiter = new RateLimiterService();
    const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}-${Date.now()}`;

    for (let i = 0; i < 5; i++) {
      const result = await limiter.checkForgotPasswordIP(ip);
      expect(result.success).toBe(true);
    }

    const blocked = await limiter.checkForgotPasswordIP(ip);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('tracks different IPs independently', async () => {
    const limiter = new RateLimiterService();
    const ipA = `forgot-ip-a-${Date.now()}`;
    const ipB = `forgot-ip-b-${Date.now()}`;

    for (let i = 0; i < 5; i++) await limiter.checkForgotPasswordIP(ipA);
    const blockedA = await limiter.checkForgotPasswordIP(ipA);
    expect(blockedA.success).toBe(false);

    const resultB = await limiter.checkForgotPasswordIP(ipB);
    expect(resultB.success).toBe(true);
  });
});

describe('RateLimiterService.checkForgotPasswordEmail — 3/hour per email', () => {
  it('allows up to 3 requests, then blocks the 4th', async () => {
    const limiter = new RateLimiterService();
    const email = `forgot-email-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

    for (let i = 0; i < 3; i++) {
      const result = await limiter.checkForgotPasswordEmail(email);
      expect(result.success).toBe(true);
    }

    const blocked = await limiter.checkForgotPasswordEmail(email);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('tracks different emails independently', async () => {
    const limiter = new RateLimiterService();
    const emailA = `forgot-email-a-${Date.now()}@example.com`;
    const emailB = `forgot-email-b-${Date.now()}@example.com`;

    for (let i = 0; i < 3; i++) await limiter.checkForgotPasswordEmail(emailA);
    const blockedA = await limiter.checkForgotPasswordEmail(emailA);
    expect(blockedA.success).toBe(false);

    const resultB = await limiter.checkForgotPasswordEmail(emailB);
    expect(resultB.success).toBe(true);
  });
});

describe('RateLimiterService.checkResetPasswordIP — 10/hour per IP', () => {
  it('allows up to 10 attempts, then blocks the 11th', async () => {
    const limiter = new RateLimiterService();
    const ip = `reset-ip-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    for (let i = 0; i < 10; i++) {
      const result = await limiter.checkResetPasswordIP(ip);
      expect(result.success).toBe(true);
    }

    const blocked = await limiter.checkResetPasswordIP(ip);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('tracks different IPs independently', async () => {
    const limiter = new RateLimiterService();
    const ipA = `reset-ip-a-${Date.now()}`;
    const ipB = `reset-ip-b-${Date.now()}`;

    for (let i = 0; i < 10; i++) await limiter.checkResetPasswordIP(ipA);
    const blockedA = await limiter.checkResetPasswordIP(ipA);
    expect(blockedA.success).toBe(false);

    const resultB = await limiter.checkResetPasswordIP(ipB);
    expect(resultB.success).toBe(true);
  });
});
