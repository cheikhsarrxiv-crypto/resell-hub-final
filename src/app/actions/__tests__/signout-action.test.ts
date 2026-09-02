/**
 * Proves the sign-out fix: both sign-out buttons now submit to the
 * signOutAction Server Action (next-auth's signOut(), which sets
 * skipCSRFCheck internally) instead of directly hitting
 * /api/auth/signout.
 *
 * That mattered because @auth/core's route handler validates CSRF on
 * the "signout" action (AuthInternal -> validateCSRF, verified directly
 * in node_modules/@auth/core/lib/index.js) for any POST that isn't the
 * signOut() Server Action — a plain <form action="/api/auth/signout"
 * method="POST"> with no csrfToken field (as DashboardLayout.tsx used to
 * have) is rejected. src/app/workspace/page.tsx had it worse: a plain
 * GET <Link>, which doesn't even hit the POST-only signout action at all.
 *
 * Source-level check (not a live import) for the same next-auth/
 * next-server Vitest resolution issue as the other auth.ts-adjacent tests.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf-8');
}

describe('Sign-out uses the signOut() Server Action, not a raw /api/auth/signout request', () => {
  it('actions/auth.ts wraps next-auth signOut()', () => {
    const source = read('src/app/actions/auth.ts');
    expect(source).toContain("'use server'");
    expect(source).toContain("import { signOut } from '@/auth'");
    expect(source).toContain('export async function signOutAction');
    expect(source).toContain('await signOut(');
  });

  it('DashboardLayout no longer posts directly to /api/auth/signout', () => {
    const source = read('src/components/Layout/DashboardLayout.tsx');
    expect(source).toContain('signOutAction');
    expect(source).not.toContain('/api/auth/signout');
  });

  it('workspace/page.tsx no longer links (GET) to /api/auth/signout', () => {
    const source = read('src/app/workspace/page.tsx');
    expect(source).toContain('signOutAction');
    expect(source).not.toContain('/api/auth/signout');
  });
});

describe('/workspace/[slug] sidebar no longer links to nonexistent routes', () => {
  it('passes baseUrl="/dashboard" like the working /dashboard layout does', () => {
    const workspaceLayout = read('src/app/workspace/[slug]/layout.tsx');
    const dashboardLayout = read('src/app/dashboard/layout.tsx');

    expect(workspaceLayout).toContain('baseUrl="/dashboard"');
    expect(dashboardLayout).toContain('baseUrl="/dashboard"');
  });
});
