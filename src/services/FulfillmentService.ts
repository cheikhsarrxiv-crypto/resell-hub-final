import { prisma } from '@/lib/prisma';

export class FulfillmentService {
  /**
   * Send order to fulfillment partner
   */
  static async sendToFulfillment(
    orderId: string,
    workspaceId: string,
    partnerId: string
  ) {
    try {
      // Get order with details
      const order = await prisma.order.findFirst({
        where: { id: orderId, workspaceId },
        include: {
          items: { include: { product: true } },
          listing: { include: { connection: { include: { marketplace: true } } } },
        },
      });

      if (!order) {
        throw new Error('Order not found');
      }

      // Check if fulfillment order already exists
      const existing = await prisma.fulfillmentOrder.findFirst({
        where: { orderId },
      });

      if (existing) {
        throw new Error('Fulfillment order already created');
      }

      // Get partner
      const partner = await prisma.fulfillmentPartner.findUnique({
        where: { id: partnerId },
      });

      if (!partner) {
        throw new Error('Fulfillment partner not found');
      }

      // Calculate costs
      const totalCost = partner.costPerOrder + (order.items.length * 0.5);
      const profit = order.estimatedProfit - totalCost;

      // Create fulfillment order
      const fulfillmentOrder = await prisma.fulfillmentOrder.create({
        data: {
          workspaceId,
          orderId,
          partnerId,
          status: 'pending',
          quantity: order.items.reduce((sum: any, item: any) => sum + item.quantity, 0),
          totalCost,
          revenue: order.totalPrice,
          profit,
          externalOrderId: `FUL-${Date.now()}`,
        },
        include: {
          partner: true,
        },
      });

      // Update order status
      await prisma.order.update({
        where: { id: orderId },
        data: {
          fulfillmentType: 'automatic',
          status: 'processing',
        },
      });

      return fulfillmentOrder;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Simulate fulfillment partner accepting the order
   * In production, this would be triggered by webhook from partner
   */
  static async simulateOrderAccepted(fulfillmentOrderId: string, workspaceId: string) {
    const fulfillmentOrder = await prisma.fulfillmentOrder.findFirst({
      where: { id: fulfillmentOrderId, workspaceId },
    });

    if (!fulfillmentOrder) {
      throw new Error('Fulfillment order not found');
    }

    return prisma.fulfillmentOrder.update({
      where: { id: fulfillmentOrderId },
      data: { status: 'accepted' },
    });
  }

  /**
   * Simulate order processing at fulfillment partner
   */
  static async simulateOrderProcessing(fulfillmentOrderId: string, workspaceId: string) {
    const fulfillmentOrder = await prisma.fulfillmentOrder.findFirst({
      where: { id: fulfillmentOrderId, workspaceId },
    });

    if (!fulfillmentOrder) {
      throw new Error('Fulfillment order not found');
    }

    return prisma.fulfillmentOrder.update({
      where: { id: fulfillmentOrderId },
      data: { status: 'processing' },
    });
  }

  /**
   * Simulate shipment with tracking
   */
  static async simulateOrderShipped(
    fulfillmentOrderId: string,
    workspaceId: string,
    trackingNumber?: string,
    carrier?: string
  ) {
    const fulfillmentOrder = await prisma.fulfillmentOrder.findFirst({
      where: { id: fulfillmentOrderId, workspaceId },
    });

    if (!fulfillmentOrder) {
      throw new Error('Fulfillment order not found');
    }

    // Update fulfillment order
    const updated = await prisma.fulfillmentOrder.update({
      where: { id: fulfillmentOrderId },
      data: { status: 'shipped' },
    });

    // Update associated order
    await prisma.order.update({
      where: { id: fulfillmentOrder.orderId },
      data: { status: 'shipped' },
    });

    // Create shipment
    const shipment = await prisma.shipment.create({
      data: {
        fulfillmentOrderId,
        partnerId: fulfillmentOrder.partnerId,
        trackingNumber: trackingNumber || this.generateTrackingNumber(),
        carrier: carrier || 'La Poste',
        trackingUrl: `https://www.laposte.fr/outils/suivre-vos-envois?code=${trackingNumber || 'FR123456789'}`,
        status: 'in_transit',
        estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    });

    // Add tracking events
    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        status: 'picked_up',
        location: 'Fulfillment Center Paris',
        description: 'Package picked up from fulfillment center',
      },
    });

    await prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        status: 'in_transit',
        location: 'Distribution Center Lyon',
        description: 'Package in transit to delivery area',
      },
    });

    return { fulfillmentOrder: updated, shipment };
  }

  /**
   * Simulate delivery
   */
  static async simulateOrderDelivered(fulfillmentOrderId: string, workspaceId: string) {
    const fulfillmentOrder = await prisma.fulfillmentOrder.findFirst({
      where: { id: fulfillmentOrderId, workspaceId },
      include: { order: true },
    });

    if (!fulfillmentOrder) {
      throw new Error('Fulfillment order not found');
    }

    // Update fulfillment order
    const updated = await prisma.fulfillmentOrder.update({
      where: { id: fulfillmentOrderId },
      data: { status: 'delivered' },
    });

    // Update order
    await prisma.order.update({
      where: { id: fulfillmentOrder.orderId },
      data: { status: 'delivered' },
    });

    // Update shipment
    const shipment = await prisma.shipment.findUnique({
      where: { fulfillmentOrderId },
    });

    if (shipment) {
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          status: 'delivered',
          actualDelivery: new Date(),
        },
      });

      // Add final tracking event
      await prisma.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: 'delivered',
          location: 'Delivered',
          description: 'Package delivered to recipient',
        },
      });
    }

    return updated;
  }

  /**
   * Get fulfillment order with all details
   */
  static async getFulfillmentOrder(fulfillmentOrderId: string, workspaceId: string) {
    return prisma.fulfillmentOrder.findFirst({
      where: { id: fulfillmentOrderId, workspaceId },
      include: {
        order: {
          include: {
            items: { include: { product: true } },
            listing: { include: { connection: { include: { marketplace: true } } } },
          },
        },
        partner: true,
        shipment: {
          include: { trackingEvents: { orderBy: { timestamp: 'desc' } } },
        },
      },
    });
  }

  /**
   * Get all fulfillment orders for workspace
   */
  static async getFulfillmentOrders(
    workspaceId: string,
    status?: string,
    limit = 50,
    offset = 0
  ) {
    const [orders, total] = await Promise.all([
      prisma.fulfillmentOrder.findMany({
        where: {
          workspaceId,
          ...(status ? { status } : {}),
        },
        include: {
          order: {
            include: {
              items: true,
              listing: { include: { connection: { include: { marketplace: true } } } },
            },
          },
          partner: true,
          shipment: {
            include: { trackingEvents: { orderBy: { timestamp: 'desc' }, take: 1 } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.fulfillmentOrder.count({
        where: {
          workspaceId,
          ...(status ? { status } : {}),
        },
      }),
    ]);

    return { orders, total };
  }

  /**
   * Get fulfillment metrics
   */
  static async getFulfillmentMetrics(workspaceId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const orders = await prisma.fulfillmentOrder.findMany({
      where: {
        workspaceId,
        createdAt: {
          gte: startDate,
        },
      },
    });

    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum: any, o: any) => sum + o.revenue, 0);
    const totalCost = orders.reduce((sum: any, o: any) => sum + o.totalCost, 0);
    const totalProfit = orders.reduce((sum: any, o: any) => sum + o.profit, 0);

    return {
      totalOrders,
      totalRevenue,
      totalCost,
      totalProfit,
      averageCostPerOrder: totalOrders > 0 ? totalCost / totalOrders : 0,
      averageProfitPerOrder: totalOrders > 0 ? totalProfit / totalOrders : 0,
      margin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    };
  }

  /**
   * Get available fulfillment partners
   */
  static async getAvailablePartners() {
    return prisma.fulfillmentPartner.findMany({
      where: { status: 'active' },
    });
  }

  /**
   * Generate mock tracking number
   */
  private static generateTrackingNumber(): string {
    const prefix = 'FR';
    const timestamp = Date.now().toString().slice(-9);
    return `${prefix}${timestamp}`;
  }
}
