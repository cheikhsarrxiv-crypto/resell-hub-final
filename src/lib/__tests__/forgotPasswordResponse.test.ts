/**
 * Pure-logic tests for interpretForgotPasswordResponse — no jsdom/
 * @testing-library needed (not installed in this project), a real Web
 * Response object is enough. Covers the actual bug fixed here: before
 * this existed, forgot-password/page.tsx only branched on status===429
 * and treated every other status, including a real 500, as success.
 */
import { describe, it, expect } from 'vitest';
import { interpretForgotPasswordResponse } from '@/lib/forgotPasswordResponse';

function makeResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe('interpretForgotPasswordResponse', () => {
  it('a normal 200 (email sent, or account unregistered) is "submitted"', async () => {
    const outcome = await interpretForgotPasswordResponse(
      makeResponse(200, { message: "If an account exists with this email address, we've sent a password reset link." })
    );
    expect(outcome).toEqual({ kind: 'submitted' });
  });

  it('429 is "rate_limited", using the API\'s own error message', async () => {
    const outcome = await interpretForgotPasswordResponse(makeResponse(429, { error: 'Too many requests. Please try again later.' }));
    expect(outcome).toEqual({ kind: 'rate_limited', message: 'Too many requests. Please try again later.' });
  });

  it('429 with a malformed/missing body falls back to a fixed French message, never throws', async () => {
    const outcome = await interpretForgotPasswordResponse(new Response('not json', { status: 429 }));
    expect(outcome.kind).toBe('rate_limited');
    expect((outcome as { message: string }).message).toBe('Trop de tentatives. Réessaie plus tard.');
  });

  it('a real server failure (500) is "failed", never "submitted" — the core fix', async () => {
    const outcome = await interpretForgotPasswordResponse(
      makeResponse(500, { error: "Impossible d'envoyer l'e-mail pour le moment. Réessaie dans quelques instants." })
    );
    expect(outcome.kind).toBe('failed');
    expect(outcome.kind).not.toBe('submitted');
    expect((outcome as { message: string }).message).toBe("Impossible d'envoyer l'e-mail pour le moment. Réessaie dans quelques instants.");
  });

  it('a 500 with a malformed/missing body falls back to a fixed generic message, never throws, never "submitted"', async () => {
    const outcome = await interpretForgotPasswordResponse(new Response('not json', { status: 500 }));
    expect(outcome.kind).toBe('failed');
    expect((outcome as { message: string }).message).toBe("Impossible d'envoyer l'e-mail pour le moment. Réessaie dans quelques instants.");
  });

  it('any other non-ok status (e.g. 503) is also "failed", never "submitted"', async () => {
    const outcome = await interpretForgotPasswordResponse(makeResponse(503, {}));
    expect(outcome.kind).toBe('failed');
  });

  it('never surfaces a field other than "error" from the response body', async () => {
    const outcome = await interpretForgotPasswordResponse(
      makeResponse(500, { error: 'generic', stack: 'SECRET STACK TRACE', token: 'deadbeef' })
    );
    expect((outcome as { message: string }).message).toBe('generic');
    expect(JSON.stringify(outcome)).not.toContain('SECRET STACK TRACE');
    expect(JSON.stringify(outcome)).not.toContain('deadbeef');
  });
});
