import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsService } from '@/services/AnalyticsService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { parseAnalyticsDays } from '@/lib/analyticsRange';
import { ADVANCED_ANALYTICS_REQUIRED_CODE, ADVANCED_ANALYTICS_REQUIRED_MESSAGE } from '@/lib/analyticsAccess';
import { SubscriptionService } from '@/services/SubscriptionService';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    // D-2 fix: this used to return full analytics data to any
    // authenticated workspace regardless of plan — the same central
    // entitlement check every other feature gate in this app already
    // uses, never a second/parallel system.
    const hasAccess = await SubscriptionService.hasFeature(workspaceId, 'advancedAnalytics');
    if (!hasAccess) {
      return NextResponse.json(
        { error: ADVANCED_ANALYTICS_REQUIRED_MESSAGE, code: ADVANCED_ANALYTICS_REQUIRED_CODE },
        { status: 403 }
      );
    }

    const days = parseAnalyticsDays(request.nextUrl.searchParams.get('days'));

    // S8: one currency per response (`currency`); orders in other currencies are only counted in
    // `otherCurrencies`, never added in.
    const overview = await AnalyticsService.getOverview(workspaceId, days);

    return NextResponse.json({
      success: true,
      ...overview,
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    return errorResponse(error);
  }
}
