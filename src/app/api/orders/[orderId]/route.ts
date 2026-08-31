import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/OrderService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const order = await OrderService.getOrder(params.orderId, workspaceId);

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    return errorResponse(error);
  }
}
