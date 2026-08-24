import { CreateProductInput, UpdateProductInput } from '@/lib/validations';
import { prisma } from '@/lib/prisma';

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

      // Check plan limits
      const subscription = await prisma.subscription.findUnique({
        where: { id: workspace.subscriptionId || '' },
        include: { plan: true },
      });

      const productCount = await prisma.product.count({
        where: { workspaceId },
      });

      if (subscription?.plan && productCount >= subscription.plan.maxProducts) {
        throw new Error('Product limit reached for your plan');
      }

      // Generate SKU if not provided
      const sku = data.sku || `SKU-${Date.now()}`;

      // Create product
      const product = await prisma.product.create({
        data: {
          ...data,
          description: data.description || '',
          sku,
          workspaceId,
        },
      });

      // Create inventory record
      await prisma.inventory.create({
        data: {
          productId: product.id,
          workspaceId,
          quantity: data.quantity || 1,
          available: data.quantity || 1,
          reserved: 0,
          syncStatus: 'synced',
        },
      });

      return product;
    } catch (error) {
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

    return prisma.inventory.findUnique({
      where: {
        productId_workspaceId: {
          productId,
          workspaceId,
        },
      },
    });
  }

  static async releaseInventory(productId: string, workspaceId: string, quantity: number) {
    return prisma.inventory.update({
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
  }
}
