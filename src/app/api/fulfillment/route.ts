import { NextRequest, NextResponse } from 'next/server';
import { FulfillmentService } from '@/services/FulfillmentService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const page = parseInt(request.nextUrl.searchParams.get('page') || '1');
    const status = request.nextUrl.searchParams.get('status') || undefined;
    const days = parseInt(request.nextUrl.searchParams.get('days') || '30');
    const limit = 50;
    const offset = (page - 1) * limit;

    const [{ orders, total }, metrics] = await Promise.all([
      FulfillmentService.getFulfillmentOrders(workspaceId, status, limit, offset),
      FulfillmentService.getFulfillmentMetrics(workspaceId, days),
    ]);

    return NextResponse.json({
      success: true,
      orders,
      metrics,
      pagination: {
        total,
        page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('GET fulfillment error:', error);
    return errorResponse(error);
  }
}
