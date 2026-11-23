/**
 * R3-C.6 — ProductService.updateProduct writes only allowlisted columns.
 * Pure unit test (no DB, no network): Prisma is replaced by a recorder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    product: { findFirst: vi.fn(), update: vi.fn() },
    inventory: { update: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/services/SubscriptionService', () => ({ SubscriptionService: {} }));
vi.mock('@/services/ListingService', () => ({ ListingService: {} }));

import { PRODUCT_UPDATABLE_FIELDS, pickProductUpdateFields, ProductService } from '@/services/ProductService';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.product.findFirst.mockResolvedValue({ id: 'p1', workspaceId: 'ws-1' });
  prismaMock.product.update.mockResolvedValue({ id: 'p1', images: [] });
  prismaMock.inventory.update.mockResolvedValue({});
});

describe('pickProductUpdateFields', () => {
  it('keeps every allowlisted field and nothing else', () => {
    const dirty = {
      title: 't', sellingPrice: 5, quantity: 2, etsyTaxonomyId: 7,
      workspaceId: 'other', id: 'x', deletedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      workspace: { connect: { id: 'other' } }, images: { deleteMany: {} }, __proto__x: 1,
    };
    expect(pickProductUpdateFields(dirty)).toEqual({ title: 't', sellingPrice: 5, quantity: 2, etsyTaxonomyId: 7 });
  });

  it('never lets ownership or lifecycle columns through', () => {
    for (const forbidden of ['workspaceId', 'id', 'deletedAt', 'createdAt', 'updatedAt', 'workspace', 'images', 'inventory', 'listings']) {
      expect((PRODUCT_UPDATABLE_FIELDS as readonly string[]).includes(forbidden)).toBe(false);
    }
  });

  it('drops undefined values, ignores inherited keys and tolerates non-objects', () => {
    expect(pickProductUpdateFields({ title: undefined, brand: 'b' })).toEqual({ brand: 'b' });
    expect(pickProductUpdateFields(Object.create({ title: 'inherited' }))).toEqual({});
    for (const junk of [null, undefined, 'x', 5, []]) expect(pickProductUpdateFields(junk)).toEqual({});
  });

  it('keeps falsy but meaningful values (0, empty string, false-ish numbers)', () => {
    expect(pickProductUpdateFields({ purchasePrice: 0, location: '', quantity: 1 })).toEqual({ purchasePrice: 0, location: '', quantity: 1 });
  });
});

describe('ProductService.updateProduct', () => {
  it('writes only allowlisted columns and still scopes the lookup by workspace', async () => {
    await ProductService.updateProduct('p1', 'ws-1', { title: 'new', workspaceId: 'ws-evil', deletedAt: null, id: 'zzz' } as any);
    expect(prismaMock.product.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', workspaceId: 'ws-1' } });
    const args = prismaMock.product.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'p1' });
    expect(args.data).toEqual({ title: 'new' });
    expect(Object.keys(args.data)).not.toContain('workspaceId');
  });

  it('refuses a product that is not in the caller workspace, before any write', async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);
    await expect(ProductService.updateProduct('p1', 'ws-1', { title: 'x' } as any)).rejects.toThrow('Product not found');
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });

  it('still syncs inventory when quantity changes (behaviour preserved)', async () => {
    await ProductService.updateProduct('p1', 'ws-1', { quantity: 4 } as any);
    expect(prismaMock.inventory.update).toHaveBeenCalledWith({
      where: { productId_workspaceId: { productId: 'p1', workspaceId: 'ws-1' } },
      data: { quantity: 4, available: 4 },
    });
  });

  it('does not touch inventory when quantity is absent', async () => {
    await ProductService.updateProduct('p1', 'ws-1', { title: 'x' } as any);
    expect(prismaMock.inventory.update).not.toHaveBeenCalled();
  });
});
