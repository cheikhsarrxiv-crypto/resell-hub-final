import { CreateOrderInput } from '@/lib/validations';
import { prisma } from '@/lib/prisma';
import { ProductService } from './ProductService';
import { SubscriptionService } from './SubscriptionService';

export class OrderService {
  static async createOrder(workspaceId: string, data: CreateOrderInput) {
    try {
      // Get listing details
      const listing = await prisma.listing.findFirst({
        where: {
          id: data.listingId,
          workspaceId,
        },
        include: {
          product: true,
          connection: {
            include: { marketplace: true },
          },
        },
      });

      if (!listing) {
        throw new Error('Listing not found');
      }

      // Check order limit. Falls back to the free plan's real limits when
      // there is no active subscription, instead of skipping the check.
      if (await SubscriptionService.isLimitReached(workspaceId, 'orders')) {
        throw new Error('Order limit reached for your plan');
      }

      // Reserve inventory
      await ProductService.reserveInventory(listing.productId, workspaceId, 1);

      // Create order
      const order = await prisma.order.create({
        data: {
          workspaceId,
          listingId: data.listingId,
          customerId: `CUST-${Date.now()}`,
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          totalPrice: data.totalPrice,
          marketplaceFees: data.marketplaceFees,
          estimatedProfit: data.estimatedProfit,
          fulfillmentType: data.fulfillmentType || 'self',
          shippingAddress: data.shippingAddress,
          shippingCity: data.shippingCity,
          shippingPostalCode: data.shippingPostalCode,
          shippingCountry: data.shippingCountry,
          status: 'pending',
          items: {
            create: [
              {
                productId: listing.productId,
                title: listing.product.title,
                quantity: 1,
                price: listing.price,
              },
            ],
          },
        },
        include: {
          items: {
            include: { product: true },
          },
          listing: {
            include: { connection: { include: { marketplace: true } } },
          },
        },
      });

      return order;
    } catch (error) {
      throw error;
    }
  }

  static async getOrder(orderId: string, workspaceId: string) {
    return prisma.order.findFirst({
      where: {
        id: orderId,
        workspaceId,
      },
      include: {
        items: { include: { product: true } },
        listing: {
          include: { connection: { include: { marketplace: true } } },
        },
        fulfillmentOrder: {
          include: {
            partner: true,
            shipment: {
              include: { trackingEvents: { orderBy: { timestamp: 'desc' } } },
            },
          },
        },
      },
    });
  }

  static async getOrders(workspaceId: string, limit = 50, offset = 0, status?: string) {
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: {
          workspaceId,
          ...(status ? { status } : {}),
        },
        include: {
          items: { include: { product: true } },
          listing: {
            include: { connection: { include: { marketplace: true } } },
          },
          fulfillmentOrder: {
            include: { partner: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.order.count({
        where: {
          workspaceId,
          ...(status ? { status } : {}),
        },
      }),
    ]);

    return { orders, total };
  }

  static async updateOrderStatus(orderId: string, workspaceId: string, status: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, workspaceId },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    return prisma.order.update({
      where: { id: orderId },
      data: { status },
    });
  }

  static async cancelOrder(orderId: string, workspaceId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, workspaceId },
      include: { items: true },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Release inventory
    for (const item of order.items) {
      await ProductService.releaseInventory(item.productId, workspaceId, item.quantity);
    }

    return prisma.order.update({
      where: { id: orderId },
      data: { status: 'cancelled' },
    });
  }

  static async getOrdersByDateRange(
    workspaceId: string,
    startDate: Date,
    endDate: Date
  ) {
    return prisma.order.findMany({
      where: {
        workspaceId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        items: true,
        fulfillmentOrder: true,
      },
    });
  }

  static async getOrderMetrics(workspaceId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const endDate = new Date();

    const orders = await this.getOrdersByDateRange(workspaceId, startDate, endDate);

    const totalRevenue = orders.reduce((sum: any, order: any) => sum + order.totalPrice, 0);
    const totalFees = orders.reduce((sum: any, order: any) => sum + order.marketplaceFees, 0);
    const totalProfit = orders.reduce((sum: any, order: any) => sum + order.estimatedProfit, 0);

    return {
      orderCount: orders.length,
      totalRevenue,
      totalFees,
      totalProfit,
      averageOrderValue: orders.length > 0 ? totalRevenue / orders.length : 0,
      averageProfit: orders.length > 0 ? totalProfit / orders.length : 0,
    };
  }
}
