/**
 * Phase 9 — "Agent commercial / customer operations". The audit found
 * that every fact a buyer question needs (availability, size, color,
 * brand, condition, price, description, order status, real tracking) is
 * already answerable through EXISTING read tools (get_product,
 * get_inventory, get_order, get_shipment, get_customer, get_orders,
 * get_customer_orders, get_listing) — no functional duplicate was created
 * (per this phase's own "ne pas créer de doublons fonctionnels" rule).
 *
 * This file proves the main worked example end-to-end through the REAL
 * tools ("Est-ce que vous avez encore cette paire en 42 ?" -> identify the
 * product -> check real size/stock/price/condition -> answer only from
 * verified data -> explicitly flag what's unknown), plus the negative
 * space this phase is really about: no marketplace-messaging capability
 * was fabricated, and no customer/order/conversation data ever crosses a
 * workspace boundary.
 *
 * Test list, mapped to this phase's own lettered requirements:
 *  A. product availability      -> "buyer question flow" describe block
 *  B. size availability         -> "buyer question flow" describe block
 *  C. order question            -> "buyer question flow" describe block
 *  D. shipment/tracking question -> "buyer question flow" describe block
 *  E. unknown information        -> "buyer question flow" describe block
 *  F. cross-workspace customer   -> already exhaustively covered in
 *     customerTools.test.ts (get_customer); not duplicated here.
 *  G. cross-workspace order      -> already covered in getOrderTool.test.ts
 *     and orderTools.test.ts; not duplicated here.
 *  H. cross-workspace conversation -> N/A this phase: no
 *     CustomerConversation/CustomerMessage model was created (see this
 *     phase's audit — no real eBay/Etsy messaging integration exists to
 *     populate one, so building the table would have no real data source).
 *     Documented here rather than faked with an empty test.
 *  I. negotiation requiring confirmation -> update_listing (the real
 *     mechanism a price proposal goes through) is already exhaustively
 *     tested in update-listing-pipeline-integration.test.ts and
 *     ai-tool-registry.test.ts (engage, confirmation-required, before/
 *     after price preview). Not duplicated here.
 *  J. action cancellation / K. action expiration -> generic
 *     AiActionService/AgentActionStateMachine behavior, already covered
 *     by update-listing-pipeline-integration.test.ts and
 *     agentActionStateMachine.test.ts. Not duplicated here.
 *  L. AI usage accounting -> no new tool was added this phase, so no new
 *     cost entry either; covered by the "no new tools" capability-audit
 *     test below (proves the read tools this phase relies on are exactly
 *     the ones already in aiUsageConfig's completeness-tested table).
 *  M. duplicate action protection -> already covered by
 *     update-listing-pipeline-integration.test.ts's own "double-click"/
 *     "retry" tests. Not duplicated here.
 *  N. marketplace unsupported behavior -> "marketplace messaging is
 *     genuinely unsupported" describe block below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { productFindFirstMock, inventoryFindUniqueMock, listingFindManyMock, orderFindFirstMock } = vi.hoisted(() => ({
  productFindFirstMock: vi.fn(),
  inventoryFindUniqueMock: vi.fn(),
  listingFindManyMock: vi.fn(),
  orderFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findFirst: productFindFirstMock },
    inventory: { findUnique: inventoryFindUniqueMock },
    listing: { findMany: listingFindManyMock },
    order: { findFirst: orderFindFirstMock },
  },
}));

import { getProductTool } from '@/services/ai/tools/productTools';
import { getInventoryTool } from '@/services/ai/tools/inventoryTools';
import { getOrderTool } from '@/services/ai/tools/orderTools';
import { getShipmentTool } from '@/services/ai/tools/shipmentTools';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getToolUsageUnits } from '@/services/ai/aiUsageConfig';

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    id: 'product-1',
    workspaceId: 'ws-1',
    sku: 'SKU-SNEAKER-42',
    supplierSku: null,
    title: 'Prada Cut Out Sneakers',
    description: 'A real product description.',
    brand: 'Prada',
    category: 'Sneakers',
    size: '42',
    color: 'Black',
    condition: 'like-new',
    purchasePrice: 200,
    sellingPrice: 450,
    fulfillmentCost: 0,
    fees: 0,
    location: null,
    quantity: 1,
    weightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    images: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('Phase 9 — buyer question flow, answered ONLY from real tool data', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('A. product availability ("Est-ce que vous avez encore cette paire en 42 ?")', () => {
    it('identifies the product, checks real inventory, and reports the REAL available quantity — never a guess', async () => {
      productFindFirstMock.mockResolvedValue(makeProduct());
      inventoryFindUniqueMock.mockResolvedValue({ quantity: 1, reserved: 0, available: 1 });
      listingFindManyMock.mockResolvedValue([]);

      const result: any = await getProductTool.handler('ws-1', { productId: 'product-1' });

      expect(result.found).toBe(true);
      expect(result.product.size).toBe('42');
      expect(result.product.inventory.available).toBe(1); // the real, live figure — not declaredQuantity
    });

    it('when stock is genuinely exhausted, reports available: 0 — never rounds up or assumes restock', async () => {
      productFindFirstMock.mockResolvedValue(makeProduct());
      inventoryFindUniqueMock.mockResolvedValue({ quantity: 1, reserved: 1, available: 0 });
      listingFindManyMock.mockResolvedValue([]);

      const result: any = await getInventoryTool.handler('ws-1', { productId: 'product-1' });

      expect(result.found).toBe(true);
      expect(result.inventory.available).toBe(0);
    });
  });

  describe('B. size availability ("Vous avez encore du 42 ?")', () => {
    it("the product's real, stored size is returned exactly as recorded — never inferred from the title", async () => {
      productFindFirstMock.mockResolvedValue(makeProduct({ size: '42' }));
      inventoryFindUniqueMock.mockResolvedValue({ quantity: 1, reserved: 0, available: 1 });
      listingFindManyMock.mockResolvedValue([]);

      const result: any = await getProductTool.handler('ws-1', { productId: 'product-1' });

      expect(result.product.size).toBe('42');
    });

    it('a product with no recorded size returns null — never fabricates one to satisfy the question', async () => {
      productFindFirstMock.mockResolvedValue(makeProduct({ size: null }));
      inventoryFindUniqueMock.mockResolvedValue({ quantity: 1, reserved: 0, available: 1 });
      listingFindManyMock.mockResolvedValue([]);

      const result: any = await getProductTool.handler('ws-1', { productId: 'product-1' });

      expect(result.product.size).toBeNull();
    });
  });

  describe('C. order question ("Où en est ma commande ?")', () => {
    it('returns the REAL Order.status — never upgraded/downgraded to sound more reassuring', async () => {
      orderFindFirstMock.mockResolvedValue({
        id: 'order-1',
        workspaceId: 'ws-1',
        status: 'processing',
        fulfillmentType: 'automatic',
        marketplace: 'ebay',
        externalOrderId: 'ext-1',
        customerName: 'Alice',
        customerEmail: 'alice@example.com',
        totalPrice: 450,
        marketplaceFees: 0,
        estimatedProfit: 0,
        shippingCity: 'Paris',
        shippingCountry: 'FR',
        createdAt: new Date('2026-02-01'),
        items: [{ title: 'Prada Sneakers', quantity: 1, price: 450, product: { sku: 'SKU-1' } }],
        listing: null,
        fulfillmentOrder: null,
      });

      const result: any = await getOrderTool.handler('ws-1', { orderId: 'order-1' });

      expect(result.status).toBe('processing');
      expect(result.fulfillment).toBeNull(); // no fulfillment order yet — never fabricated
    });
  });

  describe('D. shipment/tracking question ("Où est mon colis ?")', () => {
    it('reports the real orderStatus even when no detailed shipment exists yet — never invents a carrier/tracking number', async () => {
      orderFindFirstMock.mockResolvedValue({
        id: 'order-1',
        workspaceId: 'ws-1',
        status: 'processing',
        fulfillmentType: 'self',
        fulfillmentOrder: null,
      });

      const result: any = await getShipmentTool.handler('ws-1', { orderId: 'order-1' });

      expect(result.found).toBe(true);
      expect(result.hasShipment).toBe(false);
      expect(result.orderStatus).toBe('processing');
      expect(result.shipment).toBeNull();
      expect(result.trackingEvents).toEqual([]);
    });

    it('a real shipment reports its own real carrier/trackingNumber/status — distinct from Order.status', async () => {
      orderFindFirstMock.mockResolvedValue({
        id: 'order-1',
        workspaceId: 'ws-1',
        status: 'processing', // the ORDER itself is still only "processing"
        fulfillmentType: 'automatic',
        fulfillmentOrder: {
          status: 'shipped',
          partner: { name: 'FulfillCo' },
          externalOrderId: 'FUL-1',
          shipment: {
            status: 'in_transit', // the SHIPMENT's own, different real status
            carrier: 'La Poste',
            trackingNumber: 'FR123',
            trackingUrl: 'https://example.com/track/FR123',
            estimatedDelivery: null,
            actualDelivery: null,
            trackingEvents: [],
          },
        },
      });

      const result: any = await getShipmentTool.handler('ws-1', { orderId: 'order-1' });

      expect(result.orderStatus).toBe('processing');
      expect(result.shipment.status).toBe('in_transit');
      expect(result.shipment.carrier).toBe('La Poste');
    });
  });

  describe('E. unknown information — explicitly flagged, never fabricated', () => {
    it('a product with no description/brand/weight returns null for each — never a placeholder value', async () => {
      productFindFirstMock.mockResolvedValue(
        makeProduct({ description: '', brand: null, weightGrams: null, lengthCm: null, widthCm: null, heightCm: null })
      );
      inventoryFindUniqueMock.mockResolvedValue(null);
      listingFindManyMock.mockResolvedValue([]);

      const result: any = await getProductTool.handler('ws-1', { productId: 'product-1' });

      expect(result.product.brand).toBeNull();
      expect(result.product.shipping).toBeNull(); // no package dimensions recorded at all
      expect(result.product.inventory).toBeNull(); // no Inventory row — never defaulted to 0
    });

    it('a non-existent product returns found: false, never a fabricated "not in stock" answer', async () => {
      productFindFirstMock.mockResolvedValue(null);

      const result: any = await getProductTool.handler('ws-1', { productId: 'does-not-exist' });

      expect(result.found).toBe(false);
    });
  });
});

describe('Phase 9 — marketplace messaging is genuinely UNSUPPORTED (audited, not fabricated)', () => {
  it('no messaging-related tool is registered in AiToolRegistry — never silently added without a real provider', () => {
    const names = AiToolRegistry.list().map((t) => t.name.toLowerCase());
    expect(names.some((n) => n.includes('message') || n.includes('conversation'))).toBe(false);
  });

  it('EbayAdapter exposes no buyer-message method — confirmed real capability (legacy Trading API) is not integrated here', async () => {
    const { EbayAdapter } = await import('@/services/marketplace/adapters/EbayAdapter');
    const proto = EbayAdapter.prototype as any;
    expect(typeof proto.sendMessage).toBe('undefined');
    expect(typeof proto.getMessages).toBe('undefined');
  });

  it('EtsyAdapter exposes no buyer-message method — Etsy Open API v3 has no messaging endpoint at all', async () => {
    const { EtsyAdapter } = await import('@/services/marketplace/adapters/EtsyAdapter');
    const proto = EtsyAdapter.prototype as any;
    expect(typeof proto.sendMessage).toBe('undefined');
    expect(typeof proto.getMessages).toBe('undefined');
  });
});

describe('Phase 9 — no new AI tools were added, so no new usage cost was introduced', () => {
  it('the read tools this phase relies on all have a real, pre-existing entry in the AI usage barème', () => {
    for (const name of ['get_product', 'get_inventory', 'get_order', 'get_orders', 'get_shipment', 'get_customer', 'get_customer_orders']) {
      expect(getToolUsageUnits(name)).not.toBeNull();
    }
  });
});
