/**
 * logger.ts — redaction tests. No pre-existing test file covered this at
 * all (confirmed by the audit this task follows up on) — createLogger's
 * context-filtering was exercised only incidentally through other
 * services' own test files, and error.message/error.stack were never
 * filtered in the first place (the fix this file covers).
 *
 * LOG_FORMAT is stubbed to 'json' so each emitted line is one parseable
 * JSON object (see logger.ts's own outputLog) rather than the
 * colorized text format meant for a human terminal. LOG_LEVEL is stubbed
 * to 'debug' so every level is actually emitted regardless of the
 * environment's own default. createLogger() must be called AFTER these
 * are stubbed — StructuredLogger reads both from process.env only once,
 * in its constructor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '@/lib/logger';

function readEntries(spy: { mock: { calls: unknown[][] } }): any[] {
  return spy.mock.calls.map((call) => JSON.parse(call[0] as string));
}

describe('logger — redaction', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('LOG_FORMAT', 'json');
    vi.stubEnv('LOG_LEVEL', 'debug');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('redacts a sensitive-named key in context (e.g. apiKey) while keeping a non-sensitive field intact', () => {
    const logger = createLogger('test-service');
    logger.error('Something failed', new Error('plain failure'), {
      apiKey: 'sk-live-abcdef123456',
      userId: 'user-42',
    });

    const [entry] = readEntries(consoleLogSpy);
    expect(entry.context.apiKey).toBe('[REDACTED]');
    expect(entry.context.userId).toBe('user-42');
    const raw = JSON.stringify(entry);
    expect(raw).not.toContain('sk-live-abcdef123456');
  });

  it('redacts a secret embedded in error.message (previously logged verbatim, never filtered)', () => {
    const logger = createLogger('test-service');
    logger.error('Upstream call failed', new Error('request failed: token=sk-ant-super-secret-999 was rejected'));

    const [entry] = readEntries(consoleLogSpy);
    expect(entry.error.message).toContain('token=[REDACTED]');
    expect(entry.error.message).not.toContain('sk-ant-super-secret-999');
    const raw = JSON.stringify(entry);
    expect(raw).not.toContain('sk-ant-super-secret-999');
  });

  it('redacts a secret embedded in error.stack (previously logged verbatim, never filtered)', () => {
    const logger = createLogger('test-service');
    const err = new Error('connection setup failed');
    // A real stack trace is call-site-dependent and not forgeable in a
    // unit test — overwriting .stack directly is the standard way to
    // exercise "whatever ended up in this string", matching how a
    // framework/runtime could embed request details (here, a leaked
    // secret=... fragment) into a stack-like string.
    err.stack = 'Error: connection setup failed\n    at connect (secret=db-password-hunter2 in connection string)';

    logger.error('DB connection failed', err);

    const [entry] = readEntries(consoleLogSpy);
    expect(entry.error.stack).toContain('secret=[REDACTED]');
    expect(entry.error.stack).not.toContain('db-password-hunter2');
    const raw = JSON.stringify(entry);
    expect(raw).not.toContain('db-password-hunter2');
  });

  it('an ordinary error with no sensitive data passes through unchanged (name/message/stack preserved, no over-redaction)', () => {
    const logger = createLogger('test-service');
    const err = new Error('Order not found');
    err.stack = 'Error: Order not found\n    at OrderService.getOrder (OrderService.ts:42:7)';

    logger.error('Lookup failed', err, { workspaceId: 'ws-1' });

    const [entry] = readEntries(consoleLogSpy);
    expect(entry.error.name).toBe('Error');
    expect(entry.error.message).toBe('Order not found');
    expect(entry.error.stack).toBe('Error: Order not found\n    at OrderService.getOrder (OrderService.ts:42:7)');
    expect(entry.context.workspaceId).toBe('ws-1');
  });

  it('a string thrown/passed as the error (no real Error object) is handled without throwing — message preserved, name defaults, stack absent', () => {
    const logger = createLogger('test-service');
    expect(() => logger.error('Caught a raw string', 'raw upstream failure string')).not.toThrow();

    const [entry] = readEntries(consoleLogSpy);
    expect(entry.error.name).toBe('Error');
    expect(entry.error.message).toBe('raw upstream failure string');
    expect(entry.error.stack).toBeUndefined();
  });

  it('a non-Error, property-less object passed as the error never throws — degrades to safe empty fields, never the literal string "undefined"', () => {
    const logger = createLogger('test-service');
    expect(() => logger.error('Weird failure', {} as any)).not.toThrow();

    const [entry] = readEntries(consoleLogSpy);
    expect(entry.error.name).toBe('Error');
    expect(entry.error.message).toBe('');
    expect(entry.error.stack).toBeUndefined();
  });

  it('a hostile error whose .message getter throws never crashes the logger — degrades to a fixed, non-sensitive placeholder', () => {
    const logger = createLogger('test-service');
    const hostile = {
      get name(): string {
        throw new Error('nope');
      },
      get message(): string {
        throw new Error('nope');
      },
    };

    expect(() => logger.error('Hostile error object', hostile as any)).not.toThrow();

    const [entry] = readEntries(consoleLogSpy);
    expect(entry.error.name).toBe('Error');
    expect(entry.error.message).toBe('[error could not be read]');
    expect(entry.error.stack).toBeUndefined();
  });

  it('a non-string, non-nullish .message (e.g. a number) is coerced to a string rather than crashing or leaking a raw object', () => {
    const logger = createLogger('test-service');
    expect(() => logger.error('Numeric message', { message: 12345, name: 'WeirdError' } as any)).not.toThrow();

    const [entry] = readEntries(consoleLogSpy);
    expect(entry.error.name).toBe('WeirdError');
    expect(entry.error.message).toBe('12345');
  });

  it('calling .error() with no error argument at all leaves logEntry.error entirely absent (pre-existing baseline, unchanged by this fix)', () => {
    const logger = createLogger('test-service');
    logger.error('Just a message, no error object');

    const [entry] = readEntries(consoleLogSpy);
    expect(entry.error).toBeUndefined();
  });

  it('never leaks the original, unredacted secret anywhere in the full serialized log line — context, message and stack combined', () => {
    const logger = createLogger('test-service');
    const err = new Error('auth rejected: password=hunter2-super-secret');
    err.stack = 'Error: auth rejected\n    at login (api_key=stack-leaked-secret-xyz)';

    logger.error('Login failed', err, { token: 'context-leaked-secret-abc', note: 'password=hunter2-super-secret again' });

    const raw = JSON.stringify(readEntries(consoleLogSpy)[0]);
    expect(raw).not.toContain('hunter2-super-secret');
    expect(raw).not.toContain('stack-leaked-secret-xyz');
    expect(raw).not.toContain('context-leaked-secret-abc');
  });
});
