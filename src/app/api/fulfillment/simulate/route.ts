import { NextRequest, NextResponse } from 'next/server';
import { FulfillmentService } from '@/services/FulfillmentService';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';

/**
 * What the simulate* service methods return: the bare FulfillmentOrder
 * (accept / processing) or an object wrapping it (ship / deliver, including
 * their replay and lost-race variants, which also carry the shipment and,
 * on the already-delivered replay, the whole Order row).
 */
type SimulatedFulfillmentResult =
  | { id: string; status: string }
  | { fulfillmentOrder: { id: string; status: string } };

/**
 * Public, minimal projection of a simulate result. The dashboard only checks
 * response.ok, so nothing beyond the id and status may reach the browser:
 * no shipment (trackingUrl, ...), no order (recipient email / phone /
 * address), no internal scalars, no alreadyShipped / alreadyDelivered flags.
 */
function toPublicFulfillmentOrder(result: SimulatedFulfillmentResult): { id: string; status: string } {
  const fulfillmentOrder = 'fulfillmentOrder' in result ? result.fulfillmentOrder : result;
  return { id: fulfillmentOrder.id, status: fulfillmentOrder.status };
}

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

    let result: SimulatedFulfillmentResult;

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
      result: {
        fulfillmentOrder: toPublicFulfillmentOrder(result),
      },
    });
  } catch (error) {
    console.error('Fulfillment simulation error:', error);
    return errorResponse(error);
  }
}
