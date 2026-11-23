import type { DashboardMetrics, BasicDashboardMetrics } from '@/types';
import { ADVANCED_ANALYTICS_REQUIRED_CODE } from '@/lib/analyticsAccess';

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
  const body = (data ?? {}) as { success?: boolean; error?: string; code?: string; metrics?: DashboardMetrics };
  const serverMessage = typeof body.error === 'string' && body.error ? body.error : null;

  if (responseStatus === 200 && body.success && body.metrics) {
    return { kind: 'ok', metrics: body.metrics };
  }
  // Only the SPECIFIC, identified refusal of the Advanced feature is a feature lock. Any other 403 (an
  // unverified e-mail, an access problem...) is a real error and must not be dressed up as "upgrade".
  if (responseStatus === 403 && body.code === ADVANCED_ANALYTICS_REQUIRED_CODE) {
    return { kind: 'plan_upgrade_required', message: serverMessage || DEFAULT_UPGRADE_MESSAGE };
  }
  if (responseStatus === 401) {
    return { kind: 'unauthorized', message: serverMessage || DEFAULT_UNAUTHORIZED_MESSAGE };
  }
  return { kind: 'error', message: serverMessage || fallbackErrorMessage };
}

/* -------------------------------------------------------------------------------------------------
 * Basic / Advanced composition (Dashboard Analytics fix)
 * ---------------------------------------------------------------------------------------------- */

export type BasicOutcome =
  | { kind: 'ok'; metrics: BasicDashboardMetrics }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'error'; message: string };

/** /api/analytics/basic has no plan lock: anything but a 200 with metrics is a real failure. */
export function classifyBasicResponse(responseStatus: number, data: unknown, fallbackErrorMessage: string): BasicOutcome {
  const body = (data ?? {}) as { success?: boolean; error?: string; metrics?: BasicDashboardMetrics };
  const serverMessage = typeof body.error === 'string' && body.error ? body.error : null;
  if (responseStatus === 200 && body.success && body.metrics) return { kind: 'ok', metrics: body.metrics };
  if (responseStatus === 401) return { kind: 'unauthorized', message: serverMessage || DEFAULT_UNAUTHORIZED_MESSAGE };
  return { kind: 'error', message: serverMessage || fallbackErrorMessage };
}

export type AdvancedOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'plan_upgrade_required'; message: string }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'error'; message: string };

/** Adapts the dashboard metrics outcome to the generic Advanced outcome. */
export function metricsOutcomeToAdvanced(outcome: MetricsFetchOutcome): AdvancedOutcome<DashboardMetrics> {
  return outcome.kind === 'ok' ? { kind: 'ok', value: outcome.metrics } : outcome;
}

export interface OverviewData {
  /** Currency of every amount below (S8). Orders in other currencies are not included: see otherCurrencies. */
  currency: string;
  otherCurrencies: { currency: string; orders: number }[];
  revenueTrend: { date: string; revenue: number; orders: number }[];
  /** profit / margin are null when they cannot be known (missing purchase cost, synced orders). */
  productsPerformance: { id: string; sku: string; title: string; sales: number; revenue: number; profit: number | null; margin: number | null }[];
  marketplacePerformance: Record<string, { listings: number; orders: number; revenue: number; profit: number | null; ordersWithUnknownProfit?: number }>;
}

/** Classification of /api/analytics/overview (same lock rule as classifyMetricsResponse). */
export function classifyOverviewResponse(responseStatus: number, data: unknown, fallbackErrorMessage: string): AdvancedOutcome<OverviewData> {
  const body = (data ?? {}) as Partial<OverviewData> & { success?: boolean; error?: string; code?: string };
  const serverMessage = typeof body.error === 'string' && body.error ? body.error : null;
  if (responseStatus === 200 && body.success) {
    return {
      kind: 'ok',
      value: {
        currency: typeof body.currency === 'string' && body.currency ? body.currency : 'EUR',
        otherCurrencies: Array.isArray(body.otherCurrencies) ? body.otherCurrencies : [],
        revenueTrend: Array.isArray(body.revenueTrend) ? body.revenueTrend : [],
        productsPerformance: Array.isArray(body.productsPerformance) ? body.productsPerformance : [],
        marketplacePerformance: body.marketplacePerformance && typeof body.marketplacePerformance === 'object' ? body.marketplacePerformance : {},
      },
    };
  }
  if (responseStatus === 403 && body.code === ADVANCED_ANALYTICS_REQUIRED_CODE) {
    return { kind: 'plan_upgrade_required', message: serverMessage || DEFAULT_UPGRADE_MESSAGE };
  }
  if (responseStatus === 401) return { kind: 'unauthorized', message: serverMessage || DEFAULT_UNAUTHORIZED_MESSAGE };
  return { kind: 'error', message: serverMessage || fallbackErrorMessage };
}

export type AccessView<T> =
  | { kind: 'unauthorized'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; access: 'advanced'; advanced: T }
  | { kind: 'ready'; access: 'basic'; basic: BasicDashboardMetrics; lockedMessage: string };

/**
 * Combines the Basic and Advanced fetch outcomes into what the page renders.
 *  - Advanced ok            -> full page (Basic is not needed, so a Basic failure cannot regress it).
 *  - Advanced locked (identified plan refusal) + Basic ok -> Basic page with the Advanced sections locked.
 *  - Anything else (401, 5xx, network, an unrelated 403, a Basic failure while locked) stays a REAL error.
 */
export function composeAccessView<T>(basic: BasicOutcome, advanced: AdvancedOutcome<T>): AccessView<T> {
  if (advanced.kind === 'ok') return { kind: 'ready', access: 'advanced', advanced: advanced.value };
  if (advanced.kind === 'unauthorized') return { kind: 'unauthorized', message: advanced.message };
  if (advanced.kind === 'error') return { kind: 'error', message: advanced.message };
  // advanced is the identified plan lock
  if (basic.kind === 'ok') return { kind: 'ready', access: 'basic', basic: basic.metrics, lockedMessage: advanced.message };
  if (basic.kind === 'unauthorized') return { kind: 'unauthorized', message: basic.message };
  return { kind: 'error', message: basic.message };
}
