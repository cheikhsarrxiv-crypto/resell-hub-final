import { NextRequest, NextResponse } from 'next/server';
import { adminRoute } from '@/lib/admin';
import { AdminMetricsService } from '@/services/AdminMetricsService';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/metrics
 * Get all admin dashboard metrics
 * ADMIN ONLY
 */
export async function GET(request: NextRequest) {
  return adminRoute(request, async () => {
    try {
      // Fetch all metrics (efficient single call)
      const stats = await AdminMetricsService.getAllAdminStats();

      return NextResponse.json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[Admin Metrics] Error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch admin metrics' },
        { status: 500 }
      );
    }
  });
}
