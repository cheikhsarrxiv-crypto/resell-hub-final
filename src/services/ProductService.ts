import { CreateProductInput, UpdateProductInput } from '@/lib/validations';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { SubscriptionService } from './SubscriptionService';
import { ListingService } from './ListingService';

/** Thrown by ProductService.createProduct on a (workspaceId, sku) conflict — see that method's own comment. Matched by message in /api/products' own route.ts, the same idiom already used for the "already has an active subscription" -> 409 case in /api/stripe/checkout/route.ts. */
export const PRODUCT_SKU_CONFLICT_MESSAGE = 'A product with this SKU already exists in this workspace';

/**
 * Thrown by ProductService.createProduct on a (workspaceId,
 * sourceMarketplace, sourceId) conflict — Product's second, separate
 * @@unique constraint (Option A, provenance/deduplication architecture
 * decision). Not yet mapped to a specific HTTP status in
 * /api/products/route.ts — this step establishes the DB constraint and
 * its clean business error only; the route's dedup-aware UX is deferred
 * to the future create_product work, per this task's own scope.
 */
export const PRODUCT_SOURCE_CONFLICT_MESSAGE = 'A product from this source already exists in this workspace';

export class ProductService {
  static async createProduct(workspaceId: string, data: CreateProductInput) {
    try {
      // Check workspace exists
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });

      if (!workspace) {
        throw new Error('Workspace not found');
      }

      // Check plan limits. SubscriptionService.isLimitReached() falls back
      // to the free plan's real limits when the workspace has no active
      // subscription (or a canceled one with no plan attached) — a
      // workspace in that state must be capped at the free tier, not
      // treated as unlimited.
      if (await SubscriptionService.isLimitReached(workspaceId, 'products')) {
        throw new Error('Product limit reached for your plan');
      }

      // Generate SKU if not provided
      const sku = data.sku || `SKU-${Date.now()}`;

      // Atomicity fix (read-only audit's CRITICAL #1): Product and its
      // Inventory row must commit or roll back together. A Product
      // without an Inventory row is an invalid, silently broken state —
      // get_inventory/reserveInventory both treat a missing Inventory row
      // as "no stock at all" (see those files' own comments), so every
      // future sale of such a Product would fail to reserve stock without
      // any visible error at creation time. Uses Prisma's interactive
      // transaction ($transaction(async (tx) => ...)) rather than the
      // array form already used elsewhere in this codebase (e.g.
      // StorageService.setMainImage) because Inventory.productId depends
      // on the Product row's own generated id, only known once
      // tx.product.create resolves — the array form pre-builds every
      // query before execution and cannot express that dependency.
      const product = await prisma.$transaction(async (tx) => {
        // Create product
        const created = await tx.product.create({
          data: {
            ...data,
            description: data.description || '',
            sku,
            workspaceId,
          },
        });

        // Create inventory record
        await tx.inventory.create({
          data: {
            productId: created.id,
            workspaceId,
            quantity: data.quantity || 1,
            available: data.quantity || 1,
            reserved: 0,
            syncStatus: 'synced',
          },
        });

        return created;
      });

      return product;
    } catch (error) {
      // SKU-conflict fix (read-only audit's CRITICAL #2) + source-conflict
      // fix (Option A, provenance/deduplication architecture decision):
      // Product now has TWO separate @@unique constraints —
      // [workspaceId, sku] and [workspaceId, sourceMarketplace, sourceId]
      // — so a P2002 reaching this catch from tx.product.create is no
      // longer unambiguous on its own; it must be attributed to the right
      // one before being turned into a clean, workspace-scoped business
      // error. Never the raw Prisma message either way, never a second
      // Product, never a value substituted automatically, never an
      // automatic retry.
      //
      // Prisma's PrismaClientKnownRequestError.meta.target for a Postgres
      // unique-constraint violation is documented and has been stable
      // across Prisma versions as the array of column names the violated
      // constraint covers (e.g. ['workspaceId', 'sku']) — NOT the
      // constraint's own name string. This could not be verified against
      // a live Postgres instance in this sandbox (network egress to the
      // configured database is blocked here — see this session's own
      // "DB NOT REACHABLE" check), so this is built on that documented,
      // stable behavior rather than an empirical confirmation; spot-check
      // against a real Postgres connection before relying on this in
      // production, the same discipline already applied elsewhere in this
      // codebase to API behavior that couldn't be verified live (see e.g.
      // EbayBrowseSourcingProvider's own header comment).
      //
      // target is read defensively (array or, defensively, a single
      // string) and checked by exact field-name membership — the two
      // constraints share no field name except workspaceId, which itself
      // is never treated as sufficient on its own to attribute either
      // conflict. If the shape can't be confidently attributed to either
      // known constraint, this deliberately does NOT guess which one
      // fired (guessing wrong would report a misleading cause) — it logs
      // the raw target for diagnosis and still throws a clean, generic,
      // secret-free business error, never the raw Prisma message.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];

        const isSourceConflict = fields.includes('sourceId') || fields.includes('sourceMarketplace');
        const isSkuConflict = fields.includes('sku');

        if (isSourceConflict) {
          throw new Error(PRODUCT_SOURCE_CONFLICT_MESSAGE);
        }
        if (isSkuConflict) {
          throw new Error(PRODUCT_SKU_CONFLICT_MESSAGE);
        }

        console.error('[ProductService] P2002 on Product with an unrecognized meta.target shape — cannot attribute to sku vs. source conflict:', target);
        throw new Error('This product conflicts with an existing product in this workspace');
      }
      throw error;
    }
  }

  static async getProduct(productId: string, workspaceId: string) {
    return prisma.product.findFirst({
      where: {
        id: productId,
        workspaceId,
      },
      include: {
        images: { orderBy: { order: 'asc' } },
      },
    });
  }

  static async getProducts(workspaceId: string, limit = 50, offset = 0) {
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: { workspaceId, deletedAt: null },
        include: {
          images: { orderBy: { order: 'asc' } },
          inventories: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.product.count({ where: { workspaceId, deletedAt: null } }),
    ]);

    return { products, total };
  }

  static async updateProduct(
    productId: string,
    workspaceId: string,
    data: UpdateProductInput
  ) {
    const existing = await prisma.product.findFirst({
      where: { id: productId, workspaceId },
    });

    if (!existing) {
      throw new Error('Product not found');
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data,
      include: {
        images: { orderBy: { order: 'asc' } },
      },
    });

    // Update inventory if quantity changed
    if (data.quantity !== undefined) {
      await prisma.inventory.update({
        where: {
          productId_workspaceId: {
            productId,
            workspaceId,
          },
        },
        data: {
          quantity: data.quantity,
          available: data.quantity,
        },
      });
    }

    return product;
  }

  static async deleteProduct(productId: string, workspaceId: string) {
    const existing = await prisma.product.findFirst({
      where: { id: productId, workspaceId },
    });

    if (!existing) {
      throw new Error('Product not found');
    }

    return prisma.product.update({
      where: { id: productId },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  static async addProductImage(
    productId: string,
    workspaceId: string,
    url: string,
    altText?: string
  ) {
    // Verify product ownership
    const product = await prisma.product.findFirst({
      where: { id: productId, workspaceId },
    });

    if (!product) {
      throw new Error('Product not found');
    }

    // Get max order
    const lastImage = await prisma.productImage.findFirst({
      where: { productId },
      orderBy: { order: 'desc' },
    });

    const isMain = await prisma.productImage.count({
      where: { productId, isMain: true },
    }) === 0;

    return prisma.productImage.create({
      data: {
        productId,
        url,
        altText,
        order: (lastImage?.order || 0) + 1,
        isMain,
      },
    });
  }

  static async removeProductImage(imageId: string, productId: string, workspaceId: string) {
    // Verify ownership
    const product = await prisma.product.findFirst({
      where: { id: productId, workspaceId },
    });

    if (!product) {
      throw new Error('Product not found');
    }

    const image = await prisma.productImage.findUnique({
      where: { id: imageId },
    });

    if (!image || image.productId !== productId) {
      throw new Error('Image not found');
    }

    // If main image, make next image main
    if (image.isMain) {
      const nextImage = await prisma.productImage.findFirst({
        where: { productId, id: { not: imageId } },
        orderBy: { order: 'asc' },
      });

      if (nextImage) {
        await prisma.productImage.update({
          where: { id: nextImage.id },
          data: { isMain: true },
        });
      }
    }

    return prisma.productImage.delete({
      where: { id: imageId },
    });
  }

  static async updateInventory(productId: string, workspaceId: string, quantity: number) {
    return prisma.inventory.update({
      where: {
        productId_workspaceId: {
          productId,
          workspaceId,
        },
      },
      data: {
        quantity,
        available: quantity,
        syncStatus: 'pending',
      },
    });
  }

  static async reserveInventory(productId: string, workspaceId: string, quantity: number) {
    // Atomic conditional decrement: the availability check (available >= quantity)
    // and the decrement happen in the SAME SQL UPDATE statement. PostgreSQL takes a
    // row-level lock for the row it matches, so under concurrent calls the second
    // transaction re-evaluates the WHERE clause against the first transaction's
    // committed result instead of a stale read — this is what makes it race-free,
    // unlike a separate findUnique() check followed by a decrement.
    const result = await prisma.inventory.updateMany({
      where: {
        productId,
        workspaceId,
        available: { gte: quantity },
      },
      data: {
        available: { decrement: quantity },
        reserved: { increment: quantity },
      },
    });

    if (result.count === 0) {
      throw new Error('Insufficient inventory');
    }

    const inventory = await prisma.inventory.findUnique({
      where: {
        productId_workspaceId: {
          productId,
          workspaceId,
        },
      },
    });

    // Mirror the new available quantity to any connected marketplace
    // listing(s) for this product. Inventory.available (just decremented
    // above) stays the ADKSY source of truth regardless of what happens
    // here — this is best-effort: a marketplace-side failure (or even a
    // bug inside syncListingInventory itself) must never undo or fail a
    // reservation that has already succeeded.
    if (inventory) {
      try {
        await ListingService.syncListingInventory(productId, workspaceId, inventory.available);
      } catch (error) {
        console.error(`[ProductService] Failed to sync inventory to marketplace(s) for product ${productId}:`, error);
      }
    }

    return inventory;
  }

  static async releaseInventory(productId: string, workspaceId: string, quantity: number) {
    const inventory = await prisma.inventory.update({
      where: {
        productId_workspaceId: {
          productId,
          workspaceId,
        },
      },
      data: {
        available: {
          increment: quantity,
        },
        reserved: {
          decrement: quantity,
        },
      },
    });

    // Same best-effort mirroring as reserveInventory above — never lets a
    // marketplace-side failure undo or fail a release that already
    // succeeded locally.
    try {
      await ListingService.syncListingInventory(productId, workspaceId, inventory.available);
    } catch (error) {
      console.error(`[ProductService] Failed to sync inventory to marketplace(s) for product ${productId}:`, error);
    }

    return inventory;
  }
}
