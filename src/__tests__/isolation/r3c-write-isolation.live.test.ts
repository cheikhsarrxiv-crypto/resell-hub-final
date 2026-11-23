/**
 * R3-C.4 — MODIFY / DELETE isolation between workspaces, on the dedicated
 * local test database. Real route handlers, real services, real Prisma, real
 * `@/lib/security`; only `@/auth` (the session) is replaced.
 *
 * Run ONLY through the guarded runner:
 *   node scripts/r3c/run-with-test-db.mjs vitest src/__tests__/isolation/r3c-write-isolation.live.test.ts
 *
 * Adversary: authenticated user A with a valid workspace A who knows the
 * exact ids of tenant B's rows. Every attempt to modify or delete them must
 * fail, and tenant B's rows must be byte-for-byte identical afterwards.
 * A fresh fixture is created for every test and removed afterwards.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { enforceGuardForTestRun } from '@/lib/testing/dbSafetyGuard';
import {
  connectGuardedPrisma,
  createAbFixture,
  cleanupAbFixture,
  snapshotTenant,
  type AbFixture,
} from '@/lib/testing/r3cHarness';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@/auth', () => ({ auth: authMock }));

const guarded = enforceGuardForTestRun(process.env) === 'guarded';

import * as productRoute from '@/app/api/products/[id]/route';
import * as listingRoute from '@/app/api/listings/[id]/route';
import * as workspaceRoute from '@/app/api/workspaces/[id]/route';
import * as notificationsRoute from '@/app/api/notifications/route';
import * as simulateRoute from '@/app/api/fulfillment/simulate/route';
import * as disconnectRoute from '@/app/api/marketplace/disconnect/[marketplace]/route';

describe.skipIf(!guarded)('R3-C.4 — workspace A cannot MODIFY or DELETE workspace B', () => {
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
    fx = await createAbFixture(prisma);
    beforeB = await snapshotTenant(prisma, fx.B);
    authMock.mockResolvedValue({ user: { id: fx.A.userId, workspaceId: fx.A.workspaceId } });
  });
  afterEach(async () => {
    if (fx) await cleanupAbFixture(prisma, fx);
  });

  const wsA = () => `workspaceId=${fx.A.workspaceId}`;

  async function call(handler: (req: NextRequest, ctx?: any) => Promise<Response>, method: string, url: string, params?: Record<string, string>, body?: unknown) {
    const request = new NextRequest(`http://localhost${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const response = await handler(request, params ? { params } : undefined);
    const raw = await response.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { /* not json */ }
    return { status: response.status, raw, json };
  }

  const expectBUnchanged = async () => expect(await snapshotTenant(prisma, fx.B)).toBe(beforeB);
  const REFUSED = [401, 403, 404];

  describe("B's ids used through A's own workspace", () => {
    it('PATCH /api/products/[id] -> refused, B product unchanged', async () => {
      const res = await call(productRoute.PATCH, 'PATCH', `/api/products/x?${wsA()}`, { id: fx.B.productId }, { title: 'HACKED', sellingPrice: 1 });
      expect(REFUSED).toContain(res.status);
      await expectBUnchanged();
    });

    it('DELETE /api/products/[id] -> refused, B product not soft-deleted', async () => {
      const res = await call(productRoute.DELETE, 'DELETE', `/api/products/x?${wsA()}`, { id: fx.B.productId });
      expect(REFUSED).toContain(res.status);
      await expectBUnchanged();
    });

    it('PATCH /api/listings/[id] -> refused, B listing unchanged', async () => {
      const res = await call(listingRoute.PATCH, 'PATCH', `/api/listings/x?${wsA()}`, { id: fx.B.listingId }, { title: 'HACKED listing', price: 1 });
      expect(REFUSED).toContain(res.status);
      await expectBUnchanged();
    });

    it('DELETE /api/listings/[id] -> refused, B listing not delisted', async () => {
      const res = await call(listingRoute.DELETE, 'DELETE', `/api/listings/x?${wsA()}`, { id: fx.B.listingId });
      expect(REFUSED).toContain(res.status);
      await expectBUnchanged();
    });

    it("PUT /api/workspaces/[id] for B's workspace id through A's workspace -> refused, B workspace unchanged", async () => {
      const res = await call(workspaceRoute.PUT, 'PUT', `/api/workspaces/x?${wsA()}`, { id: fx.B.workspaceId }, { name: 'HACKED', country: 'US' });
      expect(REFUSED).toContain(res.status);
      await expectBUnchanged();
    });

    it("PATCH /api/notifications with B's notification id -> nothing updated, B notification still unread", async () => {
      const res = await call(notificationsRoute.PATCH, 'PATCH', `/api/notifications`, undefined, { id: fx.B.notificationId });
      expect(res.status).toBe(200);
      expect(res.json.updated).toBe(0);
      await expectBUnchanged();
    });

    it("PATCH /api/notifications without id (mark all) only touches A's notifications", async () => {
      const res = await call(notificationsRoute.PATCH, 'PATCH', `/api/notifications`, undefined, {});
      expect(res.status).toBe(200);
      expect(res.json.updated).toBe(1);
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: fx.A.notificationId } })).isRead).toBe(true);
      await expectBUnchanged();
    });

    it.each(['accept', 'processing', 'ship', 'deliver'])("POST /api/fulfillment/simulate (%s) on B's fulfillment order -> refused, B untouched (no shipment / tracking written)", async (action) => {
      const res = await call(simulateRoute.POST, 'POST', `/api/fulfillment/simulate?${wsA()}`, undefined, { fulfillmentOrderId: fx.B.fulfillmentOrderId, action });
      expect(REFUSED).toContain(res.status);
      await expectBUnchanged();
    });
  });

  describe("services called directly with B's ids and A's workspace", () => {
    it('OrderService.updateOrderStatus / cancelOrder reject and leave B untouched', async () => {
      const { OrderService } = await import('@/services/OrderService');
      await expect(OrderService.updateOrderStatus(fx.B.orderId, fx.A.workspaceId, 'cancelled')).rejects.toThrow();
      await expect(OrderService.cancelOrder(fx.B.orderId, fx.A.workspaceId)).rejects.toThrow();
      await expectBUnchanged();
    });

    it('ProductService.updateProduct / deleteProduct reject and leave B untouched', async () => {
      const { ProductService } = await import('@/services/ProductService');
      await expect(ProductService.updateProduct(fx.B.productId, fx.A.workspaceId, { title: 'HACKED' } as any)).rejects.toThrow();
      await expect(ProductService.deleteProduct(fx.B.productId, fx.A.workspaceId)).rejects.toThrow();
      await expectBUnchanged();
    });

    it('ListingService.updateListing / deleteListing reject and leave B untouched', async () => {
      const { ListingService } = await import('@/services/ListingService');
      await expect(ListingService.updateListing(fx.B.listingId, fx.A.workspaceId, { title: 'HACKED listing' } as any)).rejects.toThrow();
      await expect(ListingService.deleteListing(fx.B.listingId, fx.A.workspaceId)).rejects.toThrow();
      await expectBUnchanged();
    });

    it("AiActionService.cancelAction / confirmAndExecute cannot touch B's agent action", async () => {
      const { AiActionService } = await import('@/services/ai/AiActionService');
      const cancelled = await AiActionService.cancelAction(fx.A.workspaceId, fx.A.userId, fx.B.actionId).catch(() => null);
      expect(cancelled).toBeNull();
      const confirmed = await AiActionService.confirmAndExecute(fx.A.workspaceId, fx.A.userId, fx.B.actionId).catch(() => null);
      expect(confirmed).toBeNull();
      await expectBUnchanged();
    });

    it("FulfillmentService.simulateOrder* reject B's fulfillment order and write nothing", async () => {
      const { FulfillmentService } = await import('@/services/FulfillmentService');
      await expect(FulfillmentService.simulateOrderAccepted(fx.B.fulfillmentOrderId, fx.A.workspaceId)).rejects.toThrow();
      await expect(FulfillmentService.simulateOrderProcessing(fx.B.fulfillmentOrderId, fx.A.workspaceId)).rejects.toThrow();
      await expect(FulfillmentService.simulateOrderShipped(fx.B.fulfillmentOrderId, fx.A.workspaceId, 'TRK', 'carrier')).rejects.toThrow();
      await expect(FulfillmentService.simulateOrderDelivered(fx.B.fulfillmentOrderId, fx.A.workspaceId)).rejects.toThrow();
      await expectBUnchanged();
    });
  });

  describe('a marketplace shared by name is still per-workspace', () => {
    it("A disconnecting 'ebay' clears A's connection only; B's connection to the same marketplace is untouched", async () => {
      const existing = await prisma.marketplace.findUnique({ where: { name: 'ebay' } });
      const marketplace = existing ?? (await prisma.marketplace.create({ data: { name: 'ebay', displayName: 'eBay (r3c)' } }));
      const connA = await prisma.marketplaceConnection.create({
        data: { workspaceId: fx.A.workspaceId, marketplaceId: 'ebay', status: 'connected', encryptedOauthToken: 'FAKE-A', encryptedRefreshToken: 'FAKE-A-R' },
      });
      const connB = await prisma.marketplaceConnection.create({
        data: { workspaceId: fx.B.workspaceId, marketplaceId: 'ebay', status: 'connected', encryptedOauthToken: 'FAKE-B', encryptedRefreshToken: 'FAKE-B-R' },
      });
      // MarketplaceConnectionService needs an encryption key to be constructed. A throwaway random
      // key, generated here and never stored: it protects nothing and is not related to any real key.
      const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
      process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
      try {
        const beforeConnB = JSON.stringify(await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: connB.id } }));
        const res = await call(disconnectRoute.POST, 'POST', `/api/marketplace/disconnect/ebay`, { marketplace: 'ebay' });
        expect(res.status).toBe(200);
        const a = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: connA.id } });
        expect(a.encryptedOauthToken).toBeNull();
        expect(a.encryptedRefreshToken).toBeNull();
        expect(JSON.stringify(await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: connB.id } }))).toBe(beforeConnB);
        await expectBUnchanged();
      } finally {
        if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
        else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
        await prisma.marketplaceConnection.deleteMany({ where: { id: { in: [connA.id, connB.id] } } });
        if (!existing) await prisma.marketplace.deleteMany({ where: { id: marketplace.id } });
      }
    });
  });

  describe("mass assignment: A cannot push or move rows into B's tenant through its own rows", () => {
    it("PATCH /api/products/[id] with ownership / lifecycle columns on A's own product: the legitimate field is applied, the others are ignored (R3-C.6 fix)", async () => {
      const before = await prisma.product.findUniqueOrThrow({ where: { id: fx.A.productId } });
      const res = await call(productRoute.PATCH, 'PATCH', `/api/products/x?${wsA()}`, { id: fx.A.productId }, {
        title: 'edited, not moved',
        workspaceId: fx.B.workspaceId,
        id: 'forged-id',
        deletedAt: new Date(0).toISOString(),
        createdAt: new Date(0).toISOString(),
      });
      expect(res.status).toBe(200);
      const row = await prisma.product.findUniqueOrThrow({ where: { id: fx.A.productId } });
      expect(row.title).toBe('edited, not moved'); // the allowed field went through
      expect(row.workspaceId).toBe(fx.A.workspaceId); // never moved into B's tenant
      expect(row.id).toBe(fx.A.productId);
      expect(row.deletedAt).toBeNull();
      expect(row.createdAt.getTime()).toBe(before.createdAt.getTime());
      expect(await prisma.product.findMany({ where: { workspaceId: fx.B.workspaceId, id: fx.A.productId } })).toEqual([]);
      await expectBUnchanged();
    });

    it("PATCH /api/listings/[id] with foreign workspaceId / productId on A's own listing must not re-parent it", async () => {
      // a listing without marketplace connection / externalId: updateListing then does not call any marketplace adapter
      const own = await prisma.listing.create({
        data: { productId: fx.A.productId, workspaceId: fx.A.workspaceId, title: 'own listing', description: 'synthetic', price: 5, quantity: 1 },
      });
      try {
        const res = await call(listingRoute.PATCH, 'PATCH', `/api/listings/x?${wsA()}`, { id: own.id }, { title: 'own listing edited', workspaceId: fx.B.workspaceId, productId: fx.B.productId });
        const row = await prisma.listing.findUniqueOrThrow({ where: { id: own.id } });
        expect(row.workspaceId).toBe(fx.A.workspaceId);
        expect(row.productId).toBe(fx.A.productId);
        expect(res.status === 200 || REFUSED.concat([400, 422]).includes(res.status)).toBe(true);
        await expectBUnchanged();
      } finally {
        await prisma.listing.deleteMany({ where: { id: own.id } });
      }
    });
  });

  describe("positive controls: A can still modify and delete its OWN rows (the tests are not blocking everything)", () => {
    it('PATCH own product', async () => {
      const res = await call(productRoute.PATCH, 'PATCH', `/api/products/x?${wsA()}`, { id: fx.A.productId }, { title: 'edited by A' });
      expect(res.status).toBe(200);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.A.productId } })).title).toBe('edited by A');
      await expectBUnchanged();
    });

    it('DELETE own product (soft delete) leaves B untouched', async () => {
      const res = await call(productRoute.DELETE, 'DELETE', `/api/products/x?${wsA()}`, { id: fx.A.productId });
      expect(res.status).toBe(200);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.A.productId } })).deletedAt).not.toBeNull();
      await expectBUnchanged();
    });

    it('PATCH own workspace', async () => {
      const res = await call(workspaceRoute.PUT, 'PUT', `/api/workspaces/x?${wsA()}`, { id: fx.A.workspaceId }, { name: 'A renamed' });
      expect(res.status).toBe(200);
      await expectBUnchanged();
    });

    it('simulate on own fulfillment order works', async () => {
      const res = await call(simulateRoute.POST, 'POST', `/api/fulfillment/simulate?${wsA()}`, undefined, { fulfillmentOrderId: fx.A.fulfillmentOrderId, action: 'accept' });
      expect(res.status).toBe(200);
      expect((await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: fx.A.fulfillmentOrderId } })).status).toBe('accepted');
      await expectBUnchanged();
    });
  });
});
