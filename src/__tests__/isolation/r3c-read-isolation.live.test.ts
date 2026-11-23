/**
 * R3-C.3 — READ isolation between workspaces, on the dedicated local test
 * database. Real route handlers, real services, real Prisma, real
 * `@/lib/security`; only `@/auth` (the session) is replaced.
 *
 * Run ONLY through the guarded runner:
 *   node scripts/r3c/run-with-test-db.mjs vitest src/__tests__/isolation/r3c-read-isolation.live.test.ts
 *
 * Adversary: user A, authenticated, with a valid workspace A, who knows the
 * exact ids of tenant B's rows. Every attempt must fail (or return only A's
 * data), and no byte of B's data may appear in any response.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { enforceGuardForTestRun } from '@/lib/testing/dbSafetyGuard';
import {
  connectGuardedPrisma,
  createAbFixture,
  cleanupAbFixture,
  snapshotTenant,
  type AbFixture,
  type TenantIds,
} from '@/lib/testing/r3cHarness';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@/auth', () => ({ auth: authMock }));

const guarded = enforceGuardForTestRun(process.env) === 'guarded';

import * as productsRoute from '@/app/api/products/route';
import * as productRoute from '@/app/api/products/[id]/route';
import * as productImagesRoute from '@/app/api/products/[id]/images/route';
import * as listingsRoute from '@/app/api/listings/route';
import * as listingRoute from '@/app/api/listings/[id]/route';
import * as ordersRoute from '@/app/api/orders/route';
import * as orderRoute from '@/app/api/orders/[orderId]/route';
import * as fulfillmentRoute from '@/app/api/fulfillment/route';
import * as connectionsRoute from '@/app/api/marketplace/connections/route';
import * as workspaceRoute from '@/app/api/workspaces/[id]/route';
import * as notificationsRoute from '@/app/api/notifications/route';

const idValues = (t: TenantIds): string[] => Object.values(t).flat() as string[];

describe.skipIf(!guarded)('R3-C.3 — workspace A cannot READ workspace B', () => {
  let prisma: PrismaClient;
  let fx: AbFixture;
  let beforeB: string;
  let markersB: string[];
  let markersA: string[];

  beforeAll(async () => {
    prisma = await connectGuardedPrisma();
    fx = await createAbFixture(prisma);
    beforeB = await snapshotTenant(prisma, fx.B);
    // everything that identifies tenant B: all its ids plus the run-unique "-b" tag used in emails, slugs, skus, tokens, urls
    markersB = [...idValues(fx.B), `${fx.runId}-b`];
    markersA = [...idValues(fx.A), `${fx.runId}-a`];
  });

  afterAll(async () => {
    if (fx) await cleanupAbFixture(prisma, fx);
    await prisma?.$disconnect();
  });

  const asA = () => authMock.mockResolvedValue({ user: { id: fx.A.userId, workspaceId: fx.A.workspaceId } });

  async function call(handler: (req: NextRequest, ctx?: any) => Promise<Response>, url: string, params?: Record<string, string>, init?: ConstructorParameters<typeof NextRequest>[1]) {
    const response = await handler(new NextRequest(`http://localhost${url}`, init), params ? { params } : undefined);
    const raw = await response.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { /* not json */ }
    return { status: response.status, raw, json };
  }

  const leaksB = (raw: string) => markersB.filter((m) => raw.includes(m));
  const wsA = () => `workspaceId=${fx.A.workspaceId}`;
  const wsB = () => `workspaceId=${fx.B.workspaceId}`;

  describe('positive controls: A can read its own data', () => {
    it('A reads its own product, listing, order and image list', async () => {
      asA();
      expect((await call(productRoute.GET, `/api/products/x?${wsA()}`, { id: fx.A.productId })).status).toBe(200);
      expect((await call(listingRoute.GET, `/api/listings/x?${wsA()}`, { id: fx.A.listingId })).status).toBe(200);
      expect((await call(orderRoute.GET, `/api/orders/x?${wsA()}`, { orderId: fx.A.orderId })).status).toBe(200);
      const imgs = await call(productImagesRoute.GET, `/api/products/x/images?${wsA()}`, { id: fx.A.productId });
      expect(imgs.status).toBe(200);
      expect(imgs.raw).toContain(fx.A.imageIds[0]);
    });
  });

  describe('B ids requested through A\'s own workspace', () => {
    const byId: Array<[string, () => Promise<{ status: number; raw: string }>]> = [];

    it.each([
      ['GET /api/products/[id]', () => call(productRoute.GET, `/api/products/x?${wsA()}`, { id: fx.B.productId })],
      ['GET /api/products/[id] (B second product)', () => call(productRoute.GET, `/api/products/x?${wsA()}`, { id: fx.B.secondProductId })],
      ['GET /api/products/[id]/images', () => call(productImagesRoute.GET, `/api/products/x/images?${wsA()}`, { id: fx.B.productId })],
      ['GET /api/listings/[id]', () => call(listingRoute.GET, `/api/listings/x?${wsA()}`, { id: fx.B.listingId })],
      ['GET /api/orders/[orderId]', () => call(orderRoute.GET, `/api/orders/x?${wsA()}`, { orderId: fx.B.orderId })],
    ] as Array<[string, () => Promise<{ status: number; raw: string }>]>)('%s -> refused, nothing of B in the body', async (_name, run) => {
      asA();
      const res = await run();
      expect([401, 403, 404]).toContain(res.status);
      expect(leaksB(res.raw)).toEqual([]);
    });

    it('GET /api/workspaces/[id] for B\'s workspace id through A\'s workspace -> refused', async () => {
      asA();
      const res = await call(workspaceRoute.GET, `/api/workspaces/x?${wsA()}`, { id: fx.B.workspaceId });
      expect([401, 403, 404]).toContain(res.status);
      expect(leaksB(res.raw)).toEqual([]);
    });
    void byId;
  });

  describe('list endpoints return only A\'s rows', () => {
    it.each([
      ['GET /api/products', () => call(productsRoute.GET, `/api/products?${wsA()}`), 'products'],
      ['GET /api/listings', () => call(listingsRoute.GET, `/api/listings?${wsA()}`), 'listings'],
      ['GET /api/orders', () => call(ordersRoute.GET, `/api/orders?${wsA()}`), 'orders'],
      ['GET /api/fulfillment', () => call(fulfillmentRoute.GET, `/api/fulfillment?${wsA()}`), 'orders'],
      ['GET /api/marketplace/connections', () => call(connectionsRoute.GET, `/api/marketplace/connections?${wsA()}`), 'connections'],
    ] as Array<[string, () => Promise<{ status: number; raw: string; json: any }>, string]>)('%s', async (_name, run, key) => {
      asA();
      const res = await run();
      expect(res.status).toBe(200);
      expect(leaksB(res.raw)).toEqual([]);
      expect(Array.isArray(res.json?.[key])).toBe(true);
      // A's own row is present (the list is not trivially empty)
      expect(markersA.some((m) => res.raw.includes(m))).toBe(true);
    });

    it('GET /api/notifications returns only A\'s own notifications', async () => {
      asA();
      const res = await call(notificationsRoute.GET, `/api/notifications`);
      expect(res.status).toBe(200);
      expect(leaksB(res.raw)).toEqual([]);
      expect(res.raw).toContain(fx.A.notificationId);
    });

    it('list filters supplied by the caller cannot widen the scope (status / marketplace filters)', async () => {
      asA();
      const res = await call(listingsRoute.GET, `/api/listings?${wsA()}&marketplaceId=${fx.marketplaceName}&status=active&page=1`);
      expect(res.status).toBe(200);
      expect(leaksB(res.raw)).toEqual([]);
      const orders = await call(ordersRoute.GET, `/api/orders?${wsA()}&status=pending`);
      expect(leaksB(orders.raw)).toEqual([]);
    });
  });

  describe('A\'s session pointed at B\'s workspace id is refused everywhere', () => {
    it.each([
      ['products', () => call(productsRoute.GET, `/api/products?${wsB()}`)],
      ['product by id', () => call(productRoute.GET, `/api/products/x?${wsB()}`, { id: fx.B.productId })],
      ['product images', () => call(productImagesRoute.GET, `/api/products/x/images?${wsB()}`, { id: fx.B.productId })],
      ['listings', () => call(listingsRoute.GET, `/api/listings?${wsB()}`)],
      ['listing by id', () => call(listingRoute.GET, `/api/listings/x?${wsB()}`, { id: fx.B.listingId })],
      ['orders', () => call(ordersRoute.GET, `/api/orders?${wsB()}`)],
      ['order by id', () => call(orderRoute.GET, `/api/orders/x?${wsB()}`, { orderId: fx.B.orderId })],
      ['fulfillment', () => call(fulfillmentRoute.GET, `/api/fulfillment?${wsB()}`)],
      ['marketplace connections', () => call(connectionsRoute.GET, `/api/marketplace/connections?${wsB()}`)],
      ['workspace by id', () => call(workspaceRoute.GET, `/api/workspaces/x?${wsB()}`, { id: fx.B.workspaceId })],
    ] as Array<[string, () => Promise<{ status: number; raw: string }>]>)('%s', async (_name, run) => {
      asA();
      const res = await run();
      expect([401, 403, 404]).toContain(res.status);
      expect(leaksB(res.raw)).toEqual([]);
    });

    it('no session at all -> 401 and nothing of A or B', async () => {
      authMock.mockResolvedValue(null);
      const res = await call(ordersRoute.GET, `/api/orders?${wsA()}`);
      expect(res.status).toBe(401);
      expect(leaksB(res.raw)).toEqual([]);
      expect(markersA.some((m) => res.raw.includes(m))).toBe(false);
    });

    it('unverified e-mail -> refused even on the user\'s own workspace', async () => {
      await prisma.user.update({ where: { id: fx.A.userId }, data: { emailVerified: false } });
      try {
        asA();
        const res = await call(ordersRoute.GET, `/api/orders?${wsA()}`);
        expect(res.status).toBe(403);
      } finally {
        await prisma.user.update({ where: { id: fx.A.userId }, data: { emailVerified: true } });
      }
    });
  });

  describe('services called directly with B ids and A\'s workspace', () => {
    it('ProductService / OrderService / ListingService return nothing for B ids', async () => {
      const { ProductService } = await import('@/services/ProductService');
      const { OrderService } = await import('@/services/OrderService');
      const { ListingService } = await import('@/services/ListingService');
      const { StorageService } = await import('@/services/StorageService');

      await expect(ProductService.getProduct(fx.B.productId, fx.A.workspaceId)).resolves.toBeNull();
      await expect(OrderService.getOrder(fx.B.orderId, fx.A.workspaceId)).resolves.toBeNull();
      await expect(OrderService.getOrderForResponse(fx.B.orderId, fx.A.workspaceId)).resolves.toBeNull();
      await expect(ListingService.getListing(fx.B.listingId, fx.A.workspaceId)).resolves.toBeNull();
      await expect(ListingService.getListingForResponse(fx.B.listingId, fx.A.workspaceId)).resolves.toBeNull();
      await expect(StorageService.getProductImages(fx.A.workspaceId, fx.B.productId)).rejects.toThrow();
    });

    it('AiActionService.getAction cannot read B\'s agent action', async () => {
      const { AiActionService } = await import('@/services/ai/AiActionService');
      await expect(AiActionService.getAction(fx.A.workspaceId, fx.B.actionId)).resolves.toBeNull();
      const own = await AiActionService.getAction(fx.A.workspaceId, fx.A.actionId);
      expect(own).not.toBeNull();
    });

    it('B\'s rows are untouched by every read above', async () => {
      // B is compared byte for byte. (A is not: the unverified-e-mail test above
      // legitimately toggled A's own user row.)
      expect(await snapshotTenant(prisma, fx.B)).toBe(beforeB);
    });
  });
});
