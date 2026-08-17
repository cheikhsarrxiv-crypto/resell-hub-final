import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsService } from '@/services/AnalyticsService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

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
