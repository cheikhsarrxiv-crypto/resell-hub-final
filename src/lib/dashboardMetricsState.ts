import type { DashboardMetrics } from '@/types';

/**
 * Shared, framework-free classification of a /api/analytics/dashboard (or
 * /overview) fetch response, used by both dashboard/page.tsx and
 * workspace/[slug]/page.tsx. Closes the bug where every non-200 response
 * (most commonly a 403 — the plan simply doesn't include advancedAnalytics,
 * a normal/expected response, never a failure) was rendered identically to
 * a real error as "Failed to load metrics", with `metrics` staying `null`
 * forever and no way for the user to tell the two apart.
 *
 * Pure — no DOM, directly unit-testable (same reasoning as
 * dashboardListPageState.ts, which this mirrors).
 */

export type MetricsFetchOutcome =
  | { kind: 'ok'; metrics: DashboardMetrics }
  | { kind: 'plan_upgrade_required'; message: string }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'error'; message: string };

const DEFAULT_UPGRADE_MESSAGE =
  'Advanced analytics is not included in your current plan. Upgrade to unlock it.';
const DEFAULT_UNAUTHORIZED_MESSAGE = 'Your session has expired. Please sign in again.';

/**
 * `responseStatus` is the real HTTP status of the fetch Response — the
 * caller must pass it explicitly rather than relying on `data.success`
 * alone, since a 401/403/500 body ({ error: "..." }) never has a
 * `success` field at all (see src/lib/security.ts's errorResponse).
 */
export function classifyMetricsResponse(
  responseStatus: number,
  data: unknown,
  fallbackErrorMessage: string
): MetricsFetchOutcome {
  const body = (data ?? {}) as { success?: boolean; error?: string; metrics?: DashboardMetrics };
  const serverMessage = typeof body.error === 'string' && body.error ? body.error : null;

  if (responseStatus === 200 && body.success && body.metrics) {
    return { kind: 'ok', metrics: body.metrics };
  }
  if (responseStatus === 403) {
    return { kind: 'plan_upgrade_required', message: serverMessage || DEFAULT_UPGRADE_MESSAGE };
  }
  if (responseStatus === 401) {
    return { kind: 'unauthorized', message: serverMessage || DEFAULT_UNAUTHORIZED_MESSAGE };
  }
  return { kind: 'error', message: serverMessage || fallbackErrorMessage };
}
