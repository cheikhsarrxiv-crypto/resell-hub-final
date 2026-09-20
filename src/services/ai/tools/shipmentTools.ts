import { z } from 'zod';
import { OrderService } from '@/services/OrderService';
import { AgentToolDefinition } from './types';

const getShipmentInputSchema = z.object({
  orderId: z.string().min(1, 'orderId is required'),
});

/**
 * Real shipping data model (see prisma/schema.prisma): Order (1) ->
 * FulfillmentOrder (0..1, `orderId` is @unique) -> Shipment (0..1,
 * `fulfillmentOrderId` is @unique) -> TrackingEvent[] (0..N). At most ONE
 * Shipment can ever exist per order — the double @unique constraint
 * guarantees it, never assumed here without that guarantee.
 *
 * A self-fulfilled order (Order.fulfillmentType === 'self') has NO
 * FulfillmentOrder at all — this is a normal, common case, not an error,
 * and is reported as such (hasShipment: false, with an explicit reason),
 * never as `found: false` (the order itself does exist).
 *
 * No "shipping service", "pickup point/locker", "shipping label", or a
 * literal "shippedAt" column exists anywhere in this data model — never
 * invented here. `carrier`/`trackingNumber`/`trackingUrl`/
 * `estimatedDelivery`/`actualDelivery`/`status` are the real Shipment
 * columns; TrackingEvent's own `timestamp`s are the real source for
 * "when" something happened, never a fabricated `shippedAt`.
 */
function formatShipmentForAgent(order: NonNullable<Awaited<ReturnType<typeof OrderService.getOrder>>>) {
  const fulfillmentOrder = order.fulfillmentOrder;

  if (!fulfillmentOrder) {
    return {
      orderId: order.id,
      hasShipment: false,
      reason:
        order.fulfillmentType === 'self'
          ? 'This order is self-fulfilled — ADKSY does not track shipment/tracking data for self-fulfilled orders.'
          : 'No fulfillment order exists yet for this order.',
      fulfillment: null,
      shipment: null,
      trackingEvents: [],
    };
  }

  const shipment = fulfillmentOrder.shipment;

  return {
    orderId: order.id,
    hasShipment: Boolean(shipment),
    reason: shipment ? undefined : 'A fulfillment order exists but no shipment has been created for it yet.',
    fulfillment: {
      status: fulfillmentOrder.status,
      partner: fulfillmentOrder.partner.name,
    },
    shipment: shipment
      ? {
          status: shipment.status,
          carrier: shipment.carrier ?? null,
          trackingNumber: shipment.trackingNumber ?? null,
          trackingUrl: shipment.trackingUrl ?? null,
          estimatedDelivery: shipment.estimatedDelivery ? shipment.estimatedDelivery.toISOString() : null,
          actualDelivery: shipment.actualDelivery ? shipment.actualDelivery.toISOString() : null,
        }
      : null,
    trackingEvents: shipment
      ? shipment.trackingEvents.map((event) => ({
          status: event.status,
          location: event.location ?? null,
          description: event.description ?? null,
          timestamp: event.timestamp.toISOString(),
        }))
      : [],
  };
}

export const getShipmentTool: AgentToolDefinition<{ orderId: string }> = {
  name: 'get_shipment',
  description:
    "Look up shipping/tracking information for a single existing order belonging to the reseller's own workspace, by its ADKSY order id — " +
    'to answer factual questions like where a package is, its carrier, tracking number/URL, shipment status, or estimated/actual delivery. ' +
    'Read-only — never contacts a carrier or a marketplace, never modifies an order, never triggers fulfillment, never requires confirmation. ' +
    'A self-fulfilled order or one whose fulfillment order has no shipment yet legitimately has no shipment data — this is reported explicitly ' +
    '(hasShipment: false, with a reason), never fabricated. Only returns fields that are actually stored in ADKSY: there is no shipping service, ' +
    'pickup point/locker, or shipping label field in this system, and no single "shipped at" timestamp — use the real trackingEvents history instead. ' +
    "Returns { found: false } if the order doesn't exist in this workspace — never another workspace's order.",
  category: 'read',
  inputSchema: getShipmentInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      orderId: {
        type: 'string',
        description: 'The ADKSY order id (Order.id), not a marketplace external order id.',
      },
    },
    required: ['orderId'],
  },
  async handler(workspaceId, input) {
    // OrderService.getOrder's `findFirst({ where: { id, workspaceId } })`
    // is the actual isolation boundary — an orderId from another
    // workspace simply matches no row and comes back null, exactly like
    // get_order/get_listing. Already includes fulfillmentOrder.shipment.
    // trackingEvents (ordered by timestamp desc) — no new query needed.
    const order = await OrderService.getOrder(input.orderId, workspaceId);

    if (!order) {
      return { found: false };
    }

    return { found: true, ...formatShipmentForAgent(order) };
  },
};
