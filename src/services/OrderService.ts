import { CreateOrderInput } from '@/lib/validations';
import { prisma } from '@/lib/prisma';
import { ProductService } from './ProductService';
import { SubscriptionService } from './SubscriptionService';
import {
  orderDetailPublicInclude,
  orderListResponseSelect,
  orderDetailResponseSelect,
} from '@/lib/publicResponseSelects';

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
          // The listing being sold is already known here (unlike
          // OrdersSyncService's best-effort resolution for synced orders)
          // — but a purely ADKSY-native listing (never published to any
          // marketplace) has no connection, so this stays null rather than
          // guessing.
          marketplace: listing.connection?.marketplace?.name || null,
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
                // Historical cost snapshot — see OrderItem.purchasePrice in
                // the schema. Never re-read from Product afterwards.
                purchasePrice: listing.product.purchasePrice,
              },
            ],
          },
        },
        // Returned to the browser by POST /api/orders: public relations only
        // (the internal listing query above keeps its full include).
        include: orderDetailPublicInclude,
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
      include: orderDetailPublicInclude,
    });
  }

  /**
   * Order shaped for an API response (GET /api/orders/[id], POST
   * /api/orders): only what the order detail page reads. getOrder() below
   * stays the richer, internal lookup (AI tools read tracking URL, ETA,
   * externalOrderId, customerId, ...).
   */
  static async getOrderForResponse(orderId: string, workspaceId: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        workspaceId,
      },
      select: orderDetailResponseSelect,
    });
    if (!order) return order;
    // S8: derived flag only (R3-B.5.6 keeps externalOrderId out of responses): was this order imported from a
    // marketplace (profit never computed) or created in ADKSY?
    const synced = await prisma.order.count({ where: { id: orderId, workspaceId, externalOrderId: { not: null } } });
    return { ...order, profitKnown: (synced ?? 0) === 0 };
  }

  /**
   * Same write path as createOrder (unchanged business behavior), then the
   * minimal response shape, re-read inside the same workspace.
   */
  static async createOrderForResponse(workspaceId: string, data: CreateOrderInput) {
    const created = await this.createOrder(workspaceId, data);
    return this.getOrderForResponse(created.id, workspaceId);
  }

  static async getOrders(workspaceId: string, limit = 50, offset = 0, status?: string) {
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: {
          workspaceId,
          ...(status ? { status } : {}),
        },
        // Response shape: only the columns the orders list page reads.
        select: orderListResponseSelect,
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

    // S8: derived flag (see getOrderForResponse) from an id-only query scoped to the same workspace.
    const ids = orders.map((o: { id: string }) => o.id);
    const synced = ids.length
      ? await prisma.order.findMany({
          where: { workspaceId, id: { in: ids }, externalOrderId: { not: null } },
          select: { id: true },
        })
      : [];
    const syncedIds = new Set((synced ?? []).map((o: { id: string }) => o.id));

    return { orders: orders.map((o: { id: string }) => ({ ...o, profitKnown: !syncedIds.has(o.id) })), total };
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
