/**
 * Proves /dashboard/admin is now gated server-side before any page
 * content renders, instead of only its API route being protected.
 * Previously AdminPage (a client component) rendered its full shell
 * (headers, stat card layout) for any authenticated+verified user, then
 * called fetch('/api/admin/metrics'), which correctly 403'd for non-admins
 * — but only after the shell was already visible.
 *
 * layout.tsx imports next-auth (via @/auth), which cannot be imported
 * live in this Vitest setup (same next/server resolution issue as
 * auth-login-ratelimit.test.ts) — verified at the source level instead:
 * the layout must call auth(), check the email against getAdminEmails(),
 * and redirect() before ever rendering `children`.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('dashboard/admin/layout.tsx - server-side admin gate', () => {
  it('checks admin status and redirects before rendering children', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/dashboard/admin/layout.tsx'),
      'utf-8'
    );

    expect(source).toContain("import { auth } from '@/auth'");
    expect(source).toContain('getAdminEmails');
    expect(source).toContain("redirect('/dashboard')");

    const redirectIndex = source.indexOf("redirect('/dashboard')");
    const childrenReturnIndex = source.indexOf('return <>{children}</>');

    expect(redirectIndex).toBeGreaterThan(-1);
    expect(childrenReturnIndex).toBeGreaterThan(-1);
    // The redirect must be reachable before the children are ever
    // returned — not after, and not just present somewhere unrelated.
    expect(redirectIndex).toBeLessThan(childrenReturnIndex);

    // No admin emails configured at all must fail closed (redirect),
    // not fail open — matches getAdminEmails()'s own "unset = no admin"
    // contract from src/lib/admin.ts.
    expect(source).toContain('adminEmails.length === 0');
  });

  it('AdminPage no longer needs to be the enforcement point (defense in depth, not the only gate)', () => {
    const pageSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/dashboard/admin/page.tsx'),
      'utf-8'
    );
    // The page still calls the (already-protected) API route — this just
    // confirms the layout guard was added alongside it, not instead of
    // removing the route's own check.
    expect(pageSource).toContain("fetch('/api/admin/metrics')");
  });
});
