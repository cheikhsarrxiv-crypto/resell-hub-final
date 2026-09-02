/**
 * Proves the login brute-force fix: src/auth.ts's Credentials.authorize()
 * now calls rateLimiter.checkLogin(email) before checking the password.
 * Previously only signup was rate-limited (checkSignup) — login had none
 * at all, so an attacker could try unlimited passwords against one email.
 *
 * src/auth.ts cannot be imported live in this Vitest setup: next-auth's
 * module graph pulls in next/server, which fails to resolve here (same
 * pre-existing environment issue documented on
 * subscription-plan-change-security.test.ts). So this combines:
 *  1. A real behavioral test of RateLimiterService.checkLogin() itself
 *     (the exact mechanism auth.ts calls), same convention as
 *     ratelimit-stripe.test.ts for the Stripe routes.
 *  2. A source-level check that auth.ts actually calls it inside
 *     authorize(), before the password comparison — so the fix is wired,
 *     not just that the underlying limiter method happens to work.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { RateLimiterService } from '@/lib/ratelimit';

describe('RateLimiterService.checkLogin — backing auth.ts authorize()', () => {
  it('allows up to the configured limit, then blocks further attempts', async () => {
    const limiter = new RateLimiterService();
    const email = `login-ratelimit-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

    let result;
    for (let i = 0; i < 5; i++) {
      result = await limiter.checkLogin(email);
      expect(result.success).toBe(true);
    }

    const blocked = await limiter.checkLogin(email);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('tracks different emails independently', async () => {
    const limiter = new RateLimiterService();
    const emailA = `login-ratelimit-a-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const emailB = `login-ratelimit-b-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

    for (let i = 0; i < 5; i++) {
      await limiter.checkLogin(emailA);
    }
    const blockedA = await limiter.checkLogin(emailA);
    expect(blockedA.success).toBe(false);

    const resultB = await limiter.checkLogin(emailB);
    expect(resultB.success).toBe(true);
  });
});

describe('auth.ts source — checkLogin is actually wired into authorize()', () => {
  it('calls rateLimiter.checkLogin() inside authorize(), before the bcrypt password comparison', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/auth.ts'), 'utf-8');

    const authorizeStart = source.indexOf('async authorize(credentials)');
    expect(authorizeStart).toBeGreaterThan(-1);

    const rateLimitCallIndex = source.indexOf('rateLimiter.checkLogin(', authorizeStart);
    const passwordCompareIndex = source.indexOf('bcrypt.compare(', authorizeStart);

    expect(rateLimitCallIndex).toBeGreaterThan(authorizeStart);
    expect(passwordCompareIndex).toBeGreaterThan(authorizeStart);
    expect(rateLimitCallIndex).toBeLessThan(passwordCompareIndex);

    // On block, authorize() must return null like every other rejection
    // path here — never a distinct message that would tell an attacker
    // "the password would have been checked but you're rate-limited"
    // vs. "the password was wrong".
    const betweenCheckAndReturn = source.slice(
      rateLimitCallIndex,
      source.indexOf('return null', rateLimitCallIndex) + 'return null'.length
    );
    expect(betweenCheckAndReturn).toContain('!rateLimitResult.success');
  });
});
