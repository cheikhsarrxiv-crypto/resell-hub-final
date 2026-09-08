/**
 * UI wiring checks for the password-reset flow's three pages
 * (/login, /forgot-password, /reset-password). These .tsx files can't be
 * imported directly under this Vitest config — tsconfig.json sets
 * "jsx": "preserve" and esbuild refuses to parse a .tsx file under that
 * setting (confirmed by attempting the import before writing this file;
 * same conclusion already reached for MarketplaceConnectionsCard.test.ts).
 * So these are source-level checks against the real file content,
 * matching that established convention.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const loginSource = fs.readFileSync(path.join(process.cwd(), 'src/app/login/page.tsx'), 'utf-8');
const forgotSource = fs.readFileSync(path.join(process.cwd(), 'src/app/forgot-password/page.tsx'), 'utf-8');
const resetSource = fs.readFileSync(path.join(process.cwd(), 'src/app/reset-password/page.tsx'), 'utf-8');

describe('/login — forgot-password link added, no regression', () => {
  it('links to /forgot-password', () => {
    expect(loginSource).toContain('href="/forgot-password"');
    expect(loginSource).toContain('Forgot password?');
  });

  it('still calls next-auth signIn() with credentials (unchanged submit logic)', () => {
    expect(loginSource).toContain("signIn('credentials'");
    expect(loginSource).toContain('router.push(\'/dashboard\')');
  });

  it('still renders the demo-credentials hint box (not removed)', () => {
    expect(loginSource).toContain('Demo credentials:');
    expect(loginSource).toContain('demo@reselling.local');
  });

  it('still offers the signup link (not removed)', () => {
    expect(loginSource).toContain('href="/signup"');
  });
});

describe('/forgot-password — requests a reset link', () => {
  it('posts to /api/auth/forgot-password with the entered email', () => {
    expect(forgotSource).toContain("fetch('/api/auth/forgot-password'");
    expect(forgotSource).toContain('JSON.stringify({ email })');
  });

  it('shows the same generic confirmation regardless of API response content (never branches on account existence)', () => {
    const submittedBranch = forgotSource.slice(forgotSource.indexOf('submitted ?'));
    expect(submittedBranch).toContain('If an account exists for');
  });

  it('surfaces a 429 (rate limited) as a distinct error rather than the generic success state', () => {
    expect(forgotSource).toContain('response.status === 429');
  });

  it('links back to /login', () => {
    expect(forgotSource).toContain('href="/login"');
  });
});

describe('/reset-password — submits new password with token + userId', () => {
  it('reads token and userId from the URL search params', () => {
    expect(resetSource).toContain("searchParams.get('token')");
    expect(resetSource).toContain("searchParams.get('userId')");
  });

  it('posts token, password and confirmPassword to /api/auth/reset-password?userId=...', () => {
    expect(resetSource).toContain('/api/auth/reset-password?userId=');
    expect(resetSource).toContain('JSON.stringify({ token, password, confirmPassword })');
  });

  it('validates password === confirmPassword client-side before submitting', () => {
    expect(resetSource).toContain('password !== confirmPassword');
  });

  it('shows an invalid-link state when token or userId is missing, with a link to request a new one', () => {
    expect(resetSource).toContain('linkInvalid');
    expect(resetSource).toContain('!token || !userId');
    expect(resetSource).toContain('href="/forgot-password"');
  });

  it('shows a success state with a link to /login on success', () => {
    expect(resetSource).toContain("state === 'success'");
    expect(resetSource).toContain('href="/login"');
  });

  it('wraps the search-params-reading component in Suspense (mirrors /verify-email)', () => {
    expect(resetSource).toContain('<Suspense');
    expect(resetSource).toContain('useSearchParams');
  });
});
