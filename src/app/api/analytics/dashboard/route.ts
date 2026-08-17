import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsService } from '@/services/AnalyticsService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

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
