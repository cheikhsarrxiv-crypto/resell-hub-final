import { NextRequest, NextResponse } from 'next/server';
import { FulfillmentService } from '@/services/FulfillmentService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';

export async function POST(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const { orderId, partnerId } = await request.json();

    if (!orderId || !partnerId) {
      return NextResponse.json(
        { error: 'Order ID and Partner ID required' },
        { status: 400 }
      );
    }

    const fulfillmentOrder = await FulfillmentService.sendToFulfillment(
      orderId,
      workspaceId,
      partnerId
    );

    return NextResponse.json({
      success: true,
      message: 'Order sent to fulfillment',
      fulfillmentOrder,
    });
  } catch (error) {
    console.error('Fulfillment send error:', error);
    return errorResponse(error);
  }
}
