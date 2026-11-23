/**
 * R3-C.0-FIX — StorageService.updateImageOrder must never write to an image
 * that is not one of the validated product's own images.
 *
 * Prisma is replaced by an in-memory fake (see fakeImagePrisma.ts): no DB,
 * no network, no Supabase. The fake is lazy and transactional like Prisma's
 * batch $transaction, so "rejected before any mutation" and "rolled back"
 * are observable facts (`state.writes`, image table snapshots).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fake } from './fakeImagePrisma';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/prisma', async () => {
  const { fake: f } = await import('./fakeImagePrisma');
  return { default: f.prisma, prisma: f.prisma };
});

import { StorageService } from '@/services/StorageService';

const ACCESS_DENIED = 'Product not found or access denied';

beforeEach(() => {
  fake.seedTwoWorkspaces();
});

describe('StorageService.updateImageOrder — rejection happens before any write', () => {
  it('rejects an inaccessible product (belongs to another workspace)', async () => {
    const before = fake.imagesSnapshot();
    await expect(
      StorageService.updateImageOrder('ws-A', 'prod-B', [{ id: 'img-B1', order: 5 }])
    ).rejects.toThrow(ACCESS_DENIED);
    expect(fake.state.writes).toBe(0);
    expect(fake.imagesSnapshot()).toEqual(before);
  });

  it('rejects an unknown product', async () => {
    await expect(
      StorageService.updateImageOrder('ws-A', 'prod-nope', [{ id: 'img-A1', order: 1 }])
    ).rejects.toThrow(ACCESS_DENIED);
    expect(fake.state.writes).toBe(0);
  });

  it("rejects a foreign workspace's image id passed through the caller's own product (the reported A -> B attack)", async () => {
    const before = fake.imagesSnapshot();
    await expect(
      StorageService.updateImageOrder('ws-A', 'prod-A', [
        { id: 'img-B1', order: 99, isMain: false },
        { id: 'img-B2', order: 0, isMain: true },
      ])
    ).rejects.toThrow(ACCESS_DENIED);
    expect(fake.state.writes).toBe(0);
    expect(fake.state.updateWheres).toEqual([]); // not a single write was even attempted
    expect(fake.imagesSnapshot()).toEqual(before); // B's order / isMain untouched
  });

  it('rejects an unknown image id', async () => {
    const before = fake.imagesSnapshot();
    await expect(
      StorageService.updateImageOrder('ws-A', 'prod-A', [{ id: 'img-does-not-exist', order: 1 }])
    ).rejects.toThrow(ACCESS_DENIED);
    expect(fake.state.writes).toBe(0);
    expect(fake.imagesSnapshot()).toEqual(before);
  });

  it('a mix of own and foreign images is rejected as a whole: not even the own images change', async () => {
    const before = fake.imagesSnapshot();
    await expect(
      StorageService.updateImageOrder('ws-A', 'prod-A', [
        { id: 'img-A1', order: 7 },
        { id: 'img-A2', order: 8 },
        { id: 'img-B3', order: 9 },
      ])
    ).rejects.toThrow(ACCESS_DENIED);
    expect(fake.state.writes).toBe(0);
    expect(fake.imagesSnapshot()).toEqual(before);
  });

  it("rejects an image of another product of the SAME workspace", async () => {
    const before = fake.imagesSnapshot();
    await expect(
      StorageService.updateImageOrder('ws-A', 'prod-A', [{ id: 'img-A2-1', order: 3 }])
    ).rejects.toThrow(ACCESS_DENIED);
    expect(fake.state.writes).toBe(0);
    expect(fake.imagesSnapshot()).toEqual(before);
  });

  it('gives the same error for an inaccessible product, a foreign image, an unknown image and another product image (no existence oracle)', async () => {
    const attempts = [
      () => StorageService.updateImageOrder('ws-A', 'prod-B', [{ id: 'img-B1', order: 1 }]),
      () => StorageService.updateImageOrder('ws-A', 'prod-A', [{ id: 'img-B1', order: 1 }]),
      () => StorageService.updateImageOrder('ws-A', 'prod-A', [{ id: 'img-nope', order: 1 }]),
      () => StorageService.updateImageOrder('ws-A', 'prod-A', [{ id: 'img-A2-1', order: 1 }]),
    ];
    const messages: string[] = [];
    for (const attempt of attempts) {
      try {
        await attempt();
        messages.push('NO ERROR');
      } catch (error) {
        messages.push((error as Error).message);
      }
    }
    expect(new Set(messages)).toEqual(new Set([ACCESS_DENIED]));
    for (const m of messages) {
      expect(m).not.toContain('img-');
    }
  });
});

describe('StorageService.updateImageOrder — authorized reordering still works', () => {
  it('reorders the product’s own images (positive control)', async () => {
    await StorageService.updateImageOrder('ws-A', 'prod-A', [
      { id: 'img-A3', order: 0, isMain: true },
      { id: 'img-A1', order: 1 },
      { id: 'img-A2', order: 2 },
    ]);
    const after = fake.imagesSnapshot();
    expect(after['img-A3']).toMatchObject({ order: 0, isMain: true });
    expect(after['img-A1']).toMatchObject({ order: 1, isMain: false }); // isMain omitted -> false (existing semantics)
    expect(after['img-A2']).toMatchObject({ order: 2, isMain: false });
    expect(fake.state.writes).toBe(3);
  });

  it('every write is filtered by id AND productId', async () => {
    await StorageService.updateImageOrder('ws-A', 'prod-A', [
      { id: 'img-A1', order: 1 },
      { id: 'img-A2', order: 0 },
    ]);
    expect(fake.state.updateWheres).toEqual([
      { id: 'img-A1', productId: 'prod-A' },
      { id: 'img-A2', productId: 'prod-A' },
    ]);
  });

  it('the ownership query is scoped by product AND workspace', async () => {
    await StorageService.updateImageOrder('ws-A', 'prod-A', [{ id: 'img-A1', order: 1 }]);
    expect(fake.state.findManyCalls).toHaveLength(1);
    expect(fake.state.findManyCalls[0].where).toEqual({
      id: { in: ['img-A1'] },
      productId: 'prod-A',
      product: { workspaceId: 'ws-A' },
    });
  });

  it('an empty list is a no-op success (no ownership query, no write)', async () => {
    const before = fake.imagesSnapshot();
    await expect(StorageService.updateImageOrder('ws-A', 'prod-A', [])).resolves.toBeUndefined();
    expect(fake.state.findManyCalls).toHaveLength(0);
    expect(fake.state.writes).toBe(0);
    expect(fake.imagesSnapshot()).toEqual(before);
  });

  it('duplicate ids are checked once and still applied in order (last wins, as before)', async () => {
    await StorageService.updateImageOrder('ws-A', 'prod-A', [
      { id: 'img-A1', order: 4 },
      { id: 'img-A1', order: 6 },
    ]);
    expect(fake.state.findManyCalls[0].where.id).toEqual({ in: ['img-A1'] });
    expect(fake.imagesSnapshot()['img-A1'].order).toBe(6);
  });

  it('a duplicated foreign id is still rejected', async () => {
    await expect(
      StorageService.updateImageOrder('ws-A', 'prod-A', [
        { id: 'img-B1', order: 1 },
        { id: 'img-B1', order: 2 },
      ])
    ).rejects.toThrow(ACCESS_DENIED);
    expect(fake.state.writes).toBe(0);
  });
});

describe('StorageService.updateImageOrder — defense in depth and atomicity', () => {
  it('if an id stops belonging to the product after the check, the write filter refuses it and the whole transaction rolls back', async () => {
    // Simulate a race: the ownership check is told everything is fine, but
    // img-A2-1 actually lives on another product. The write filter
    // (id + productId) must still refuse it, and the earlier write in the
    // same transaction (img-A1) must be rolled back.
    fake.state.forceFindManyIds = ['img-A1', 'img-A2-1'];
    const before = fake.imagesSnapshot();
    await expect(
      StorageService.updateImageOrder('ws-A', 'prod-A', [
        { id: 'img-A1', order: 9 },
        { id: 'img-A2-1', order: 9 },
      ])
    ).rejects.toThrow();
    expect(fake.imagesSnapshot()).toEqual(before);
    expect(fake.state.writes).toBe(0);
  });

  it('uses a single transaction: all writes apply together (positive control of atomicity)', async () => {
    await StorageService.updateImageOrder('ws-A', 'prod-A', [
      { id: 'img-A1', order: 2 },
      { id: 'img-A2', order: 1 },
      { id: 'img-A3', order: 0 },
    ]);
    expect(fake.state.writes).toBe(3);
  });
});
