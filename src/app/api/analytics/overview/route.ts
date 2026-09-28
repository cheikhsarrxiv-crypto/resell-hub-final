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

    // D-2 fix: this used to return full analytics data to any
    // authenticated workspace regardless of plan — the same central
    // entitlement check every other feature gate in this app already
    // uses, never a second/parallel system.
    const hasAccess = await SubscriptionService.hasFeature(workspaceId, 'advancedAnalytics');
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Advanced analytics is not included in your current plan. Upgrade to unlock it.' },
        { status: 403 }
      );
    }

    const days = parseInt(request.nextUrl.searchParams.get('days') || '30');

    const [revenueTrend, productsPerformance, marketplacePerformance] = await Promise.all([
      AnalyticsService.getRevenueTrend(workspaceId, days),
      AnalyticsService.getProductsPerformance(workspaceId),
      AnalyticsService.getMarketplacePerformance(workspaceId, days),
    ]);

    return NextResponse.json({
      success: true,
      revenueTrend,
      productsPerformance,
      marketplacePerformance,
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    return errorResponse(error);
  }
}
