/**
 * Proves the login brute-force fix: the credentials callback route
 * (src/app/api/auth/[...nextauth]/route.ts) now calls
 * rateLimiter.checkLogin(email) — read from the request body — before
 * ever calling NextAuth's handlers.POST(). Previously this lived inside
 * src/auth.ts's Credentials.authorize(), but authorize() returning null
 * on a block just makes NextAuth treat it as "invalid credentials" (a
 * plain 200), so a caller could never distinguish "wrong password" from
 * "rate limited" and never got a real 429/Retry-After to back off on.
 * Checking in the route, before handlers.POST(), lets a limit violation
 * short-circuit with a real HTTP 429.
 *
 * Neither src/auth.ts nor the route file can be imported live in this
 * Vitest setup: next-auth's module graph pulls in next/server, which
 * fails to resolve here (same pre-existing environment issue documented
 * on subscription-plan-change-security.test.ts). So this combines:
 *  1. A real behavioral test of RateLimiterService.checkLogin() itself
 *     (the exact mechanism the route calls), same convention as
 *     ratelimit-stripe.test.ts for the Stripe routes.
 *  2. A source-level check that the route actually calls it for the
 *     credentials callback, before delegating to handlers.POST(), and
 *     responds 429 (not a silent pass-through) when blocked.
 *  3. A source-level check that src/auth.ts no longer also calls it —
 *     otherwise every attempt would be counted twice against the same
 *     Upstash/in-memory key.
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

describe('[...nextauth] route source — checkLogin is wired in front of handlers.POST()', () => {
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/auth/[...nextauth]/route.ts'),
    'utf-8'
  );

  it('calls rateLimiter.checkLogin() for the credentials callback, before delegating to handlers.POST()', () => {
    const postStart = routeSource.indexOf('export async function POST(');
    expect(postStart).toBeGreaterThan(-1);

    const pathCheckIndex = routeSource.indexOf(
      "'/api/auth/callback/credentials'",
      postStart
    );
    const rateLimitCallIndex = routeSource.indexOf('rateLimiter.checkLogin(', postStart);
    const handlersPostIndex = routeSource.lastIndexOf('handlers.POST(request)');

    expect(pathCheckIndex).toBeGreaterThan(postStart);
    expect(rateLimitCallIndex).toBeGreaterThan(pathCheckIndex);
    expect(handlersPostIndex).toBeGreaterThan(rateLimitCallIndex);
  });

  it('reads the email via request.clone().formData(), so NextAuth can still read the body afterward', () => {
    expect(routeSource).toContain('request.clone().formData()');
  });

  it('responds with a real HTTP 429 and rate-limit headers when blocked, not a silent pass-through', () => {
    const rateLimitCallIndex = routeSource.indexOf('rateLimiter.checkLogin(');
    const blockBranch = routeSource.slice(
      rateLimitCallIndex,
      routeSource.indexOf('handlers.POST(request)')
    );

    expect(blockBranch).toContain('!rateLimitResult.success');
    expect(blockBranch).toContain('status: 429');
    expect(blockBranch).toContain("'Retry-After'");
    expect(blockBranch).toContain("'X-RateLimit-Limit'");
    expect(blockBranch).toContain("'X-RateLimit-Remaining'");
    expect(blockBranch).toContain("'X-RateLimit-Reset'");
    expect(blockBranch).toContain('Too many login attempts. Please try again later.');
  });
});

describe('auth.ts source — no longer double-checks the login rate limit', () => {
  it('does not call rateLimiter.checkLogin() inside authorize() (would double-count every attempt)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/auth.ts'), 'utf-8');
    expect(source).not.toContain('rateLimiter.checkLogin(');
    expect(source).not.toContain("from '@/lib/ratelimit'");
  });
});
