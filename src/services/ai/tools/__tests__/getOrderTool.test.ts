/**
 * Real behavioral tests for get_order — a read-only agent tool answering
 * "what's the status of order #X" / "where is my package" (Phase 8 audit:
 * no prior test file exercised getOrderTool's own handler/formatOrderForAgent
 * beyond input-schema/registration checks in ai-tool-registry.test.ts).
 *
 * OrderService.getOrder is exercised for real (only prisma is mocked) so
 * this proves the tool's own real workspace-scoping and shaping of
 * fulfillment/shipment/tracking data — including the Phase 8 enrichment
 * (trackingUrl/estimatedDelivery/actualDelivery/events), all of it real,
 * already-stored fields, never fabricated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { orderFindFirstMock } = vi.hoisted(() => ({ orderFindFirstMock: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: { order: { findFirst: orderFindFirstMock } },
}));

import { getOrderTool } from '@/services/ai/tools/orderTools';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    workspaceId: 'ws-1',
    status: 'processing',
    fulfillmentType: 'automatic',
    marketplace: 'ebay',
    externalOrderId: 'ebay-ext-1',
    customerName: 'Alice Martin',
    customerEmail: 'alice@example.com',
    totalPrice: 449,
    marketplaceFees: 12,
    estimatedProfit: 100,
    shippingCity: 'Paris',
    shippingCountry: 'FR',
    createdAt: new Date('2026-02-05T00:00:00Z'),
    items: [{ title: 'Prada Sneakers', quantity: 1, price: 449, product: { sku: 'SKU-1' } }],
    listing: null,
    fulfillmentOrder: null,
    ...overrides,
  };
}

describe('get_order tool behavior', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered as a read tool — auto-executable, no confirmation', () => {
    expect(AiToolRegistry.get('get_order')).toBe(getOrderTool);
    expect(getOrderTool.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
  });

  it('workspace isolation: the lookup always includes the caller workspaceId — a foreign order id returns not-found, never leaked', async () => {
    orderFindFirstMock.mockResolvedValue(null);

    const result: any = await getOrderTool.handler('ws-A', { orderId: 'order-from-ws-B' });

    expect(orderFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-from-ws-B', workspaceId: 'ws-A' } })
    );
    expect(result.error).toMatch(/not found in this workspace/i);
  });

  it('a real order with no fulfillment yet returns fulfillment: null — never a fabricated status', async () => {
    orderFindFirstMock.mockResolvedValue(makeOrder());

    const result: any = await getOrderTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.status).toBe('processing');
    expect(result.fulfillment).toBeNull();
  });

  it('never reword Order.status itself — "processing" is returned exactly as stored, never upgraded to "shipped"', async () => {
    orderFindFirstMock.mockResolvedValue(makeOrder({ status: 'processing' }));

    const result: any = await getOrderTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.status).toBe('processing');
  });

  it('Phase 8: a real shipment surfaces carrier/trackingNumber/trackingUrl/estimatedDelivery/actualDelivery/events, all real stored fields', async () => {
    const order = makeOrder({
      status: 'shipped',
      fulfillmentOrder: {
        status: 'shipped',
        partner: { name: 'FulfillCo' },
        shipment: {
          carrier: 'La Poste',
          trackingNumber: 'FR123456789',
          trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=FR123456789',
          status: 'in_transit',
          estimatedDelivery: new Date('2026-02-10T00:00:00Z'),
          actualDelivery: null,
          trackingEvents: [
            { status: 'in_transit', location: 'Distribution Center Lyon', description: 'Package in transit', timestamp: new Date('2026-02-06T00:00:00Z') },
            { status: 'picked_up', location: 'Fulfillment Center Paris', description: 'Package picked up', timestamp: new Date('2026-02-05T00:00:00Z') },
          ],
        },
      },
    });
    orderFindFirstMock.mockResolvedValue(order);

    const result: any = await getOrderTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.fulfillment.status).toBe('shipped');
    expect(result.fulfillment.partner).toBe('FulfillCo');
    expect(result.fulfillment.tracking).toEqual({
      carrier: 'La Poste',
      trackingNumber: 'FR123456789',
      trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=FR123456789',
      status: 'in_transit',
      estimatedDelivery: '2026-02-10T00:00:00.000Z',
      actualDelivery: null,
      events: [
        { status: 'in_transit', location: 'Distribution Center Lyon', description: 'Package in transit', timestamp: '2026-02-06T00:00:00.000Z' },
        { status: 'picked_up', location: 'Fulfillment Center Paris', description: 'Package picked up', timestamp: '2026-02-05T00:00:00.000Z' },
      ],
    });
  });

  it('never conflates ORDER status with SHIPMENT status — both are present and independently readable', async () => {
    const order = makeOrder({
      status: 'processing', // the order itself is still only "processing"
      fulfillmentOrder: {
        status: 'shipped',
        partner: { name: 'FulfillCo' },
        shipment: {
          carrier: 'La Poste',
          trackingNumber: 'FR1',
          trackingUrl: null,
          status: 'in_transit', // the SHIPMENT's own distinct status
          estimatedDelivery: null,
          actualDelivery: null,
          trackingEvents: [],
        },
      },
    });
    orderFindFirstMock.mockResolvedValue(order);

    const result: any = await getOrderTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.status).toBe('processing'); // Order.status, untouched
    expect(result.fulfillment.tracking.status).toBe('in_transit'); // Shipment.status, a DIFFERENT real field
  });

  it('a shipment with no tracking events yet returns an empty events array, never fabricated events', async () => {
    const order = makeOrder({
      fulfillmentOrder: {
        status: 'processing',
        partner: { name: 'FulfillCo' },
        shipment: {
          carrier: null,
          trackingNumber: null,
          trackingUrl: null,
          status: 'pending',
          estimatedDelivery: null,
          actualDelivery: null,
          trackingEvents: [],
        },
      },
    });
    orderFindFirstMock.mockResolvedValue(order);

    const result: any = await getOrderTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.fulfillment.tracking.events).toEqual([]);
    expect(result.fulfillment.tracking.trackingNumber).toBeNull();
  });

  it('never leaks a secret/token/apiKey field in its output', async () => {
    orderFindFirstMock.mockResolvedValue(makeOrder());

    const result: any = await getOrderTool.handler('ws-1', { orderId: 'order-1' });

    expect(JSON.stringify(result)).not.toMatch(/apiKey|apiSecret|token|password/i);
  });
});
