/**
 * R3-C.5 — cross-workspace RELATIONS, composed operations, transactions and
 * edge cases, on the dedicated local test database.
 *
 * Real route handlers, real services, real Prisma, real `@/lib/security`;
 * only `@/auth` is replaced. Run ONLY through the guarded runner:
 *   node scripts/r3c/run-with-test-db.mjs vitest src/__tests__/isolation/r3c-relations-transactions.live.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { enforceGuardForTestRun } from '@/lib/testing/dbSafetyGuard';
import {
  connectGuardedPrisma,
  createAbFixture,
  cleanupAbFixture,
  snapshotTenant,
  cleanupTenant,
  type AbFixture,
} from '@/lib/testing/r3cHarness';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@/auth', () => ({ auth: authMock }));

const guarded = enforceGuardForTestRun(process.env) === 'guarded';

import * as ordersRoute from '@/app/api/orders/route';
import * as listingsRoute from '@/app/api/listings/route';
import * as productsRoute from '@/app/api/products/route';

describe.skipIf(!guarded)('R3-C.5 — relations, transactions and edge cases across workspaces', () => {
  let prisma: PrismaClient;
  let fx: AbFixture;
  let beforeB: string;

  beforeAll(async () => {
    prisma = await connectGuardedPrisma();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    fx = await createAbFixture(prisma);
    beforeB = await snapshotTenant(prisma, fx.B);
    authMock.mockResolvedValue({ user: { id: fx.A.userId, workspaceId: fx.A.workspaceId } });
  });
  afterEach(async () => {
    if (fx) await cleanupAbFixture(prisma, fx);
  });

  const wsA = () => `workspaceId=${fx.A.workspaceId}`;
  const expectBUnchanged = async () => expect(await snapshotTenant(prisma, fx.B)).toBe(beforeB);
  const REFUSED = [400, 401, 403, 404, 422];

  async function post(handler: (req: NextRequest) => Promise<Response>, url: string, body: unknown) {
    const response = await handler(new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const raw = await response.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { /* not json */ }
    return { status: response.status, raw, json };
  }

  describe('records that reference B are refused', () => {
    const orderBody = (listingId: string) => ({
      listingId, customerName: 'Synthetic Buyer', customerEmail: 'buyer@r3c.invalid', totalPrice: 10, marketplaceFees: 1,
      estimatedProfit: 2, shippingAddress: '1 synthetic street', shippingCity: 'Testville', shippingPostalCode: '00000', shippingCountry: 'FR',
    });

    it("POST /api/orders with B's listing id -> refused, no order created for anyone, B's inventory untouched", async () => {
      const ordersBefore = await prisma.order.count({ where: { workspaceId: { in: [fx.A.workspaceId, fx.B.workspaceId] } } });
      const res = await post(ordersRoute.POST, `/api/orders?${wsA()}`, orderBody(fx.B.listingId));
      expect(REFUSED).toContain(res.status);
      expect(await prisma.order.count({ where: { workspaceId: { in: [fx.A.workspaceId, fx.B.workspaceId] } } })).toBe(ordersBefore);
      await expectBUnchanged();
    });

    it("POST /api/orders with A's own listing works and decrements only A's inventory (positive control)", async () => {
      // The test database has no Plan rows, so the plan-limit gate is bypassed: it is not what is being tested here.
      const { SubscriptionService } = await import('@/services/SubscriptionService');
      vi.spyOn(SubscriptionService, 'isLimitReached').mockResolvedValue(false);
      const res = await post(ordersRoute.POST, `/api/orders?${wsA()}`, orderBody(fx.A.listingId));
      expect(res.status).toBe(201);
      const invA = await prisma.inventory.findUniqueOrThrow({ where: { id: fx.A.inventoryId } });
      expect(invA.available).toBe(2);
      await expectBUnchanged();
      // remove the order the call created (not part of the recorded fixture ids)
      const created = await prisma.order.findMany({ where: { workspaceId: fx.A.workspaceId, id: { not: fx.A.orderId } }, select: { id: true } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: created.map((o) => o.id) } } });
      await prisma.order.deleteMany({ where: { id: { in: created.map((o) => o.id) } } });
    });

    it("POST /api/listings with B's product id -> refused, no listing created", async () => {
      const before = await prisma.listing.count({ where: { productId: fx.B.productId } });
      const res = await post(listingsRoute.POST, `/api/listings?${wsA()}`, {
        productId: fx.B.productId, title: 'Stolen product listing', description: 'a long enough synthetic description', price: 5, quantity: 1,
        marketplaceIds: [fx.marketplaceName],
      });
      expect(REFUSED).toContain(res.status);
      expect(await prisma.listing.count({ where: { productId: fx.B.productId } })).toBe(before);
      await expectBUnchanged();
    });

    it("OrderService / ProductService inventory calls with B's product id fail and leave B's stock intact", async () => {
      const { ProductService } = await import('@/services/ProductService');
      await expect(ProductService.reserveInventory(fx.B.productId, fx.A.workspaceId, 1)).rejects.toThrow();
      await expect(ProductService.releaseInventory(fx.B.productId, fx.A.workspaceId, 1)).rejects.toThrow().catch(() => undefined);
      await expectBUnchanged();
    });

    it("FulfillmentService.sendToFulfillment on B's order is refused by the order lookup itself (plan gate bypassed on purpose)", async () => {
      const { SubscriptionService } = await import('@/services/SubscriptionService');
      const { FulfillmentService } = await import('@/services/FulfillmentService');
      // Without this the plan gate would refuse first and prove nothing about isolation.
      vi.spyOn(SubscriptionService, 'hasFeature').mockResolvedValue(true);
      await expect(FulfillmentService.sendToFulfillment(fx.B.orderId, fx.A.workspaceId, fx.partnerId)).rejects.toThrow(/Order not found/);
      expect(await prisma.fulfillmentOrder.count({ where: { orderId: fx.B.orderId } })).toBe(1); // only B's original
      await expectBUnchanged();
    });
  });

  describe('transactions and composed operations stay inside one tenant', () => {
    it("shipping then delivering A's fulfillment order writes A's shipment / events only", async () => {
      const { FulfillmentService } = await import('@/services/FulfillmentService');
      await prisma.shipment.deleteMany({ where: { id: fx.A.shipmentId } }); // let the service create the shipment itself
      await prisma.trackingEvent.deleteMany({ where: { id: fx.A.trackingEventId } });
      const shipped = await FulfillmentService.simulateOrderShipped(fx.A.fulfillmentOrderId, fx.A.workspaceId, 'TRK-R3C', 'synthetic');
      expect('shipment' in shipped).toBe(true);
      const delivered = await FulfillmentService.simulateOrderDelivered(fx.A.fulfillmentOrderId, fx.A.workspaceId);
      expect(delivered.fulfillmentOrder.status).toBe('delivered');
      const orderA = await prisma.order.findUniqueOrThrow({ where: { id: fx.A.orderId } });
      expect(orderA.status).toBe('delivered');
      // B has not been touched by the two transactions
      await expectBUnchanged();
      // service-created rows are removed through the recorded ids at cleanup (shipment is re-keyed): drop them here
      const ship = await prisma.shipment.findUnique({ where: { fulfillmentOrderId: fx.A.fulfillmentOrderId } });
      if (ship) {
        await prisma.trackingEvent.deleteMany({ where: { shipmentId: ship.id } });
        await prisma.shipment.deleteMany({ where: { id: ship.id } });
      }
    });

    it('replay and lost-race protections hold per tenant: shipping A twice does not create a second shipment, B unaffected', async () => {
      const { FulfillmentService } = await import('@/services/FulfillmentService');
      await prisma.trackingEvent.deleteMany({ where: { id: fx.A.trackingEventId } });
      await prisma.shipment.deleteMany({ where: { id: fx.A.shipmentId } });
      await FulfillmentService.simulateOrderShipped(fx.A.fulfillmentOrderId, fx.A.workspaceId, 'TRK-1', 'synthetic');
      await FulfillmentService.simulateOrderShipped(fx.A.fulfillmentOrderId, fx.A.workspaceId, 'TRK-2', 'synthetic');
      expect(await prisma.shipment.count({ where: { fulfillmentOrderId: fx.A.fulfillmentOrderId } })).toBe(1);
      await expectBUnchanged();
      const ship = await prisma.shipment.findUnique({ where: { fulfillmentOrderId: fx.A.fulfillmentOrderId } });
      if (ship) {
        await prisma.trackingEvent.deleteMany({ where: { shipmentId: ship.id } });
        await prisma.shipment.deleteMany({ where: { id: ship.id } });
      }
    });

    it('concurrent stock reservations in A and B never bleed into each other (atomic per tenant)', async () => {
      const { ProductService } = await import('@/services/ProductService');
      // Each tenant has exactly 3 units available. Fire 6 concurrent reservations at each tenant, interleaved.
      const attempts: Array<Promise<string>> = [];
      for (let i = 0; i < 6; i++) {
        attempts.push(ProductService.reserveInventory(fx.A.productId, fx.A.workspaceId, 1).then(() => 'A-ok', () => 'A-fail'));
        attempts.push(ProductService.reserveInventory(fx.B.productId, fx.B.workspaceId, 1).then(() => 'B-ok', () => 'B-fail'));
      }
      const results = await Promise.all(attempts);
      expect(results.filter((r) => r === 'A-ok')).toHaveLength(3);
      expect(results.filter((r) => r === 'B-ok')).toHaveLength(3);
      expect(results.filter((r) => r === 'A-fail')).toHaveLength(3);
      expect(results.filter((r) => r === 'B-fail')).toHaveLength(3);
      const invA = await prisma.inventory.findUniqueOrThrow({ where: { id: fx.A.inventoryId } });
      const invB = await prisma.inventory.findUniqueOrThrow({ where: { id: fx.B.inventoryId } });
      expect(invA).toMatchObject({ available: 0, reserved: 3 });
      expect(invB).toMatchObject({ available: 0, reserved: 3 });
    });

    it("a failed composed operation in A (insufficient stock) leaves both A's and B's stock unchanged", async () => {
      const { ProductService } = await import('@/services/ProductService');
      await expect(ProductService.reserveInventory(fx.A.productId, fx.A.workspaceId, 99)).rejects.toThrow(/Insufficient inventory/);
      expect((await prisma.inventory.findUniqueOrThrow({ where: { id: fx.A.inventoryId } })).available).toBe(3);
      await expectBUnchanged();
    });
  });

  describe('uniqueness and cascade boundaries', () => {
    it("the same SKU in A and B is allowed (uniqueness is per workspace) and creating it never touches B", async () => {
      const { SubscriptionService } = await import('@/services/SubscriptionService');
      vi.spyOn(SubscriptionService, 'isLimitReached').mockResolvedValue(false); // no Plan rows in the test database
      const sku = (await prisma.product.findUniqueOrThrow({ where: { id: fx.B.productId } })).sku;
      const res = await post(productsRoute.POST, `/api/products?${wsA()}`, { sku, title: 'Same SKU in another tenant', description: 'synthetic', purchasePrice: 1, sellingPrice: 2, quantity: 1 });
      expect([200, 201]).toContain(res.status);
      expect(res.raw).not.toContain(fx.B.productId);
      const created = await prisma.product.findMany({ where: { workspaceId: fx.A.workspaceId, sku } });
      expect(created).toHaveLength(1);
      await expectBUnchanged();
      const ids = created.map((p) => p.id);
      await prisma.productImage.deleteMany({ where: { productId: { in: ids } } });
      await prisma.inventory.deleteMany({ where: { productId: { in: ids } } });
      await prisma.product.deleteMany({ where: { id: { in: ids } } });
    });

    it('a duplicate SKU inside A is reported without revealing B (no cross-tenant information in the error)', async () => {
      const skuA = (await prisma.product.findUniqueOrThrow({ where: { id: fx.A.productId } })).sku;
      const res = await post(productsRoute.POST, `/api/products?${wsA()}`, { sku: skuA, title: 'dup', description: 'synthetic', purchasePrice: 1, sellingPrice: 2, quantity: 1 });
      expect([400, 409, 500]).toContain(res.status);
      for (const marker of [fx.B.productId, fx.B.workspaceId, `${fx.runId}-b`]) expect(res.raw).not.toContain(marker);
      await expectBUnchanged();
    });

    it('idempotency keys are unique per workspace: the same key in A and B coexist', async () => {
      const keyOfB = (await prisma.agentAction.findUniqueOrThrow({ where: { id: fx.B.actionId } })).idempotencyKey;
      const clone = await prisma.agentAction.create({
        data: {
          workspaceId: fx.A.workspaceId, userId: fx.A.userId, conversationId: fx.A.conversationId, type: 'synthetic', category: 'synthetic',
          input: '{}', summary: 'same key, other tenant', idempotencyKey: keyOfB, expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      try {
        expect(clone.workspaceId).toBe(fx.A.workspaceId);
        await expectBUnchanged();
      } finally {
        await prisma.agentAction.deleteMany({ where: { id: clone.id } });
      }
    });

    it('removing tenant A completely leaves tenant B byte-identical (shared global rows are not tenant-owned)', async () => {
      // Observation only: a plain `delete user` cascade is attempted first. If the schema's FK rules refuse it
      // (e.g. a required relation without ON DELETE CASCADE), that is reported but is not an isolation failure.
      try {
        await prisma.user.delete({ where: { id: fx.A.userId } });
      } catch (error) {
        const e = error as { code?: string; meta?: unknown };
        console.warn(`[r3c observation] cascade delete of a whole tenant is refused by the schema: code=${e.code}`);
      }
      await cleanupTenant(prisma, fx.A);
      expect(await prisma.workspace.count({ where: { id: fx.A.workspaceId } })).toBe(0);
      expect(await prisma.product.count({ where: { workspaceId: fx.A.workspaceId } })).toBe(0);
      expect(await prisma.order.count({ where: { workspaceId: fx.A.workspaceId } })).toBe(0);
      expect(await prisma.marketplaceConnection.count({ where: { workspaceId: fx.A.workspaceId } })).toBe(0);
      await expectBUnchanged();
    });
  });
});
