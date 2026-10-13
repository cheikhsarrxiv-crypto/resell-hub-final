/**
 * Retry-publish safety fix — RetrySystem's own Retry-After support.
 *
 * The pre-existing exponential-backoff/max-retries/non-retryable behavior
 * is already covered by src/__tests__/marketplace/architecture.test.ts
 * (real timers, deliberately — see that file's own 25000ms test timeout)
 * and is NOT re-tested here. This file covers only the new behavior:
 * preferring a marketplace's own Retry-After over the generic exponential
 * delay, bounded by this system's own safety ceiling (MAX_DELAY_MS).
 *
 * Fake timers are used throughout so these tests never incur a real
 * multi-second wait, even though the underlying waits (seconds, sometimes
 * tens of seconds before clamping) are genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RetrySystem } from '@/services/marketplace/RetrySystem';
import { ErrorType } from '@/types/marketplace';

describe('RetrySystem.withRetry — Retry-After support', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a valid Retry-After (seconds) on a retryable error is respected as the wait time, not the generic exponential delay', async () => {
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        throw { statusCode: 429, type: ErrorType.RATE_LIMIT_EXCEEDED, retryable: true, retryAfter: 5 };
      }
      return 'success';
    });

    const promise = RetrySystem.withRetry(operation);

    // Not yet retried — the stated 5s Retry-After has not elapsed.
    await vi.advanceTimersByTimeAsync(4000);
    expect(attempts).toBe(1);

    // Retried once the stated Retry-After has elapsed.
    await vi.advanceTimersByTimeAsync(1500);
    expect(attempts).toBe(2);

    await expect(promise).resolves.toBe('success');
  });

  it("a Retry-After far beyond this system's own safety ceiling (32s) is clamped, never obeyed literally", async () => {
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        throw { statusCode: 429, type: ErrorType.RATE_LIMIT_EXCEEDED, retryable: true, retryAfter: 3600 }; // 1 hour
      }
      return 'success';
    });

    const promise = RetrySystem.withRetry(operation);

    // Clamped to MAX_DELAY_MS (32s) — never actually waits an hour.
    await vi.advanceTimersByTimeAsync(32000);
    expect(attempts).toBe(2);

    await expect(promise).resolves.toBe('success');
  });

  it('a malformed Retry-After (negative) is ignored, falling back to the normal exponential/jitter wait', async () => {
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        throw { statusCode: 429, type: ErrorType.RATE_LIMIT_EXCEEDED, retryable: true, retryAfter: -5 };
      }
      return 'success';
    });

    const promise = RetrySystem.withRetry(operation);

    // The default exponential delay (1s + up to 1s jitter) has elapsed by 2s.
    await vi.advanceTimersByTimeAsync(2000);
    expect(attempts).toBe(2);

    await expect(promise).resolves.toBe('success');
  });

  it("a raw 'retry-after' response header (no pre-normalized .retryAfter field — e.g. EbayAdapter's own raw throw) is respected the same way", async () => {
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        throw { status: 429, statusCode: 429, message: 'eBay API error', headers: { 'retry-after': '3' } };
      }
      return 'success';
    });

    const promise = RetrySystem.withRetry(operation);

    await vi.advanceTimersByTimeAsync(2500);
    expect(attempts).toBe(1); // the stated 3s has not elapsed yet

    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts).toBe(2);

    await expect(promise).resolves.toBe('success');
  });

  it('a non-numeric Retry-After (e.g. an unparsed string) is ignored, never crashing the retry loop', async () => {
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        throw { statusCode: 429, type: ErrorType.RATE_LIMIT_EXCEEDED, retryable: true, retryAfter: 'soon' as any };
      }
      return 'success';
    });

    const promise = RetrySystem.withRetry(operation);
    await vi.advanceTimersByTimeAsync(2000);
    expect(attempts).toBe(2);

    await expect(promise).resolves.toBe('success');
  });
});
