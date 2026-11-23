/**
 * Dashboard Analytics fix — Basic / Advanced separation.
 * Real route handlers + real pure view logic; plan check, workspace check and the analytics service are
 * mocked. No database, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  classifyBasicResponse, classifyMetricsResponse, classifyOverviewResponse, composeAccessView, metricsOutcomeToAdvanced,
} from '@/lib/dashboardMetricsState';
import { ADVANCED_ANALYTICS_REQUIRED_CODE } from '@/lib/analyticsAccess';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const m = vi.hoisted(() => ({
  verified: vi.fn(),
  hasFeature: vi.fn(),
  getDashboardMetrics: vi.fn(),
  getBasicMetrics: vi.fn(),
  getOverview: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security')>();
  return { ...actual, getVerifiedWorkspaceId: m.verified };
});
vi.mock('@/services/SubscriptionService', () => ({ SubscriptionService: { hasFeature: m.hasFeature } }));
vi.mock('@/services/AnalyticsService', () => ({
  AnalyticsService: {
    getDashboardMetrics: m.getDashboardMetrics,
    getBasicMetrics: m.getBasicMetrics,
    getOverview: m.getOverview,
  },
}));

import * as basicRoute from '@/app/api/analytics/basic/route';
import * as dashboardRoute from '@/app/api/analytics/dashboard/route';
import * as overviewRoute from '@/app/api/analytics/overview/route';

const BASIC = { orders: 7, productsCount: 12, activeListings: 5, pendingOrders: 2 };
const FULL = { ...BASIC, revenue: 900, profit: 300, margin: 33.3, fulfillmentOrders: 1, revenueByMarketplace: { eBay: 900 }, profitByMarketplace: { eBay: 300 }, fulfillmentRevenue: 10, fulfillmentCost: 4, grossProfit: 306, netRevenue: 910 };
const FORBIDDEN_FOR_STARTER = ['revenue', 'profit', 'margin', 'fulfillmentRevenue', 'fulfillmentCost', 'grossProfit', 'netRevenue', 'revenueByMarketplace', 'profitByMarketplace', 'fulfillmentOrders', 'revenueTrend', 'productsPerformance', 'marketplacePerformance'];

const get = (route: { GET: (r: NextRequest) => Promise<Response> }, url: string) =>
  route.GET(new NextRequest(`http://localhost${url}`, { method: 'GET' }));

function plan(kind: 'starter' | 'pro') {
  m.hasFeature.mockImplementation(async (_ws: string, feature: string) => (feature === 'advancedAnalytics' ? kind === 'pro' : false));
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.verified.mockResolvedValue('ws-A');
  m.getBasicMetrics.mockResolvedValue(BASIC);
  m.getDashboardMetrics.mockResolvedValue(FULL);
  m.getOverview.mockResolvedValue({ currency: 'EUR', otherCurrencies: [], revenueTrend: [{ date: '2026-11-01', revenue: 10, orders: 1 }], productsPerformance: [], marketplacePerformance: {} });
});

describe('API — Basic analytics (every plan)', () => {
  it.each(['starter', 'pro'] as const)('%s: GET /api/analytics/basic -> 200 with the four counters only', async (p) => {
    plan(p);
    const r = await get(basicRoute, '/api/analytics/basic?workspaceId=ws-A&days=30');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ success: true, metrics: BASIC });
    for (const field of FORBIDDEN_FOR_STARTER) expect(JSON.stringify(body)).not.toContain(`"${field}"`);
  });
  it('is not gated by any plan feature (no entitlement lookup at all)', async () => {
    plan('starter');
    await get(basicRoute, '/api/analytics/basic?workspaceId=ws-A');
    expect(m.hasFeature).not.toHaveBeenCalled();
  });
  it('is scoped by the VERIFIED workspace, never by the raw query parameter', async () => {
    m.verified.mockResolvedValue('ws-verified');
    await get(basicRoute, '/api/analytics/basic?workspaceId=ws-other&days=14');
    expect(m.getBasicMetrics).toHaveBeenCalledWith('ws-verified', 14);
  });
  it('another workspace -> refused (401), the counters of that workspace are never read', async () => {
    m.verified.mockRejectedValue(new Error('Workspace not found or unauthorized'));
    const r = await get(basicRoute, '/api/analytics/basic?workspaceId=ws-B');
    expect(r.status).toBe(401);
    expect(m.getBasicMetrics).not.toHaveBeenCalled();
    expect(JSON.stringify(await r.json())).not.toContain('productsCount');
  });
  it('no session -> 401, no data', async () => {
    m.verified.mockRejectedValue(new Error('Unauthorized'));
    const r = await get(basicRoute, '/api/analytics/basic?workspaceId=ws-A');
    expect(r.status).toBe(401);
    expect(m.getBasicMetrics).not.toHaveBeenCalled();
  });
  it('missing workspaceId -> 400 (not an empty success)', async () => {
    m.verified.mockRejectedValue(new Error('Workspace ID required'));
    expect((await get(basicRoute, '/api/analytics/basic')).status).toBe(400);
  });
  it('a server error is a 500 with a generic message, never converted to a success with empty data', async () => {
    m.getBasicMetrics.mockRejectedValue(new Error('Invalid `prisma.order.count()` invocation: secret detail'));
    const r = await get(basicRoute, '/api/analytics/basic?workspaceId=ws-A');
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.success).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/prisma|secret detail/i);
  });
  it('days is bounded like the other routes (never NaN)', async () => {
    await get(basicRoute, '/api/analytics/basic?workspaceId=ws-A&days=abc');
    expect(m.getBasicMetrics).toHaveBeenCalledWith('ws-A', 30);
  });
});

describe('API — Advanced analytics (plan feature)', () => {
  it.each([
    ['dashboard', dashboardRoute, '/api/analytics/dashboard?workspaceId=ws-A&days=30'],
    ['overview', overviewRoute, '/api/analytics/overview?workspaceId=ws-A&days=30'],
  ] as const)('Starter: GET %s -> 403 with the identifiable code, no data, no analytics query run', async (_n, route, url) => {
    plan('starter');
    const r = await get(route, url);
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.code).toBe(ADVANCED_ANALYTICS_REQUIRED_CODE);
    expect(Object.keys(body).sort()).toEqual(['code', 'error']);
    for (const field of FORBIDDEN_FOR_STARTER) expect(JSON.stringify(body)).not.toContain(field);
    for (const fn of [m.getDashboardMetrics, m.getOverview]) expect(fn).not.toHaveBeenCalled();
  });
  it('advanced plan: dashboard -> 200 with the full metrics (no regression)', async () => {
    plan('pro');
    const r = await get(dashboardRoute, '/api/analytics/dashboard?workspaceId=ws-A&days=30');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, metrics: FULL });
    expect(m.getDashboardMetrics).toHaveBeenCalledWith('ws-A', 30);
  });
  it('advanced plan: overview -> 200 with trend, products and marketplaces (no regression)', async () => {
    plan('pro');
    const r = await get(overviewRoute, '/api/analytics/overview?workspaceId=ws-A&days=14');
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body).toMatchObject({ success: true, currency: 'EUR', revenueTrend: [{ date: '2026-11-01' }], productsPerformance: [], marketplacePerformance: {} });
    expect(m.getOverview).toHaveBeenCalledWith('ws-A', 14);
  });
  it('the plan is checked for the VERIFIED workspace (a Starter cannot borrow another workspace\'s plan by query)', async () => {
    plan('starter');
    m.verified.mockResolvedValue('ws-starter');
    await get(dashboardRoute, '/api/analytics/dashboard?workspaceId=ws-pro');
    expect(m.hasFeature).toHaveBeenCalledWith('ws-starter', 'advancedAnalytics');
  });
  it('another workspace -> refused before the plan is even looked at', async () => {
    m.verified.mockRejectedValue(new Error('Workspace not found or unauthorized'));
    for (const [route, url] of [[dashboardRoute, '/api/analytics/dashboard?workspaceId=ws-B'], [overviewRoute, '/api/analytics/overview?workspaceId=ws-B']] as const) {
      const r = await get(route, url);
      expect(r.status).toBe(401);
      expect((await r.json()).code).toBeUndefined(); // a foreign workspace is NOT presented as a plan lock
    }
    expect(m.hasFeature).not.toHaveBeenCalled();
  });
  it('a server error on an Advanced route stays a 500, no lock code', async () => {
    plan('pro');
    m.getDashboardMetrics.mockRejectedValue(new Error('db down'));
    const r = await get(dashboardRoute, '/api/analytics/dashboard?workspaceId=ws-A');
    expect(r.status).toBe(500);
    expect((await r.json()).code).toBeUndefined();
  });
  it('an unverified e-mail (403 from the security layer) carries NO lock code', async () => {
    m.verified.mockRejectedValue(new Error('Email verification required'));
    const r = await get(dashboardRoute, '/api/analytics/dashboard?workspaceId=ws-A');
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBeUndefined();
  });
});

describe('page logic — what Starter / advanced plans / errors actually see', () => {
  const lockedBody = { error: 'Advanced analytics is not included in your current plan. Upgrade to unlock it.', code: ADVANCED_ANALYTICS_REQUIRED_CODE };
  const basicOk = classifyBasicResponse(200, { success: true, metrics: BASIC }, 'x');

  it('Starter: Basic loads, Advanced identified refusal -> a usable BASIC page with locked Advanced sections (not an error, not a block)', () => {
    const view = composeAccessView(basicOk, metricsOutcomeToAdvanced(classifyMetricsResponse(403, lockedBody, 'x')));
    expect(view).toEqual({ kind: 'ready', access: 'basic', basic: BASIC, lockedMessage: lockedBody.error });
  });
  it('Starter: the Basic view carries no Advanced field at all', () => {
    const view = composeAccessView(basicOk, metricsOutcomeToAdvanced(classifyMetricsResponse(403, lockedBody, 'x')));
    for (const field of FORBIDDEN_FOR_STARTER) expect(JSON.stringify(view)).not.toContain(`"${field}"`);
  });
  it('Starter, analytics page: overview refusal gives the same Basic view', () => {
    const view = composeAccessView(basicOk, classifyOverviewResponse(403, lockedBody, 'x'));
    expect(view).toMatchObject({ kind: 'ready', access: 'basic', basic: BASIC });
  });
  it('advanced plan: full view, Advanced values passed through untouched', () => {
    const view = composeAccessView(basicOk, metricsOutcomeToAdvanced(classifyMetricsResponse(200, { success: true, metrics: FULL }, 'x')));
    expect(view).toEqual({ kind: 'ready', access: 'advanced', advanced: FULL });
  });
  it('advanced plan: a Basic failure cannot regress the full page', () => {
    const basicDown = classifyBasicResponse(500, { error: 'boom' }, 'x');
    const view = composeAccessView(basicDown, metricsOutcomeToAdvanced(classifyMetricsResponse(200, { success: true, metrics: FULL }, 'x')));
    expect(view).toMatchObject({ kind: 'ready', access: 'advanced' });
  });
  it('analytics page, advanced plan: overview data passes through', () => {
    const overview = classifyOverviewResponse(200, { success: true, revenueTrend: [{ date: 'd', revenue: 1, orders: 1 }], productsPerformance: [], marketplacePerformance: { eBay: { listings: 1, orders: 1, revenue: 1, profit: 1 } } }, 'x');
    const view = composeAccessView(basicOk, overview);
    expect(view).toMatchObject({ kind: 'ready', access: 'advanced', advanced: { revenueTrend: [{ date: 'd' }] } });
  });
  it('server error on Advanced stays a REAL error (even when Basic loaded)', () => {
    const view = composeAccessView(basicOk, metricsOutcomeToAdvanced(classifyMetricsResponse(500, { error: 'Internal server error' }, 'x')));
    expect(view).toEqual({ kind: 'error', message: 'Internal server error' });
  });
  it('network-level failure (no parseable body) is a real error with the caller message', () => {
    const view = composeAccessView(basicOk, classifyOverviewResponse(502, null, 'Failed to load analytics'));
    expect(view).toEqual({ kind: 'error', message: 'Failed to load analytics' });
  });
  it('auth error stays unauthorized (Advanced 401, or Basic 401 while locked)', () => {
    expect(composeAccessView(basicOk, metricsOutcomeToAdvanced(classifyMetricsResponse(401, { error: 'Unauthorized' }, 'x')))).toEqual({ kind: 'unauthorized', message: 'Unauthorized' });
    const basic401 = classifyBasicResponse(401, { error: 'Unauthorized' }, 'x');
    expect(composeAccessView(basic401, metricsOutcomeToAdvanced(classifyMetricsResponse(403, lockedBody, 'x')))).toEqual({ kind: 'unauthorized', message: 'Unauthorized' });
  });
  it('workspace / e-mail 403 without the lock code is a REAL error, never the Basic page', () => {
    const view = composeAccessView(basicOk, metricsOutcomeToAdvanced(classifyMetricsResponse(403, { error: 'Email verification required' }, 'x')));
    expect(view).toEqual({ kind: 'error', message: 'Email verification required' });
  });
  it('locked Advanced + failing Basic -> real error (never an empty "success")', () => {
    const view = composeAccessView(classifyBasicResponse(500, { error: 'Internal server error' }, 'x'), metricsOutcomeToAdvanced(classifyMetricsResponse(403, lockedBody, 'x')));
    expect(view).toEqual({ kind: 'error', message: 'Internal server error' });
  });
  it('Basic classifier: 403 / 404 / malformed 200 are errors (no plan lock exists for Basic)', () => {
    expect(classifyBasicResponse(403, { error: 'nope', code: ADVANCED_ANALYTICS_REQUIRED_CODE }, 'f')).toEqual({ kind: 'error', message: 'nope' });
    expect(classifyBasicResponse(404, null, 'f')).toEqual({ kind: 'error', message: 'f' });
    expect(classifyBasicResponse(200, { success: true }, 'f')).toEqual({ kind: 'error', message: 'f' });
  });
  it('overview classifier: a 200 with missing arrays is normalised, a 403 without the code is an error', () => {
    expect(classifyOverviewResponse(200, { success: true }, 'f')).toEqual({ kind: 'ok', value: { currency: 'EUR', otherCurrencies: [], revenueTrend: [], productsPerformance: [], marketplacePerformance: {} } });
    expect(classifyOverviewResponse(403, { error: 'Email verification required' }, 'f')).toEqual({ kind: 'error', message: 'Email verification required' });
  });
});

describe('no bypass: the plan check lives on the server, in front of every Advanced query', () => {
  it.each(['dashboard', 'overview'])('%s route checks advancedAnalytics before AnalyticsService and answers 403 + code inline', (name) => {
    const src = read(`src/app/api/analytics/${name}/route.ts`);
    const gate = src.indexOf("hasFeature(workspaceId, 'advancedAnalytics')");
    expect(gate).toBeGreaterThan(-1);
    expect(src.indexOf('AnalyticsService.')).toBeGreaterThan(gate);
    expect(src.slice(gate, gate + 400)).toContain('code: ADVANCED_ANALYTICS_REQUIRED_CODE');
    expect(src.slice(gate, gate + 400)).toContain('status: 403');
  });
  it('the Basic route and service never touch an amount column', () => {
    const route = read('src/app/api/analytics/basic/route.ts');
    expect(route).not.toMatch(/totalPrice|estimatedProfit|marketplaceFees|revenue|profit/);
    const service = read('src/services/AnalyticsService.ts');
    const body = service.slice(service.indexOf('static async getBasicMetrics'), service.indexOf('static async getAdminMetrics'));
    expect(body).not.toMatch(/totalPrice|estimatedProfit|marketplaceFees|\.findMany|reduce\(/);
    expect(body.match(/\.count\(/g)).toHaveLength(4);
    expect(body.match(/workspaceId/g)!.length).toBeGreaterThanOrEqual(5); // every counter is workspace-scoped
  });
  it('the three pages fetch Basic and Advanced separately and use the shared composer', () => {
    for (const rel of ['src/app/dashboard/page.tsx', 'src/app/dashboard/analytics/page.tsx', 'src/app/workspace/[slug]/page.tsx']) {
      const src = read(rel);
      expect(src, rel).toContain('/api/analytics/basic');
      expect(src, rel).toContain('composeAccessView(');
    }
  });
  it('the per-currency aggregation (S8) keeps the same profit/margin/net-revenue formulas, now on exact sums', () => {
    const fin = read('src/lib/financial.ts');
    expect(fin).toContain('grossProfit: f(a.profit + (a.fRevenue > 0 ? a.fRevenue - a.fCost : 0))');
    expect(fin).toContain('netRevenue: f(a.revenue + a.fRevenue)');
    expect(fin).toContain('(a.profit / a.knownRevenue) * 100');
  });
});
