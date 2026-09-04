/**
 * Proves the fix: sendViaResend() now surfaces Resend's real
 * ErrorResponse ({message, statusCode, name}) instead of the generic
 * 'Resend error' string it silently fell back to before (because
 * Resend throws a plain object, not an Error instance, so the old
 * `error instanceof Error` check always failed for it).
 *
 * EmailService.provider is a static class field evaluated once at
 * module load from process.env.EMAIL_PROVIDER, so each test sets the
 * env vars first, then vi.resetModules() + a fresh dynamic import to
 * get a version of the module that actually picked them up.
 *
 * The 'resend' package itself is mocked (no real API key/network call)
 * — only EmailService's own error-handling logic is under test here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock factories are hoisted above imports/const declarations, so
// mockSend must be created inside vi.hoisted() to be visible here (same
// convention as the existing Stripe tests in this repo).
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('resend', () => ({
  // A regular function, not an arrow function: vitest's `new MockFn()`
  // support constructs the assigned implementation itself, and arrow
  // functions can never be used as a constructor in JS.
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

const ORIGINAL_ENV = { ...process.env };

describe('EmailService (Resend) - real ErrorResponse is surfaced, not masked', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'test-key-not-a-real-secret';
    process.env.EMAIL_FROM = 'noreply@example.com';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the real Resend error message instead of a generic string', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: {
        message: 'The gmail.com domain is not verified',
        statusCode: 403,
        name: 'invalid_from_address',
      },
    });

    const { EmailService } = await import('@/services/EmailService');
    const result = await EmailService.sendVerificationEmail(
      'user@example.com',
      'https://example.com/verify-email?token=x&userId=y'
    );

    expect(result.success).toBe(false);
    // The real message must come through, not the old 'Resend error' fallback.
    expect(result.error).toBe('The gmail.com domain is not verified');
    expect(result.error).not.toBe('Resend error');
  });

  it('logs only message, statusCode and name for a Resend ErrorResponse — never a raw dump', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: {
        message: 'Invalid API key',
        statusCode: 401,
        name: 'invalid_api_key',
      },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { EmailService } = await import('@/services/EmailService');
    await EmailService.sendVerificationEmail('user@example.com', 'https://example.com/verify');

    const resendErrorCall = errorSpy.mock.calls.find(
      (call) => call[0] === '[EmailService] Resend error:'
    );
    expect(resendErrorCall).toBeDefined();
    expect(resendErrorCall![1]).toEqual({
      message: 'Invalid API key',
      statusCode: 401,
      name: 'invalid_api_key',
    });

    // Never logs the API key or any other secret value.
    const allLoggedText = JSON.stringify(errorSpy.mock.calls);
    expect(allLoggedText).not.toContain('test-key-not-a-real-secret');

    errorSpy.mockRestore();
  });

  it('still succeeds normally when Resend returns no error', async () => {
    mockSend.mockResolvedValue({
      data: { id: 'real-message-id-123' },
      error: null,
    });

    const { EmailService } = await import('@/services/EmailService');
    const result = await EmailService.sendVerificationEmail(
      'user@example.com',
      'https://example.com/verify-email?token=x&userId=y'
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('real-message-id-123');
  });

  it('falls back to the message of a genuine thrown Error (e.g. a network failure), not the ErrorResponse path', async () => {
    mockSend.mockRejectedValue(new Error('fetch failed: network error'));

    const { EmailService } = await import('@/services/EmailService');
    const result = await EmailService.sendVerificationEmail('user@example.com', 'https://example.com/verify');

    expect(result.success).toBe(false);
    expect(result.error).toBe('fetch failed: network error');
  });
});
