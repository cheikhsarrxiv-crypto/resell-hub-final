/**
 * R3-C.4 / R3-C.5 — product-image isolation (reorder, delete, alt text, main
 * image, upload, conversation uploads) on the dedicated local test database.
 *
 * Real handlers, real StorageService, real Prisma, real `@/lib/security`.
 * Replaced: `@/auth` (the session) and `@supabase/supabase-js` (a fake
 * storage client, so nothing can ever reach a network; its `remove` / `upload`
 * calls are counted to prove that B's stored files are never touched).
 *
 * Run ONLY through the guarded runner:
 *   node scripts/r3c/run-with-test-db.mjs vitest src/__tests__/isolation/r3c-image-isolation.live.test.ts
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
  type AbFixture,
} from '@/lib/testing/r3cHarness';

const { authMock, storage } = vi.hoisted(() => {
  const storage = {
    remove: vi.fn(async () => ({ error: null })),
    upload: vi.fn(async () => ({ data: { path: 'fake' }, error: null })),
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://r3c.invalid/fake' } })),
    download: vi.fn(async () => ({ data: null, error: { message: 'none' } })),
  };
  return { authMock: vi.fn(), storage };
});
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: vi.fn(() => storage) } })),
}));

const guarded = enforceGuardForTestRun(process.env) === 'guarded';

describe.skipIf(!guarded)('R3-C.4/C.5 — product images: workspace A cannot touch workspace B', () => {
  let prisma: PrismaClient;
  let fx: AbFixture;
  let beforeB: string;
  let reorderRoute: typeof import('@/app/api/products/[id]/images/reorder/route');
  let imageRoute: typeof import('@/app/api/products/[id]/images/[imageId]/route');
  let mainRoute: typeof import('@/app/api/products/[id]/images/[imageId]/main/route');
  let StorageService: typeof import('@/services/StorageService').StorageService;

  beforeAll(async () => {
    prisma = await connectGuardedPrisma();
    // StorageService builds its client at import time from these two variables. They are fake
    // `.invalid` values and the client is the mock above: nothing can connect anywhere. They are
    // removed again right after the import.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://r3c-fake-storage.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'r3c-not-a-real-key';
    try {
      reorderRoute = await import('@/app/api/products/[id]/images/reorder/route');
      imageRoute = await import('@/app/api/products/[id]/images/[imageId]/route');
      mainRoute = await import('@/app/api/products/[id]/images/[imageId]/main/route');
      StorageService = (await import('@/services/StorageService')).StorageService;
    } finally {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    fx = await createAbFixture(prisma);
    // B's first image has a stored file, to prove storage deletion is never reached
    await prisma.productImage.update({ where: { id: fx.B.imageIds[0] }, data: { storagePath: `${fx.B.workspaceId}/${fx.B.productId}/file.jpg` } });
    beforeB = await snapshotTenant(prisma, fx.B);
    authMock.mockResolvedValue({ user: { id: fx.A.userId, workspaceId: fx.A.workspaceId } });
  });
  afterEach(async () => {
    if (fx) await cleanupAbFixture(prisma, fx);
  });

  const wsA = () => `workspaceId=${fx.A.workspaceId}`;
  const expectBUnchanged = async () => expect(await snapshotTenant(prisma, fx.B)).toBe(beforeB);
  const REFUSED = [401, 403, 404];

  async function call(handler: (req: NextRequest, ctx?: any) => Promise<Response>, method: string, url: string, params: Record<string, string>, body?: unknown) {
    const request = new NextRequest(`http://localhost${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const response = await handler(request, { params });
    const raw = await response.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { /* not json */ }
    return { status: response.status, raw, json };
  }
  const reorder = (productId: string, images: unknown) =>
    call(reorderRoute.PUT, 'PUT', `/api/products/x/images/reorder?${wsA()}`, { id: productId }, { images });

  describe('reorder (the R3-C.0 fix, proven on a real database)', () => {
    it("A's product + B's image ids -> refused, B's images byte-identical", async () => {
      const res = await reorder(fx.A.productId, [
        { id: fx.B.imageIds[0], order: 99, isMain: false },
        { id: fx.B.imageIds[1], order: 0, isMain: true },
      ]);
      expect(REFUSED).toContain(res.status);
      expect(res.json).toEqual({ error: 'Product not found or access denied' });
      await expectBUnchanged();
    });

    it("mixing A's own and B's image ids is rejected as a whole: not even A's images change (atomic)", async () => {
      const aBefore = await prisma.productImage.findMany({ where: { id: { in: fx.A.imageIds } }, orderBy: { id: 'asc' } });
      const res = await reorder(fx.A.productId, [
        { id: fx.A.imageIds[0], order: 7, isMain: false },
        { id: fx.A.imageIds[1], order: 8, isMain: true },
        { id: fx.B.imageIds[2], order: 9, isMain: false },
      ]);
      expect(REFUSED).toContain(res.status);
      expect(await prisma.productImage.findMany({ where: { id: { in: fx.A.imageIds } }, orderBy: { id: 'asc' } })).toEqual(aBefore);
      await expectBUnchanged();
    });

    it("B's product id through A's workspace -> refused, B unchanged", async () => {
      const res = await reorder(fx.B.productId, [{ id: fx.B.imageIds[0], order: 5, isMain: true }]);
      expect(REFUSED).toContain(res.status);
      await expectBUnchanged();
    });

    it("an image of A's OTHER product passed through A's first product -> refused", async () => {
      const before = await prisma.productImage.findUniqueOrThrow({ where: { id: fx.A.secondProductImageId } });
      const res = await reorder(fx.A.productId, [{ id: fx.A.secondProductImageId, order: 5, isMain: false }]);
      expect(REFUSED).toContain(res.status);
      expect(await prisma.productImage.findUniqueOrThrow({ where: { id: fx.A.secondProductImageId } })).toEqual(before);
    });

    it('a foreign id and an unknown id are indistinguishable (no existence oracle)', async () => {
      const foreign = await reorder(fx.A.productId, [{ id: fx.B.imageIds[0], order: 1 }]);
      const unknown = await reorder(fx.A.productId, [{ id: 'does-not-exist', order: 1 }]);
      expect(foreign.status).toBe(unknown.status);
      expect(foreign.raw).toBe(unknown.raw);
      expect(foreign.raw).not.toContain(fx.B.imageIds[0]);
    });

    it('positive control: A reorders its own images and B stays untouched', async () => {
      const res = await reorder(fx.A.productId, [
        { id: fx.A.imageIds[2], order: 0, isMain: true },
        { id: fx.A.imageIds[0], order: 1, isMain: false },
        { id: fx.A.imageIds[1], order: 2, isMain: false },
      ]);
      expect(res.status).toBe(200);
      const rows = await prisma.productImage.findMany({ where: { id: { in: fx.A.imageIds } } });
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[fx.A.imageIds[2]]).toMatchObject({ order: 0, isMain: true });
      expect(byId[fx.A.imageIds[0]]).toMatchObject({ order: 1, isMain: false });
      await expectBUnchanged();
    });
  });

  describe("delete / alt text / main image with B's image id", () => {
    it("DELETE B's image -> refused, row kept, stored file NOT removed", async () => {
      const res = await call(imageRoute.DELETE, 'DELETE', `/api/products/x/images/y?${wsA()}`, { id: fx.A.productId, imageId: fx.B.imageIds[0] });
      expect(REFUSED).toContain(res.status);
      expect(storage.remove).not.toHaveBeenCalled();
      await expectBUnchanged();
    });

    it("PUT alt text on B's image -> refused, B unchanged", async () => {
      const res = await call(imageRoute.PUT, 'PUT', `/api/products/x/images/y?${wsA()}`, { id: fx.A.productId, imageId: fx.B.imageIds[1] }, { altText: 'HACKED' });
      expect(REFUSED).toContain(res.status);
      await expectBUnchanged();
    });

    it("PUT isMain on B's image (set main) -> refused, B's main image unchanged", async () => {
      const res = await call(imageRoute.PUT, 'PUT', `/api/products/x/images/y?${wsA()}`, { id: fx.A.productId, imageId: fx.B.imageIds[2] }, { isMain: true });
      expect(REFUSED).toContain(res.status);
      await expectBUnchanged();
    });

    it("PUT /main on B's image -> refused, B unchanged", async () => {
      const res = await call(mainRoute.PUT, 'PUT', `/api/products/x/images/y/main?${wsA()}`, { id: fx.A.productId, imageId: fx.B.imageIds[1] });
      expect(REFUSED).toContain(res.status);
      await expectBUnchanged();
    });

    it("setMainImage on A's image never flips B's main flag even though both products have a main image", async () => {
      const res = await call(mainRoute.PUT, 'PUT', `/api/products/x/images/y/main?${wsA()}`, { id: fx.A.productId, imageId: fx.A.imageIds[1] });
      expect(res.status).toBe(200);
      expect((await prisma.productImage.findUniqueOrThrow({ where: { id: fx.A.imageIds[1] } })).isMain).toBe(true);
      await expectBUnchanged();
    });

    it('positive control: A deletes its own image (its stored file path is removed, B untouched)', async () => {
      await prisma.productImage.update({ where: { id: fx.A.imageIds[2] }, data: { storagePath: `${fx.A.workspaceId}/${fx.A.productId}/own.jpg` } });
      const res = await call(imageRoute.DELETE, 'DELETE', `/api/products/x/images/y?${wsA()}`, { id: fx.A.productId, imageId: fx.A.imageIds[2] });
      expect(res.status).toBe(200);
      expect(storage.remove).toHaveBeenCalledTimes(1);
      expect(await prisma.productImage.findUnique({ where: { id: fx.A.imageIds[2] } })).toBeNull();
      await expectBUnchanged();
    });
  });

  describe('uploads and conversation uploads aimed at B', () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

    it("uploadImage to B's product is refused, nothing stored, no row created", async () => {
      const countBefore = await prisma.productImage.count({ where: { productId: fx.B.productId } });
      await expect(
        StorageService.uploadImage({ workspaceId: fx.A.workspaceId, productId: fx.B.productId, file: png, fileName: 'x.png', mimeType: 'image/png' })
      ).rejects.toThrow();
      expect(storage.upload).not.toHaveBeenCalled();
      expect(await prisma.productImage.count({ where: { productId: fx.B.productId } })).toBe(countBefore);
      await expectBUnchanged();
    });

    it("uploadConversationImage into B's conversation is refused, nothing stored", async () => {
      await expect(
        StorageService.uploadConversationImage({ workspaceId: fx.A.workspaceId, conversationId: fx.B.conversationId, file: png, fileName: 'x.png', mimeType: 'image/png' } as any)
      ).rejects.toThrow();
      expect(storage.upload).not.toHaveBeenCalled();
      await expectBUnchanged();
    });

    it("downloadConversationImageBytes returns null (never B's bytes) for B's prefix and for B's conversation id", async () => {
      // by design a denial is `null`, not an exception
      await expect(
        StorageService.downloadConversationImageBytes({
          workspaceId: fx.A.workspaceId,
          conversationId: fx.B.conversationId,
          storagePath: `${fx.B.workspaceId}/_draft-uploads/${fx.B.conversationId}/x.png`,
        })
      ).resolves.toBeNull();
      // A's own prefix but B's conversation id: the ownership lookup of the conversation refuses it
      await expect(
        StorageService.downloadConversationImageBytes({
          workspaceId: fx.A.workspaceId,
          conversationId: fx.B.conversationId,
          storagePath: `${fx.A.workspaceId}/_draft-uploads/${fx.B.conversationId}/x.png`,
        })
      ).resolves.toBeNull();
      expect(storage.download).not.toHaveBeenCalled();
    });

    it('positive control: uploadImage to A\'s own product works (stub storage) and stays in A\'s workspace', async () => {
      const result = await StorageService.uploadImage({ workspaceId: fx.A.workspaceId, productId: fx.A.productId, file: png, fileName: 'x.png', mimeType: 'image/png' });
      expect(result).toBeTruthy();
      expect(storage.upload).toHaveBeenCalledTimes(1);
      const calls = storage.upload.mock.calls as unknown as Array<[string]>;
      expect(calls[0][0].startsWith(`${fx.A.workspaceId}/${fx.A.productId}/`)).toBe(true);
      await expectBUnchanged();
    });
  });
});
