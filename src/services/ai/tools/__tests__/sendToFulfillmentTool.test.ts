/**
 * Real behavioral tests for send_to_fulfillment — an 'engage' agent action
 * (never auto-executed, always goes through AiActionService's
 * propose -> preview -> confirm -> execute pipeline, see
 * send-to-fulfillment-pipeline-integration.test.ts for the full end-to-end
 * version). These tests exercise the tool's preview()/handler() directly,
 * mocking OrderService.getOrder, FulfillmentService.sendToFulfillment,
 * SubscriptionService.hasFeature, and prisma.fulfillmentPartner — the SAME
 * real methods the human-facing dashboard flow (/api/fulfillment/send)
 * already uses, never reimplemented here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOrderMock, sendToFulfillmentMock, hasFeatureMock, partnerFindUniqueMock, partnerFindManyMock } = vi.hoisted(() => ({
  getOrderMock: vi.fn(),
  sendToFulfillmentMock: vi.fn(),
  hasFeatureMock: vi.fn(),
  partnerFindUniqueMock: vi.fn(),
  partnerFindManyMock: vi.fn(),
}));

vi.mock('@/services/OrderService', () => ({
  OrderService: { getOrder: getOrderMock },
}));

vi.mock('@/services/FulfillmentService', () => ({
  FulfillmentService: { sendToFulfillment: sendToFulfillmentMock },
}));

vi.mock('@/services/SubscriptionService', () => ({
  SubscriptionService: { hasFeature: hasFeatureMock },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fulfillmentPartner: { findUnique: partnerFindUniqueMock, findMany: partnerFindManyMock },
  },
}));

// actionTools.ts also imports these — mocked minimally so the module loads;
// this file never exercises publish_listing/publish_etsy_listing/update_listing.
vi.mock('@/services/ListingService', () => ({
  ListingService: { getListing: vi.fn(), updateListing: vi.fn() },
  getAuthenticatedAdapter: vi.fn(),
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { sendToFulfillmentTool } from '@/services/ai/tools/actionTools';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    workspaceId: 'ws-1',
    status: 'pending',
    fulfillmentType: 'self',
    fulfillmentOrder: null,
    items: [{ productId: 'product-1', title: 'Prada Sneakers', quantity: 1, price: 449 }],
    ...overrides,
  };
}

function makePartner(overrides: Record<string, any> = {}) {
  return {
    id: 'partner-1',
    name: 'ShipMock France',
    country: 'FR',
    status: 'active',
    costPerOrder: 5,
    costPerKg: 2,
    processingTime: 24,
    deliveryTime: 48,
    apiKey: 'real-partner-secret-key',
    ...overrides,
  };
}

describe('send_to_fulfillment tool definition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasFeatureMock.mockResolvedValue(true);
    partnerFindManyMock.mockResolvedValue([makePartner()]);
  });

  it('is registered in AiToolRegistry as an engage tool — never auto-executed', () => {
    const tool = AiToolRegistry.get('send_to_fulfillment');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('engage');
    expect(AiToolRegistry.isAutoExecutable('engage')).toBe(false);
  });

  describe('preview() — no mutation ever happens here', () => {
    it('1. builds a real proposal with order/partner info, auto-resolving the single active partner', async () => {
      getOrderMock.mockResolvedValue(makeOrder());

      const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1' });

      expect(result.orderId).toBe('order-1');
      expect(result.partner).toEqual({ id: 'partner-1', name: 'ShipMock France', country: 'FR', costPerOrder: 5, processingTime: 24, deliveryTime: 48 });
      expect(sendToFulfillmentMock).not.toHaveBeenCalled();
    });

    it('never leaks the partner apiKey', async () => {
      getOrderMock.mockResolvedValue(makeOrder());

      const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1' });

      expect(JSON.stringify(result)).not.toContain('real-partner-secret-key');
    });

    it('2. never calls FulfillmentService.sendToFulfillment (no mutation during proposal)', async () => {
      getOrderMock.mockResolvedValue(makeOrder());

      await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1' });

      expect(sendToFulfillmentMock).not.toHaveBeenCalled();
    });

    it('3. unknown order -> controlled error, never throws', async () => {
      getOrderMock.mockResolvedValue(null);

      const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'does-not-exist' });

      expect(result.error).toMatch(/not found/i);
    });

    it('4. an order belonging to another workspace is refused (relies on OrderService.getOrder\'s own workspace-scoped query)', async () => {
      getOrderMock.mockImplementation(async (orderId: string, workspaceId: string) => (workspaceId === 'ws-A' ? makeOrder() : null));

      const result: any = await sendToFulfillmentTool.preview!('ws-B', { orderId: 'order-1' });

      expect(result.error).toMatch(/not found/i);
      expect(getOrderMock).toHaveBeenCalledWith('order-1', 'ws-B');
    });

    it('5. surfaces the real order status honestly — cancelled/failed orders are not blocked by a rule the real service does not enforce', async () => {
      getOrderMock.mockResolvedValue(makeOrder({ status: 'cancelled' }));

      const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1' });

      expect(result.error).toBeUndefined();
      expect(result.orderStatus).toBe('cancelled');
    });

    it('6. an order that already has a FulfillmentOrder is flagged, never hidden', async () => {
      getOrderMock.mockResolvedValue(makeOrder({ fulfillmentOrder: { id: 'fo-1', status: 'processing', partner: { name: 'ShipMock France' } } }));

      const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1' });

      expect(result.alreadyHasFulfillmentOrder).toBe(true);
      expect(result.message).toMatch(/already has a fulfillment order/i);
    });

    it('7. plan without fulfillment access is surfaced honestly', async () => {
      hasFeatureMock.mockResolvedValue(false);
      getOrderMock.mockResolvedValue(makeOrder());

      const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1' });

      expect(result.fulfillmentEnabledForPlan).toBe(false);
      expect(result.message).toMatch(/does not include fulfillment/i);
    });

    it('8. no active partner configured -> controlled error, never a fabricated default partner', async () => {
      partnerFindManyMock.mockResolvedValue([]);
      getOrderMock.mockResolvedValue(makeOrder());

      const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1' });

      expect(result.error).toMatch(/no active fulfillment partner/i);
    });

    it('9. multiple active partners -> refuses to guess, asks for partnerId explicitly', async () => {
      partnerFindManyMock.mockResolvedValue([makePartner({ id: 'partner-1' }), makePartner({ id: 'partner-2', name: 'Other Partner' })]);
      getOrderMock.mockResolvedValue(makeOrder());

      const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1' });

      expect(result.error).toMatch(/multiple fulfillment partners/i);
    });

    it('an explicit partnerId is resolved directly, bypassing auto-resolution', async () => {
      partnerFindUniqueMock.mockResolvedValue(makePartner({ id: 'partner-explicit' }));
      getOrderMock.mockResolvedValue(makeOrder());

      const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1', partnerId: 'partner-explicit' });

      expect(result.partner.id).toBe('partner-explicit');
      expect(partnerFindManyMock).not.toHaveBeenCalled();
    });

    it('an inactive explicit partnerId is refused', async () => {
      partnerFindUniqueMock.mockResolvedValue(makePartner({ status: 'inactive' }));
      getOrderMock.mockResolvedValue(makeOrder());

      const result: any = await sendToFulfillmentTool.preview!('ws-1', { orderId: 'order-1', partnerId: 'partner-1' });

      expect(result.error).toMatch(/not found or not active/i);
    });
  });

  describe('handler() — the real execution, only ever reached after confirmation', () => {
    it('10. calls FulfillmentService.sendToFulfillment with exactly orderId/workspaceId/partnerId', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockResolvedValue({ id: 'fo-1', status: 'pending' });

      await sendToFulfillmentTool.handler('ws-1', { orderId: 'order-1' });

      expect(sendToFulfillmentMock).toHaveBeenCalledWith('order-1', 'ws-1', 'partner-1');
    });

    it('11. returns a structured success result', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockResolvedValue({ id: 'fo-1', status: 'pending' });

      const result: any = await sendToFulfillmentTool.handler('ws-1', { orderId: 'order-1' });

      expect(result).toEqual({ success: true, fulfillmentOrderId: 'fo-1', orderId: 'order-1', partner: 'ShipMock France', status: 'pending' });
    });

    it('12. unknown order -> controlled error, never calls sendToFulfillment', async () => {
      getOrderMock.mockResolvedValue(null);

      const result: any = await sendToFulfillmentTool.handler('ws-1', { orderId: 'does-not-exist' });

      expect(result.error).toMatch(/not found/i);
      expect(sendToFulfillmentMock).not.toHaveBeenCalled();
    });

    it('13. plan gate refusal is propagated as a clear, controlled business error', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockRejectedValue(new Error('Fulfillment is not included in your current plan'));

      const result: any = await sendToFulfillmentTool.handler('ws-1', { orderId: 'order-1' });

      expect(result).toEqual({ error: 'Fulfillment is not included in your current plan' });
    });

    it('14. "already created" refusal is propagated as a clear, controlled business error — no duplicate ever attempted', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockRejectedValue(new Error('Fulfillment order already created'));

      const result: any = await sendToFulfillmentTool.handler('ws-1', { orderId: 'order-1' });

      expect(result).toEqual({ error: 'Fulfillment order already created' });
    });

    it('15. "order not found" refusal (race between preview and confirm) is a controlled business error', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockRejectedValue(new Error('Order not found'));

      const result: any = await sendToFulfillmentTool.handler('ws-1', { orderId: 'order-1' });

      expect(result).toEqual({ error: 'Order not found' });
    });

    it('16. "partner not found" refusal is a controlled business error', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockRejectedValue(new Error('Fulfillment partner not found'));

      const result: any = await sendToFulfillmentTool.handler('ws-1', { orderId: 'order-1' });

      expect(result).toEqual({ error: 'Fulfillment partner not found' });
    });

    it('17. an UNEXPECTED error (e.g. a lost race against the DB unique constraint) propagates unmodified, never masked as a known business error', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockRejectedValue(
        new Error('Unique constraint failed on the fields: (`orderId`)')
      );

      await expect(sendToFulfillmentTool.handler('ws-1', { orderId: 'order-1' })).rejects.toThrow(
        'Unique constraint failed on the fields: (`orderId`)'
      );
    });

    it('18. never calls any simulate* fulfillment lifecycle method', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockResolvedValue({ id: 'fo-1', status: 'pending' });

      await sendToFulfillmentTool.handler('ws-1', { orderId: 'order-1' });

      // Structural guarantee: the handler's only call into FulfillmentService
      // is sendToFulfillment (mocked in isolation above) — no simulate* export
      // is even imported by this tool.
      expect(sendToFulfillmentMock).toHaveBeenCalledTimes(1);
    });

    it('19. no secret/token ever appears in the output', async () => {
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockResolvedValue({ id: 'fo-1', status: 'pending' });

      const result: any = await sendToFulfillmentTool.handler('ws-1', { orderId: 'order-1' });
      const serialized = JSON.stringify(result);

      expect(serialized).not.toMatch(/apiKey|apiSecret|token|secret|password/i);
    });

    it('an explicit partnerId is passed through to the real service', async () => {
      partnerFindUniqueMock.mockResolvedValue(makePartner({ id: 'partner-explicit', name: 'Explicit Partner' }));
      getOrderMock.mockResolvedValue(makeOrder());
      sendToFulfillmentMock.mockResolvedValue({ id: 'fo-1', status: 'pending' });

      await sendToFulfillmentTool.handler('ws-1', { orderId: 'order-1', partnerId: 'partner-explicit' });

      expect(sendToFulfillmentMock).toHaveBeenCalledWith('order-1', 'ws-1', 'partner-explicit');
    });
  });

  describe('input validation', () => {
    it('rejects a request with no orderId', () => {
      expect(sendToFulfillmentTool.inputSchema.safeParse({}).success).toBe(false);
    });

    it('accepts orderId alone', () => {
      expect(sendToFulfillmentTool.inputSchema.safeParse({ orderId: 'order-1' }).success).toBe(true);
    });

    it('accepts orderId + partnerId', () => {
      expect(sendToFulfillmentTool.inputSchema.safeParse({ orderId: 'order-1', partnerId: 'partner-1' }).success).toBe(true);
    });
  });

  it('20. registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('send_to_fulfillment')).toBe(sendToFulfillmentTool);
  });

  it('21. classified "engage"', () => {
    expect(sendToFulfillmentTool.category).toBe('engage');
  });

  it('22. never auto-executable — always requires confirmation', () => {
    expect(AiToolRegistry.isAutoExecutable(sendToFulfillmentTool.category)).toBe(false);
  });
});
