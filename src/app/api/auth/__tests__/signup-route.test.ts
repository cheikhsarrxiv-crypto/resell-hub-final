/**
 * Audit fix (P0) — POST /api/auth/signup must never silently treat a
 * failed verification email as a sent one, and must never turn that
 * failure into a 500 or a rolled-back account.
 *
 * Source-level check, same convention as
 * src/app/api/ai/agent/usage/__tests__/route.test.ts (see its own header
 * comment): src/app/api/auth/signup/route.ts imports `@/lib/admin`,
 * which itself imports `@/auth` — that chain fails to resolve directly
 * under this project's Vitest setup, so the route's actual HTTP behavior
 * for this specific fix is proven by its real, DB-backed caller instead
 * (see EmailVerificationService.createVerificationToken's own tests in
 * email-verification.test.ts for the "token kept, success:false, no
 * leaked secret" behavior this route now relies on). This file only
 * proves the route's own source wires that result in correctly: inspects
 * it, logs on failure, and never gates the 201 response on it.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/auth/signup/route.ts'),
  'utf-8'
);

describe('/api/auth/signup route — honest, non-blocking verification-email failure handling', () => {
  it('inspects createVerificationToken\'s own result instead of ignoring it', () => {
    expect(routeSource).toMatch(
      /const\s+verificationResult\s*=\s*await\s+EmailVerificationService\.createVerificationToken/
    );
    expect(routeSource).toContain('if (!verificationResult.success)');
  });

  it('logs the failure clearly, without leaking the error into the HTTP response', () => {
    const ifIndex = routeSource.indexOf('if (!verificationResult.success)');
    expect(ifIndex).toBeGreaterThan(-1);
    const block = routeSource.slice(ifIndex, ifIndex + 400);
    expect(block).toContain('console.error');
    expect(block).toContain('verification email could not be sent');
  });

  it('the success response (201) is built unconditionally after the check — a failed email never turns into a 500 or blocks account creation', () => {
    const ifIndex = routeSource.indexOf('if (!verificationResult.success)');
    const responseIndex = routeSource.indexOf('NextResponse.json(', ifIndex);
    const statusIndex = routeSource.indexOf('{ status: 201 }', ifIndex);

    expect(ifIndex).toBeGreaterThan(-1);
    expect(responseIndex).toBeGreaterThan(ifIndex);
    expect(statusIndex).toBeGreaterThan(ifIndex);
    // The 201 response is not nested inside the failure branch: the
    // closing of that branch happens before the response is built.
    const closingBraceIndex = routeSource.indexOf('}', ifIndex + 'if (!verificationResult.success) {'.length);
    expect(closingBraceIndex).toBeLessThan(responseIndex);
  });

  it('never returns a 500 solely because of a verification-email failure (no early return/throw inside the failure branch)', () => {
    const ifIndex = routeSource.indexOf('if (!verificationResult.success)');
    const closingBraceIndex = routeSource.indexOf('}', ifIndex);
    const block = routeSource.slice(ifIndex, closingBraceIndex);
    expect(block).not.toContain('return');
    expect(block).not.toContain('throw');
    expect(block).not.toContain('500');
  });
});
