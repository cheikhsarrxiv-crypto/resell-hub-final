/**
 * Confirms /forgot-password and /reset-password were added to
 * middleware.ts's public-route allowlist (reachable with no session,
 * since a locked-out user can't be logged in to reach them), and that
 * the rest of the gate (protected-route 401/redirect logic) is
 * untouched. src/middleware.ts imports next-auth (same next/server
 * resolution issue as src/auth.ts — see auth-session-invalidation.test.ts),
 * so this is a source-level check, consistent with that file's approach.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const source = fs.readFileSync(path.join(process.cwd(), 'src/middleware.ts'), 'utf-8');

describe('middleware.ts — password reset routes are public', () => {
  const publicBlockStart = source.indexOf('if (\n');
  const publicBlockEnd = source.indexOf(') {', publicBlockStart);
  const publicBlock = source.slice(publicBlockStart, publicBlockEnd);

  it("lists '/forgot-password' and '/reset-password' as public page routes", () => {
    expect(publicBlock).toContain("pathname === '/forgot-password'");
    expect(publicBlock).toContain("pathname === '/reset-password'");
  });

  it("the new API routes fall under the existing '/api/auth' prefix already treated as public (no change needed there)", () => {
    expect(publicBlock).toContain("pathname.startsWith('/api/auth')");
  });

  it('protected-route enforcement (401 for API, redirect to /login for pages) is unchanged', () => {
    const protectedBlock = source.slice(source.indexOf('// Protected routes'));
    expect(protectedBlock).toContain("if (!session?.user?.id)");
    expect(protectedBlock).toContain("status: 401");
    expect(protectedBlock).toContain("new URL('/login', request.url)");
  });
});
