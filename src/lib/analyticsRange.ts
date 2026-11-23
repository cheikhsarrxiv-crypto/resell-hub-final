/**
 * R6 — the `days` query parameter of the analytics routes. It used to be `parseInt(raw || '30')`:
 * `days=abc` produced NaN -> Invalid Date -> a raw database error, and `days=99999999` made an
 * unbounded scan. Anything that is not a plain whole number falls back to the default window; a whole number is
 * clamped to [1, 365] (0 -> default).
 */
export const DEFAULT_ANALYTICS_DAYS = 30;
export const MAX_ANALYTICS_DAYS = 365;

export function parseAnalyticsDays(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_ANALYTICS_DAYS;
  const n = Number(raw.trim());
  if (n < 1) return DEFAULT_ANALYTICS_DAYS;
  return Math.min(n, MAX_ANALYTICS_DAYS);
}
