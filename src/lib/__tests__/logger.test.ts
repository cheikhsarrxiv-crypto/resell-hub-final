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

  describe('redaction fix (audit follow-up) — JSON-quoted keys, Authorization headers, URL userinfo', () => {
    it('redacts a quoted JSON key:value secret (apiKey/password/token/secret) embedded in error.message — previously missed because the key was followed by a quote, never "=" or ":" directly', () => {
      const logger = createLogger('test-service');
      logger.error('Upstream rejected', new Error('upstream response: {"apiKey":"leaked-json-key-secret-1"}'));

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.error.message).toContain('"apiKey":"[REDACTED]"');
      expect(entry.error.message).not.toContain('leaked-json-key-secret-1');
    });

    it('redacts quoted JSON secrets for password/token/secret too, with spacing around ":" and inside a larger object, without touching unrelated fields', () => {
      const logger = createLogger('test-service');
      const raw = '{ "user":"bob", "password" : "leaked-json-key-secret-2", "token":"leaked-json-key-secret-3", "secret":"leaked-json-key-secret-4", "ok":true }';
      logger.error('Upstream rejected', new Error(raw));

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.error.message).not.toContain('leaked-json-key-secret-2');
      expect(entry.error.message).not.toContain('leaked-json-key-secret-3');
      expect(entry.error.message).not.toContain('leaked-json-key-secret-4');
      expect(entry.error.message).toContain('"user":"bob"');
      expect(entry.error.message).toContain('"ok":true');
    });

    it('redacts a quoted JSON secret in error.stack and in a context field too, not just error.message', () => {
      const logger = createLogger('test-service');
      const err = new Error('request failed');
      err.stack = 'Error: request failed\n    body: {"token":"leaked-json-key-secret-5"}';

      logger.error('Request failed', err, { responseBody: '{"secret":"leaked-json-key-secret-6"}' });

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.error.stack).not.toContain('leaked-json-key-secret-5');
      expect(entry.context.responseBody).not.toContain('leaked-json-key-secret-6');
      const raw = JSON.stringify(entry);
      expect(raw).not.toContain('leaked-json-key-secret-5');
      expect(raw).not.toContain('leaked-json-key-secret-6');
    });

    it('redacts an "Authorization: Bearer <token>" header, free-text and JSON-serialized, in message and context', () => {
      const logger = createLogger('test-service');
      logger.error(
        'Request rejected',
        new Error('Authorization: Bearer leaked-bearer-secret-1 was rejected by upstream'),
        { rawHeaders: '{"Authorization":"Bearer leaked-bearer-secret-2"}' }
      );

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.error.message).toContain('Authorization: Bearer [REDACTED]');
      expect(entry.error.message).not.toContain('leaked-bearer-secret-1');
      expect(entry.context.rawHeaders).not.toContain('leaked-bearer-secret-2');
    });

    it('redacts an "Authorization: Basic <credentials>" header the same way', () => {
      const logger = createLogger('test-service');
      logger.error('Request rejected', new Error('authorization: basic leaked-basic-secret-1'));

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.error.message).toMatch(/basic \[REDACTED\]/i);
      expect(entry.error.message).not.toContain('leaked-basic-secret-1');
    });

    it('does NOT redact the ordinary English words "basic"/"bearer" when there is no Authorization header context — no false positive', () => {
      const logger = createLogger('test-service');
      const err = new Error('The error was a basic configuration mistake; please provide a Bearer token manually next time');

      logger.error('Diagnostic note', err);

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.error.message).toBe('The error was a basic configuration mistake; please provide a Bearer token manually next time');
    });

    it('redacts credentials embedded in a URL\'s own userinfo (scheme://user:password@host), including a password with special characters, without altering the rest of the URL', () => {
      const logger = createLogger('test-service');
      logger.error('DB connection failed', new Error('connection to postgres://dbuser:leaked#url-secret!@db.internal:5432/mydb failed'));

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.error.message).toContain('postgres://dbuser:[REDACTED]@db.internal:5432/mydb');
      expect(entry.error.message).not.toContain('leaked#url-secret!');
    });

    it('redacts URL userinfo credentials even against a bare host with no dotted domain (e.g. localhost) — not reliant on the email pattern coincidentally matching', () => {
      const logger = createLogger('test-service');
      logger.error('DB connection failed', new Error('failed to reach https://admin:leaked-localhost-secret@localhost:5432/app'));

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.error.message).toContain('https://admin:[REDACTED]@localhost:5432/app');
      expect(entry.error.message).not.toContain('leaked-localhost-secret');
    });

    it('does NOT alter a URL with no credentials at all, or a URL whose ":" before a number is just a port — no false positive', () => {
      const logger = createLogger('test-service');
      const err = new Error('GET https://example.com:8080/api/v1/resource?x=1 returned 503');

      logger.error('Request failed', err);

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.error.message).toBe('GET https://example.com:8080/api/v1/resource?x=1 returned 503');
    });

    it('a self-referential (circular) context object never hangs or crashes the logger — degrades to a "[CIRCULAR]" marker instead of recursing forever', () => {
      const logger = createLogger('test-service');
      const circular: any = { workspaceId: 'ws-1' };
      circular.self = circular;

      expect(() => logger.error('Circular context test', new Error('plain failure'), circular)).not.toThrow();

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.context.workspaceId).toBe('ws-1');
      expect(entry.context.self).toBe('[CIRCULAR]');
    });

    it('a context object with a nested array containing an object that circularly references an ancestor never hangs or crashes', () => {
      const logger = createLogger('test-service');
      const parent: any = { label: 'parent' };
      parent.children = [{ label: 'child', backToParent: parent }];

      expect(() => logger.error('Circular nested context test', new Error('plain failure'), parent)).not.toThrow();

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.context.children[0].backToParent).toBe('[CIRCULAR]');
    });

    it('a shared (non-circular) nested reference used from two different keys is still handled safely, without crashing — flagged on its second occurrence (documented, safe over-approximation)', () => {
      const logger = createLogger('test-service');
      const shared = { note: 'shared payload' };
      const context = { left: shared, right: shared };

      expect(() => logger.error('Shared reference test', new Error('plain failure'), context)).not.toThrow();

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.context.left).toEqual({ note: 'shared payload' });
      expect(entry.context.right).toBe('[CIRCULAR]');
    });

    it('still handles deeply nested objects and arrays of objects correctly alongside the new patterns — no regression from the circular-reference guard', () => {
      const logger = createLogger('test-service');
      logger.error('Deep nested context test', new Error('plain failure'), {
        a: { b: { c: { apiKey: 'leaked-deep-secret-1' } } },
        items: [{ token: 'leaked-deep-secret-2' }, { note: 'fine' }],
      });

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.context.a.b.c.apiKey).toBe('[REDACTED]');
      expect(entry.context.items[0].token).toBe('[REDACTED]');
      expect(entry.context.items[1].note).toBe('fine');
      const raw = JSON.stringify(entry);
      expect(raw).not.toContain('leaked-deep-secret-1');
      expect(raw).not.toContain('leaked-deep-secret-2');
    });
  });

  describe('functional validation — public API (logger.warn, not just logger.error), with explicitly fake values', () => {
    it('logger.warn redacts a sensitive context key (FAKE_TOKEN_123) while keeping a non-sensitive field intact — warn goes through the same filterSensitiveData path as error, never exercised by a test until now', () => {
      const logger = createLogger('test-service');
      logger.warn('Quota check hinted a problem', { token: 'FAKE_TOKEN_123', workspaceId: 'ws-1' });

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.level).toBe('warn');
      expect(entry.context.token).toBe('[REDACTED]');
      expect(entry.context.workspaceId).toBe('ws-1');
      const raw = JSON.stringify(entry);
      expect(raw).not.toContain('FAKE_TOKEN_123');
    });

    it('logger.warn redacts a keyword=value secret (fake-password-456) embedded in a non-sensitive-keyed context string, exactly like logger.error does for error.message/stack', () => {
      const logger = createLogger('test-service');
      logger.warn('Login attempt flagged', { note: 'password=fake-password-456 rejected' });

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.context.note).toBe('password=[REDACTED] rejected');
      const raw = JSON.stringify(entry);
      expect(raw).not.toContain('fake-password-456');
    });

    it('logger.error redacts the exact fake DB connection string postgres://demo:FAKE_PASSWORD@localhost:5432/test in error.message, keeping scheme/user/host/port/path intact', () => {
      const logger = createLogger('test-service');
      logger.error('DB connection failed', new Error('could not connect: postgres://demo:FAKE_PASSWORD@localhost:5432/test'));

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.error.message).toContain('postgres://demo:[REDACTED]@localhost:5432/test');
      expect(entry.error.message).not.toContain('FAKE_PASSWORD');
    });

    it('logger.warn never throws on a circular context object — same guard as logger.error, exercised through the warn entry point specifically', () => {
      const logger = createLogger('test-service');
      const circular: any = { workspaceId: 'ws-1' };
      circular.self = circular;

      expect(() => logger.warn('Circular context via warn', circular)).not.toThrow();

      const [entry] = readEntries(consoleLogSpy);
      expect(entry.context.workspaceId).toBe('ws-1');
      expect(entry.context.self).toBe('[CIRCULAR]');
    });

    describe('hostile-getter fix — a throwing context getter must never crash the logger', () => {
      it('a top-level context property with a throwing getter degrades to "[UNREADABLE]" without crashing, and every sibling field is still preserved', () => {
        const logger = createLogger('test-service');
        const hostileContext: Record<string, unknown> = { workspaceId: 'ws-1', note: 'fine' };
        Object.defineProperty(hostileContext, 'detail', {
          enumerable: true,
          get(): never {
            throw new Error('hostile getter exception text');
          },
        });

        expect(() => logger.warn('Hostile context getter', hostileContext)).not.toThrow();

        const [entry] = readEntries(consoleLogSpy);
        expect(entry.context.detail).toBe('[UNREADABLE]');
        // Siblings of the hostile property survive untouched — one bad
        // getter no longer takes its neighbors down with it.
        expect(entry.context.workspaceId).toBe('ws-1');
        expect(entry.context.note).toBe('fine');
        const raw = JSON.stringify(entry);
        expect(raw).not.toContain('hostile getter exception text');
      });

      it('a throwing getter on a NESTED object (inside a non-sensitive parent key) also degrades safely, without crashing and without losing the nested siblings', () => {
        const logger = createLogger('test-service');
        const nested: Record<string, unknown> = { ok: 'fine-nested-value' };
        Object.defineProperty(nested, 'detail', {
          enumerable: true,
          get(): never {
            throw new Error('nested hostile getter');
          },
        });
        const context = { parent: nested };

        expect(() => logger.error('Nested hostile getter', new Error('plain failure'), context)).not.toThrow();

        const [entry] = readEntries(consoleLogSpy);
        expect(entry.context.parent.detail).toBe('[UNREADABLE]');
        expect(entry.context.parent.ok).toBe('fine-nested-value');
        const raw = JSON.stringify(entry);
        expect(raw).not.toContain('nested hostile getter');
      });

      it('a throwing getter on a key that is itself SENSITIVE (e.g. "apiKey") is redacted without ever invoking the getter at all — the key name alone is enough to redact, so a hostile value behind it is never even read', () => {
        const logger = createLogger('test-service');
        const context: Record<string, unknown> = {};
        let getterWasCalled = false;
        Object.defineProperty(context, 'apiKey', {
          enumerable: true,
          get(): never {
            getterWasCalled = true;
            throw new Error('should never run');
          },
        });

        expect(() => logger.warn('Hostile sensitive-key getter', context)).not.toThrow();

        const [entry] = readEntries(consoleLogSpy);
        expect(entry.context.apiKey).toBe('[REDACTED]');
        expect(getterWasCalled).toBe(false);
      });
    });

    it('all of the above ran with no real API key, no network call, and no database — every case here is a pure in-memory call to the public logger with console.log mocked, confirming no external dependency is required to validate this redaction', () => {
      // This test documents the structural guarantee rather than asserting
      // behavior: logger.ts imports nothing but process.env (read, never
      // written) and the global console — grep confirms no fetch/prisma/
      // network import anywhere in this file or its test file.
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const loggerSource = fs.readFileSync(path.resolve(__dirname, '../logger.ts'), 'utf-8');
      expect(loggerSource).not.toMatch(/\bfetch\s*\(/);
      expect(loggerSource).not.toMatch(/prisma/i);
      expect(loggerSource).not.toMatch(/require\(['"]http/);
    });
  });
});
