/**
 * Basic / Advanced analytics split.
 *
 * - BASIC  (every workspace, every plan): plain activity counters - orders in the period, products,
 *   active listings, pending orders. No amounts. Served by GET /api/analytics/basic.
 * - ADVANCED (plan feature `advancedAnalytics`): everything financial or analytical - revenue, profit,
 *   margin, per-marketplace and fulfillment figures, revenue trend, product performance. Served by
 *   GET /api/analytics/dashboard and /api/analytics/overview, which answer 403 + this code to a
 *   workspace whose plan does not include the feature.
 *
 * The code lets the client tell "this plan does not include Advanced analytics" (a feature lock, not a
 * failure) apart from every other 403 (for example an unverified e-mail), which stays a real error.
 */
export const ADVANCED_ANALYTICS_REQUIRED_CODE = 'ADVANCED_ANALYTICS_REQUIRED';
export const ADVANCED_ANALYTICS_REQUIRED_MESSAGE =
  'Advanced analytics is not included in your current plan. Upgrade to unlock it.';
