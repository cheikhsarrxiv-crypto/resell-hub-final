import { NextRequest, NextResponse } from 'next/server';
import { adminRoute } from '@/lib/admin';
import { AdminMetricsService } from '@/services/AdminMetricsService';

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
