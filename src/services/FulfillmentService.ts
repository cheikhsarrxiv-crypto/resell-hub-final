import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { SubscriptionService } from './SubscriptionService';

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
      // Fulfillment is a paid-plan feature (Pro/Business) — gate the
      // actual creation point server-side, not just its UI visibility.
      if (!(await SubscriptionService.hasFeature(workspaceId, 'fulfillmentEnabled'))) {
        throw new Error('Fulfillment is not included in your current plan');
      }

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

    // Phase 8 idempotency fix: a second call for a fulfillment order
    // already at 'shipped' (or beyond, i.e. 'delivered') previously fell
    // through to prisma.shipment.create unconditionally, which would have
    // fabricated a SECOND shipment/tracking-event history had Shipment.
    // fulfillmentOrderId's real @unique constraint not caught it as a raw
    // P2002. A repeat call (double-click, retry) now safely replays the
    // existing shipment instead, never creating a duplicate.
    if (fulfillmentOrder.status === 'shipped' || fulfillmentOrder.status === 'delivered') {
      const existingShipment = await prisma.shipment.findUnique({ where: { fulfillmentOrderId } });
      return { fulfillmentOrder, shipment: existingShipment, alreadyShipped: true as const };
    }

    // Phase 8 — the conditional claim AND every write it unlocks now run
    // inside ONE real Prisma interactive transaction. This matters beyond
    // the conditional UPDATE itself: Postgres holds the row lock an UPDATE
    // takes for the rest of THIS transaction, not just for the UPDATE
    // statement — so a second, concurrent call's own updateMany on the
    // same fulfillmentOrderId genuinely blocks until this ENTIRE
    // transaction (including shipment.create/trackingEvent.create below)
    // has committed, then correctly sees status already 'shipped' and
    // takes the claim.count===0 branch below. Without the transaction
    // wrapper, a loser could reach its own shipment.findUnique() before
    // the winner's shipment.create() had actually run yet. No migration:
    // this only changes how existing statements are grouped.
    return prisma.$transaction(async (tx) => {
      // Atomic conditional transition — the WHERE clause's status
      // exclusion and the write happen in the SAME SQL UPDATE, so under
      // concurrent transactions only the one whose statement actually
      // matches the row (still pre-shipped) wins. Same principle as
      // ProductService.reserveInventory's atomic `available: {gte}` guard.
      const claim = await tx.fulfillmentOrder.updateMany({
        where: { id: fulfillmentOrderId, workspaceId, status: { notIn: ['shipped', 'delivered'] } },
        data: { status: 'shipped' },
      });

      if (claim.count === 0) {
        // Lost the race — another transaction already shipped this, and
        // (per this transaction's own header comment) has already fully
        // committed by the time our own updateMany's row lock is released
        // to us, so this read is never stale.
        const current = await tx.fulfillmentOrder.findFirst({ where: { id: fulfillmentOrderId, workspaceId } });
        const existingShipment = await tx.shipment.findUnique({ where: { fulfillmentOrderId } });
        return { fulfillmentOrder: current ?? fulfillmentOrder, shipment: existingShipment, alreadyShipped: true as const };
      }

      const updated = (await tx.fulfillmentOrder.findFirst({ where: { id: fulfillmentOrderId, workspaceId } }))!;

      // Update associated order
      await tx.order.update({
        where: { id: fulfillmentOrder.orderId },
        data: { status: 'shipped' },
      });

      let shipment;
      try {
        // Create shipment
        shipment = await tx.shipment.create({
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
      } catch (error) {
        // Defense-in-depth backstop against the real DB constraint
        // (Shipment.fulfillmentOrderId is @unique) — should be unreachable
        // now that the updateMany claim above already serializes this
        // within one transaction, but never silently swallowed if it's a
        // genuinely different error.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existingShipment = await tx.shipment.findUnique({ where: { fulfillmentOrderId } });
          return { fulfillmentOrder: updated, shipment: existingShipment, alreadyShipped: true as const };
        }
        throw error;
      }

      // Add tracking events
      await tx.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: 'picked_up',
          location: 'Fulfillment Center Paris',
          description: 'Package picked up from fulfillment center',
        },
      });

      await tx.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: 'in_transit',
          location: 'Distribution Center Lyon',
          description: 'Package in transit to delivery area',
        },
      });

      return { fulfillmentOrder: updated, shipment };
    });
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

    // Phase 8 idempotency fix: a second call previously re-set
    // Shipment.actualDelivery to `new Date()` on every retry (silently
    // corrupting an already-recorded real delivery timestamp) AND created a
    // second 'delivered' TrackingEvent every time — both real data-integrity
    // bugs a duplicate confirmation/retry would trigger. Already-delivered
    // is now a pure, safe replay: nothing is re-written.
    if (fulfillmentOrder.status === 'delivered') {
      const existingShipment = await prisma.shipment.findUnique({ where: { fulfillmentOrderId } });
      return { fulfillmentOrder, shipment: existingShipment, alreadyDelivered: true as const };
    }

    // Phase 8 — see simulateOrderShipped's own comment for exactly why the
    // conditional claim and every write it unlocks must run inside ONE
    // real Prisma transaction (the row lock an UPDATE takes is held for
    // the rest of the transaction, closing the race window a bare
    // updateMany + separate writes would leave open). No migration: only
    // how existing statements are grouped changes.
    return prisma.$transaction(async (tx) => {
      // Atomic conditional transition — same real guard as
      // simulateOrderShipped above: only one concurrent transaction can
      // ever win this UPDATE for a given row.
      const claim = await tx.fulfillmentOrder.updateMany({
        where: { id: fulfillmentOrderId, workspaceId, status: { not: 'delivered' } },
        data: { status: 'delivered' },
      });

      if (claim.count === 0) {
        // Lost the race — another transaction already delivered this, and
        // has already fully committed by the time our own updateMany's row
        // lock is released to us. Never proceed to a second write.
        const current = await tx.fulfillmentOrder.findFirst({ where: { id: fulfillmentOrderId, workspaceId } });
        const existingShipment = await tx.shipment.findUnique({ where: { fulfillmentOrderId } });
        return { fulfillmentOrder: current ?? fulfillmentOrder, shipment: existingShipment, alreadyDelivered: true as const };
      }

      const updated = (await tx.fulfillmentOrder.findFirst({ where: { id: fulfillmentOrderId, workspaceId } }))!;

      // Update order
      await tx.order.update({
        where: { id: fulfillmentOrder.orderId },
        data: { status: 'delivered' },
      });

      // Update shipment — genuinely optional: a fulfillment order can reach
      // 'delivered' with no Shipment row at all if simulateOrderShipped was
      // never called for it first (an existing, preserved state transition,
      // not something this fix introduces or blocks). Never fabricates a
      // shipment to fill the gap — the return's shipment stays null.
      const existingShipment = await tx.shipment.findUnique({
        where: { fulfillmentOrderId },
      });

      if (!existingShipment) {
        return { fulfillmentOrder: updated, shipment: null };
      }

      // The updated row, never the stale pre-update snapshot — the exact
      // same "return what update() itself returned, not what findUnique()
      // saw a moment earlier" fix applied throughout this method.
      const shipment = await tx.shipment.update({
        where: { id: existingShipment.id },
        data: {
          status: 'delivered',
          actualDelivery: new Date(),
        },
      });

      // Add final tracking event
      await tx.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: 'delivered',
          location: 'Delivered',
          description: 'Package delivered to recipient',
        },
      });

      return { fulfillmentOrder: updated, shipment };
    });
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
