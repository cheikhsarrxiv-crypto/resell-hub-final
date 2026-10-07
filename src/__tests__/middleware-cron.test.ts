/**
 * CORRECTIF CRON — MIDDLEWARE UNIQUEMENT.
 *
 * Vercel Cron requests to /api/cron/sync-orders and /api/cron/sync-listings
 * carry no NextAuth session cookie at all — they authenticate via
 * CRON_SECRET inside each route itself (src/lib/cronAuth.ts's
 * verifyCronSecret, already unit-tested end-to-end in
 * src/__tests__/marketplace/cron-sync.test.ts). Before this fix,
 * middleware.ts's blanket session check ran BEFORE the request ever
 * reached the route, so a valid CRON_SECRET never mattered: the request
 * was rejected with 401 at the middleware layer first.
 *
 * middleware.ts imports next-auth, which fails to resolve directly in this
 * Vitest setup (same Edge Runtime issue documented in
 * middleware-password-reset.test.ts) — so this is a source-level check,
 * same convention as that file. The actual CRON_SECRET accept/reject
 * behavior (bon secret / mauvais secret / absence de secret) is already
 * covered behaviorally, at the real route level, by cron-sync.test.ts's
 * own 'verifyCronSecret' and 'Cron routes - auth' describe blocks — this
 * file never re-asserts that, only that the request now reaches the route
 * at all, and that nothing else in the gate changed.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const source = fs.readFileSync(path.join(process.cwd(), 'src/middleware.ts'), 'utf-8');

describe('middleware.ts — /api/cron is public (CRON_SECRET enforced by the route itself)', () => {
  const publicBlockStart = source.indexOf('if (\n');
  const publicBlockEnd = source.indexOf(') {', publicBlockStart);
  const publicBlock = source.slice(publicBlockStart, publicBlockEnd);

  it("lists '/api/cron' (startsWith) as a public route — reachable with no NextAuth session", () => {
    expect(publicBlock).toContain("pathname.startsWith('/api/cron')");
  });

  it('does NOT exempt all of /api — only /api/cron, /api/auth, and /api/email/verify are public', () => {
    // A blanket `pathname.startsWith('/api')` (no suffix) would silently
    // disable auth for every API route, not just the cron ones — this
    // must never appear in the public block.
    expect(publicBlock).not.toMatch(/pathname\.startsWith\('\/api'\)/);
    expect(publicBlock).toContain("pathname.startsWith('/api/auth')");
    expect(publicBlock).toContain("pathname === '/api/email/verify'");
  });

  it('the session lookup (await auth()) still runs unconditionally before the public-route check — NextAuth wiring untouched', () => {
    const authCallIndex = source.indexOf('await auth()');
    expect(authCallIndex).toBeGreaterThan(-1);
    expect(authCallIndex).toBeLessThan(publicBlockStart);
  });

  it('protected-route enforcement (401 for other API routes, redirect to /login for pages) is unchanged', () => {
    const protectedBlock = source.slice(source.indexOf('// Protected routes'));
    expect(protectedBlock).toContain('if (!session?.user?.id)');
    expect(protectedBlock).toContain("pathname.startsWith('/api')");
    expect(protectedBlock).toContain('status: 401');
    expect(protectedBlock).toContain("new URL('/login', request.url)");
  });

  it('a normal, non-cron API route is never added to the public allowlist by this fix', () => {
    expect(publicBlock).not.toContain("pathname.startsWith('/api/products')");
    expect(publicBlock).not.toContain("pathname.startsWith('/api/orders')");
    expect(publicBlock).not.toContain("pathname.startsWith('/api/fulfillment')");
    expect(publicBlock).not.toContain("pathname.startsWith('/api/ai')");
  });

  it('the matcher still covers /api/cron (no change needed there — only _next/static, _next/image, favicon.ico are excluded)', () => {
    const matcherBlock = source.slice(source.indexOf('export const config'));
    expect(matcherBlock).toContain('_next/static|_next/image|favicon.ico');
  });
});
