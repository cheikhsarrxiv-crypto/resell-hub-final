import { NextRequest, NextResponse } from 'next/server';
import { FulfillmentService } from '@/services/FulfillmentService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';

export async function POST(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const { fulfillmentOrderId, action } = await request.json();

    if (!fulfillmentOrderId || !action) {
      return NextResponse.json(
        { error: 'Fulfillment Order ID and action required' },
        { status: 400 }
      );
    }

    let result;

    switch (action) {
      case 'accept':
        result = await FulfillmentService.simulateOrderAccepted(fulfillmentOrderId, workspaceId);
        break;
      case 'processing':
        result = await FulfillmentService.simulateOrderProcessing(fulfillmentOrderId, workspaceId);
        break;
      case 'ship':
        result = await FulfillmentService.simulateOrderShipped(
          fulfillmentOrderId,
          workspaceId,
          `FR${Date.now().toString().slice(-9)}`,
          'La Poste'
        );
        break;
      case 'deliver':
        result = await FulfillmentService.simulateOrderDelivered(fulfillmentOrderId, workspaceId);
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `Fulfillment order ${action} successfully`,
      result,
    });
  } catch (error) {
    console.error('Fulfillment simulation error:', error);
    return errorResponse(error);
  }
}
