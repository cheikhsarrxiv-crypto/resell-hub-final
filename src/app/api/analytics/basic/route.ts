import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsService } from '@/services/AnalyticsService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { parseAnalyticsDays } from '@/lib/analyticsRange';

// Session-specific: never statically rendered or cached.
export const dynamic = 'force-dynamic';

/**
 * BASIC analytics - available on every plan (no plan feature gates it, there is none for it): four
 * activity counters, no amounts. The financial/analytical figures stay behind `advancedAnalytics` in
 * /api/analytics/dashboard and /api/analytics/overview.
 *
 * Isolation: the workspace comes only from getVerifiedWorkspaceId (session-verified); the counters are
 * all filtered by that workspaceId. An unverified account, a foreign workspaceId or no session is
 * refused exactly like on every other route (errorResponse), never answered with empty data.
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const days = parseAnalyticsDays(request.nextUrl.searchParams.get('days'));
    const metrics = await AnalyticsService.getBasicMetrics(workspaceId, days);
    return NextResponse.json({ success: true, metrics });
  } catch (error) {
    console.error('Analytics basic error:', error);
    return errorResponse(error);
  }
}
