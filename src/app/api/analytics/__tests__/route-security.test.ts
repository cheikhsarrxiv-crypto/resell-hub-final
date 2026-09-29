/**
 * D-2 fix: /api/analytics/overview and /api/analytics/dashboard used to
 * return full analytics data to ANY authenticated workspace, regardless
 * of plan — no call to SubscriptionService.hasFeature('advancedAnalytics')
 * existed anywhere. Source-level checks (same convention as
 * agent-route-security.test.ts — these routes import next/server, which
 * fails to resolve directly in this Vitest setup).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

function readRoute(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

const overviewRoute = readRoute('src/app/api/analytics/overview/route.ts');
const dashboardRoute = readRoute('src/app/api/analytics/dashboard/route.ts');

describe.each([
  ['GET /api/analytics/overview', overviewRoute],
  ['GET /api/analytics/dashboard', dashboardRoute],
])('%s — advancedAnalytics gating', (_label, source) => {
  it('uses the central SubscriptionService.hasFeature entitlement check — never a second/parallel system', () => {
    expect(source).toContain("hasFeature(workspaceId, 'advancedAnalytics')");
  });

  it('checks the feature BEFORE calling AnalyticsService', () => {
    const gateIndex = source.indexOf("hasFeature(workspaceId, 'advancedAnalytics')");
    const serviceCallIndex = source.indexOf('AnalyticsService.');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(serviceCallIndex).toBeGreaterThan(gateIndex);
  });

  it('responds 403 when the feature check fails, without ever reaching AnalyticsService', () => {
    const gateIndex = source.indexOf("hasFeature(workspaceId, 'advancedAnalytics')");
    const nextFewLines = source.slice(gateIndex, gateIndex + 300);
    expect(nextFewLines).toContain('status: 403');
  });

  it('derives workspaceId only from the verified session, never from the request', () => {
    expect(source).toContain('getVerifiedWorkspaceId(request)');
  });
});
