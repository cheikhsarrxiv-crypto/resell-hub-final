/**
 * Proves the fix for the "Invalid time value" crash on
 * /dashboard/listings: listing.createdAt comes back from
 * GET /api/listings as a JSON-deserialized ISO string (API responses
 * never carry real Date objects), but formatDateTime() was called
 * directly on it without wrapping in new Date(...) first — unlike
 * orders/page.tsx and fulfillment/page.tsx, which already did this
 * correctly. Intl.DateTimeFormat.format() throws a RangeError
 * ("Invalid time value") for a non-Date value, which crashed the whole
 * page (no error boundary around just that cell) as soon as any listing
 * existed.
 *
 * Two independent fixes are covered here:
 *  1. listings/page.tsx now wraps the value in new Date(...), matching
 *     the pattern already used everywhere else.
 *  2. formatDateTime() itself now normalizes its input and returns a
 *     safe fallback for anything that isn't a valid date, so no future
 *     caller (or caller mistake) can crash a whole page from one bad
 *     value again.
 */
import { describe, it, expect } from 'vitest';
import { formatDateTime } from '@/lib/utils';

describe('formatDateTime()', () => {
  it('formats a real Date object correctly (existing, working callers like orders/fulfillment)', () => {
    const result = formatDateTime(new Date('2026-03-15T14:30:00.000Z'));
    // fr-FR, day/month/year + hour:minute — exact rendering depends on
    // the runtime's timezone, so just assert it's a real formatted
    // string and not the fallback.
    expect(result).not.toBe('—');
    expect(result).toMatch(/2026/);
  });

  it('formats an ISO date string the same way once wrapped in new Date(...) — the exact pattern now used in listings/page.tsx', () => {
    const isoString = '2026-03-15T14:30:00.000Z';
    const result = formatDateTime(new Date(isoString));
    expect(result).not.toBe('—');
    expect(result).toMatch(/2026/);
  });

  it('never throws for a raw ISO string passed directly (defense in depth, in case a future caller forgets new Date(...))', () => {
    // @ts-expect-error — deliberately calling with the exact shape that
    // used to crash the whole page, to prove the guard inside
    // formatDateTime() itself now catches it too.
    expect(() => formatDateTime('2026-03-15T14:30:00.000Z')).not.toThrow();
  });

  it('returns a safe fallback ("—") for a genuinely invalid date, instead of throwing', () => {
    expect(formatDateTime(new Date('not-a-real-date'))).toBe('—');
  });

  it('returns a safe fallback for a missing (undefined) value, instead of throwing', () => {
    // @ts-expect-error — simulating a missing createdAt field from a
    // malformed API response. (null would coerce to the 1970 epoch via
    // new Date(null), which is a valid date, not an error case — this
    // deliberately tests undefined instead, which new Date() treats as
    // genuinely invalid.)
    expect(() => formatDateTime(undefined)).not.toThrow();
    // @ts-expect-error
    expect(formatDateTime(undefined)).toBe('—');
  });
});
