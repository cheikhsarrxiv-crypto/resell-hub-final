/**
 * Real behavioral tests for get_shipment — a read-only agent tool, same
 * conventions as get_order/get_listing: auto-executable, no confirmation,
 * workspace isolation is the real OrderService.getOrder
 * `findFirst({ id, workspaceId })` boundary (never a bare findUnique by id
 * alone). Reuses OrderService.getOrder as-is (already includes
 * fulfillmentOrder.shipment.trackingEvents) — no new Prisma query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOrderMock } = vi.hoisted(() => ({ getOrderMock: vi.fn() }));

vi.mock('@/services/OrderService', () => ({
  OrderService: { getOrder: getOrderMock },
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getShipmentTool } from '@/services/ai/tools/shipmentTools';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    workspaceId: 'ws-1',
    status: 'shipped',
    fulfillmentType: 'automatic',
    fulfillmentOrder: {
      status: 'shipped',
      partner: { name: 'ShipMock France' },
      externalOrderId: 'FUL-123456',
      shipment: {
        status: 'in_transit',
        carrier: 'La Poste',
        trackingNumber: 'FR123456789',
        trackingUrl: 'https://laposte.fr/track/FR123456789',
        estimatedDelivery: new Date('2026-02-10T00:00:00Z'),
        actualDelivery: null,
        trackingEvents: [
          { status: 'in_transit', location: 'Lyon', description: 'In transit', timestamp: new Date('2026-02-05T10:00:00Z') },
          { status: 'picked_up', location: 'Paris', description: 'Picked up', timestamp: new Date('2026-02-04T08:00:00Z') },
        ],
      },
      ...overrides.fulfillmentOrder,
    },
    ...overrides,
  };
}

describe('get_shipment tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as a read tool — auto-executable, no confirmation', () => {
    const tool = AiToolRegistry.get('get_shipment');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
  });

  it('rejects an input missing orderId', () => {
    expect(getShipmentTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a valid orderId input', () => {
    expect(getShipmentTool.inputSchema.safeParse({ orderId: 'order-1' }).success).toBe(true);
  });

  it('order with a real shipment in the SAME workspace -> full, correct mapping', async () => {
    getOrderMock.mockResolvedValue(makeOrder());

    const result: any = await getShipmentTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.found).toBe(true);
    expect(result.orderStatus).toBe('shipped');
    expect(result.hasShipment).toBe(true);
    expect(result.fulfillment).toEqual({ status: 'shipped', partner: 'ShipMock France', externalOrderId: 'FUL-123456' });
    expect(result.shipment).toEqual({
      status: 'in_transit',
      carrier: 'La Poste',
      trackingNumber: 'FR123456789',
      trackingUrl: 'https://laposte.fr/track/FR123456789',
      estimatedDelivery: '2026-02-10T00:00:00.000Z',
      actualDelivery: null,
    });
    expect(result.trackingEvents).toHaveLength(2);
    expect(result.trackingEvents[0]).toEqual({
      status: 'in_transit',
      location: 'Lyon',
      description: 'In transit',
      timestamp: '2026-02-05T10:00:00.000Z',
    });
    expect(getOrderMock).toHaveBeenCalledWith('order-1', 'ws-1');
  });

  it('unknown order -> controlled { found: false } response, never throws', async () => {
    getOrderMock.mockResolvedValue(null);

    const result: any = await getShipmentTool.handler('ws-1', { orderId: 'does-not-exist' });

    expect(result).toEqual({ found: false });
  });

  it('an order belonging to ANOTHER workspace -> refused, reveals nothing (relies on OrderService.getOrder\'s own workspace-scoped query)', async () => {
    getOrderMock.mockImplementation(async (orderId: string, workspaceId: string) => {
      if (workspaceId !== 'ws-A') return null; // simulates the order being owned by ws-A only
      return makeOrder({ workspaceId: 'ws-A' });
    });

    const result: any = await getShipmentTool.handler('ws-B', { orderId: 'order-1' });

    expect(result).toEqual({ found: false });
    expect(getOrderMock).toHaveBeenCalledWith('order-1', 'ws-B');
  });

  it('a self-fulfilled order (no FulfillmentOrder at all) -> found:true, hasShipment:false, with an explicit reason — never fabricated tracking', async () => {
    getOrderMock.mockResolvedValue(makeOrder({ fulfillmentType: 'self', fulfillmentOrder: null }));

    const result: any = await getShipmentTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.found).toBe(true);
    expect(result.hasShipment).toBe(false);
    expect(result.reason).toMatch(/self-fulfilled/i);
    expect(result.fulfillment).toBeNull();
    expect(result.shipment).toBeNull();
    expect(result.trackingEvents).toEqual([]);
  });

  it('AUDIT: a marketplace-synced order with no FulfillmentOrder still reports its real orderStatus (e.g. "shipped") — never withheld just because no detailed Shipment/tracking exists', async () => {
    getOrderMock.mockResolvedValue(makeOrder({ status: 'delivered', fulfillmentType: 'self', fulfillmentOrder: null }));

    const result: any = await getShipmentTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.orderStatus).toBe('delivered');
    expect(result.hasShipment).toBe(false);
    // orderStatus is a DIFFERENT signal than shipment.status — never conflated.
    expect(result.shipment).toBeNull();
  });

  it('a fulfillment order exists but no shipment has been created yet -> hasShipment:false with a distinct reason, never invented tracking', async () => {
    const order = makeOrder();
    order.fulfillmentOrder.shipment = null;
    getOrderMock.mockResolvedValue(order);

    const result: any = await getShipmentTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.found).toBe(true);
    expect(result.hasShipment).toBe(false);
    expect(result.reason).toMatch(/no shipment has been created/i);
    expect(result.fulfillment).toEqual({ status: 'shipped', partner: 'ShipMock France', externalOrderId: 'FUL-123456' });
    expect(result.shipment).toBeNull();
    expect(result.trackingEvents).toEqual([]);
  });

  it('FulfillmentOrder.externalOrderId is returned as null when genuinely absent, never invented', async () => {
    const order = makeOrder();
    order.fulfillmentOrder.externalOrderId = null;
    getOrderMock.mockResolvedValue(order);

    const result: any = await getShipmentTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.fulfillment.externalOrderId).toBeNull();
  });

  it('optional shipment fields absent -> come back null, never invented (no shipping service/pickup point/label fields exist at all)', async () => {
    const order = makeOrder();
    order.fulfillmentOrder.shipment.carrier = null;
    order.fulfillmentOrder.shipment.trackingNumber = null;
    order.fulfillmentOrder.shipment.trackingUrl = null;
    order.fulfillmentOrder.shipment.estimatedDelivery = null;
    order.fulfillmentOrder.shipment.trackingEvents = [];
    getOrderMock.mockResolvedValue(order);

    const result: any = await getShipmentTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.shipment.carrier).toBeNull();
    expect(result.shipment.trackingNumber).toBeNull();
    expect(result.shipment.trackingUrl).toBeNull();
    expect(result.shipment.estimatedDelivery).toBeNull();
    expect(result.trackingEvents).toEqual([]);
    // Fields that simply don't exist in the data model are never present.
    expect(result.shipment).not.toHaveProperty('service');
    expect(result.shipment).not.toHaveProperty('pickupPoint');
    expect(result.shipment).not.toHaveProperty('shippingLabel');
    expect(result.shipment).not.toHaveProperty('shippedAt');
  });

  it('actualDelivery is returned when a real delivery date is stored', async () => {
    const order = makeOrder();
    order.fulfillmentOrder.status = 'delivered';
    order.fulfillmentOrder.shipment.status = 'delivered';
    order.fulfillmentOrder.shipment.actualDelivery = new Date('2026-02-11T15:00:00Z');
    getOrderMock.mockResolvedValue(order);

    const result: any = await getShipmentTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.shipment.status).toBe('delivered');
    expect(result.shipment.actualDelivery).toBe('2026-02-11T15:00:00.000Z');
  });

  it('is a pure read — calls OrderService.getOrder exactly once, nothing else', async () => {
    getOrderMock.mockResolvedValue(makeOrder());

    await getShipmentTool.handler('ws-1', { orderId: 'order-1' });

    expect(getOrderMock).toHaveBeenCalledTimes(1);
  });

  it('registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('get_shipment')).toBe(getShipmentTool);
  });

  it('classified "read" and auto-executable without confirmation', () => {
    expect(getShipmentTool.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable(getShipmentTool.category)).toBe(true);
  });
});
