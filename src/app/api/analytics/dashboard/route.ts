import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsService } from '@/services/AnalyticsService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

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
