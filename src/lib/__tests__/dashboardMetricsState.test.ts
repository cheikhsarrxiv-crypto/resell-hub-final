/**
 * Fix: dashboard/page.tsx and workspace/[slug]/page.tsx used to do
 * `if (data.success) { setMetrics(...) }` with no else and no look at the
 * real HTTP status. A 403 from /api/analytics/dashboard (the plan simply
 * doesn't include advancedAnalytics — expected tiering, not a failure)
 * came back as `{ error: "..." }` with no `success` field at all, so
 * `metrics` stayed `null` forever and the page rendered a generic "Failed
 * to load metrics" — identical to what a real 500 would show, with no way
 * for the user to tell "upgrade your plan" apart from "something broke" or
 * "your session expired".
 *
 * This tests the extracted, framework-free classification directly (no
 * DOM/@testing-library/react in this project — same convention as
 * dashboardListPageState.ts). Both pages are thin consumers of this one
 * function.
 */
import { describe, it, expect } from 'vitest';
import { classifyMetricsResponse } from '@/lib/dashboardMetricsState';

const metrics = {
  revenue: 100,
  orders: 5,
  profit: 40,
  margin: 40,
  productsCount: 10,
  activeListings: 5,
  pendingOrders: 1,
  fulfillmentOrders: 2,
  fulfillmentRevenue: 20,
  fulfillmentCost: 5,
  revenueByMarketplace: {},
  profitByMarketplace: {},
  grossProfit: 40,
  netRevenue: 100,
} as any;

describe('classifyMetricsResponse', () => {
  it('200 + success + metrics -> ok, carrying the real metrics through untouched', () => {
    expect(classifyMetricsResponse(200, { success: true, metrics }, 'fallback')).toEqual({
      kind: 'ok',
      metrics,
    });
  });

  it('403 -> plan_upgrade_required, never "Failed to load metrics" — this is expected tiering, not a failure', () => {
    expect(
      classifyMetricsResponse(
        403,
        { error: 'Advanced analytics is not included in your current plan. Upgrade to unlock it.' },
        'fallback'
      )
    ).toEqual({
      kind: 'plan_upgrade_required',
      message: 'Advanced analytics is not included in your current plan. Upgrade to unlock it.',
    });
  });

  it('403 with no error body text still gets a sensible default upgrade message, never a blank screen', () => {
    expect(classifyMetricsResponse(403, {}, 'fallback')).toEqual({
      kind: 'plan_upgrade_required',
      message: 'Advanced analytics is not included in your current plan. Upgrade to unlock it.',
    });
  });

  it('401 -> unauthorized, with the real server message', () => {
    expect(classifyMetricsResponse(401, { error: 'Unauthorized' }, 'fallback')).toEqual({
      kind: 'unauthorized',
      message: 'Unauthorized',
    });
  });

  it('401 with no error body text still gets a sensible default session message', () => {
    expect(classifyMetricsResponse(401, null, 'fallback')).toEqual({
      kind: 'unauthorized',
      message: 'Your session has expired. Please sign in again.',
    });
  });

  it('500 -> error, with the real server message when present', () => {
    expect(classifyMetricsResponse(500, { error: 'Internal server error' }, 'fallback')).toEqual({
      kind: 'error',
      message: 'Internal server error',
    });
  });

  it('500 with no parseable body (e.g. response.json() failed) falls back to the caller-provided message, never stuck in an undefined state', () => {
    expect(classifyMetricsResponse(500, null, 'Failed to load metrics.')).toEqual({
      kind: 'error',
      message: 'Failed to load metrics.',
    });
  });

  it('a 200 with a malformed/incomplete body (success true but no metrics) is treated as an error, never silently rendered as "ok" with undefined metrics', () => {
    expect(classifyMetricsResponse(200, { success: true }, 'fallback')).toEqual({
      kind: 'error',
      message: 'fallback',
    });
  });

  it('a 200 with success:false (should not happen per errorResponse, but defensive) is treated as an error, not "ok"', () => {
    expect(classifyMetricsResponse(200, { success: false, error: 'weird' }, 'fallback')).toEqual({
      kind: 'error',
      message: 'weird',
    });
  });

  it('every other status (e.g. 404, 429) falls into "error", never silently matches "ok" or gets lost', () => {
    expect(classifyMetricsResponse(404, { error: 'Not found' }, 'fallback')).toEqual({
      kind: 'error',
      message: 'Not found',
    });
    expect(classifyMetricsResponse(429, {}, 'Too many requests, try later.')).toEqual({
      kind: 'error',
      message: 'Too many requests, try later.',
    });
  });
});
