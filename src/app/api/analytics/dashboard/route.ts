import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsService } from '@/services/AnalyticsService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { SubscriptionService } from '@/services/SubscriptionService';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    // D-2 fix: same central entitlement check as overview/route.ts —
    // never a second/parallel entitlements system.
    const hasAccess = await SubscriptionService.hasFeature(workspaceId, 'advancedAnalytics');
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Advanced analytics is not included in your current plan. Upgrade to unlock it.' },
        { status: 403 }
      );
    }

    const days = parseInt(request.nextUrl.searchParams.get('days') || '30');

    const metrics = await AnalyticsService.getDashboardMetrics(workspaceId, days);

    return NextResponse.json({
      success: true,
      metrics,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return errorResponse(error);
  }
}
