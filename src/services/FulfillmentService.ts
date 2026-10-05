import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { SubscriptionService } from './SubscriptionService';
import { NotificationService } from './NotificationService';
import { getFulfillmentProvider } from './fulfillment/registry';
import type { CreateFulfillmentOrderInput } from './fulfillment/FulfillmentProvider';

type OrderWithItemsForFulfillment = Prisma.OrderGetPayload<{
  include: { items: { include: { product: true } } };
}>;

export class FulfillmentService {
  /**
   * Shared first half of both sendToFulfillment and
   * sendToFulfillmentViaProvider — the plan gate, order lookup, duplicate
   * check, partner lookup, FulfillmentOrder creation, and Order status
   * flip, BYTE-FOR-BYTE the same logic that lived directly inside
   * sendToFulfillment before Phase C. Factored out so neither public
   * method duplicates it.
   */
  private static async createFulfillmentOrderRecord(orderId: string, workspaceId: string, partnerId: string) {
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

    return { fulfillmentOrder, partner, order };
  }

  /**
   * Shared dispatch to a real FulfillmentProvider, used by both
   * sendToFulfillment (when partner.providerId is configured) and
   * sendToFulfillmentViaProvider (with an explicitly-passed providerId
   * that overrides whatever is or isn't configured on the partner row).
   *
   * FAILURE HANDLING (Phase C / Q4): a provider failure NEVER leaves the
   * silent, inconsistent pair Order.status="processing" +
   * FulfillmentOrder.status="pending". Both are updated to the already-
   * existing, documented failure values (FulfillmentOrder.status="failed",
   * Order.status="error" — both already part of each model's own
   * pre-existing status vocabulary, see their Prisma comments; neither is
   * invented here) BEFORE the real error is rethrown unmodified to the
   * caller. No automatic retry (explicitly out of scope for V1) — a
   * human/future-reconciliation action is required to move past "failed".
   */
  private static async dispatchToProvider(
    fulfillmentOrder: { id: string; orderId: string; workspaceId: string },
    order: OrderWithItemsForFulfillment,
    providerId: string
  ) {
    const providerInput: CreateFulfillmentOrderInput = {
      workspaceId: fulfillmentOrder.workspaceId,
      orderId: fulfillmentOrder.orderId,
      items: order.items.map((item) => ({
        productId: item.productId,
        sku: item.product.sku,
        title: item.title,
        quantity: item.quantity,
      })),
      shippingAddress: {
        line1: order.shippingAddress,
        line2: order.shippingAddress2 ?? undefined,
        city: order.shippingCity,
        state: order.shippingState ?? undefined,
        postalCode: order.shippingPostalCode,
        country: order.shippingCountry,
        phone: order.shippingPhone ?? undefined,
        email: order.shippingEmail ?? undefined,
      },
      // shippingRequirements intentionally omitted — no real,
      // non-fabricated source exists for it anywhere in ADKSY today; see
      // docs/fulfillment/ARCHITECTURE.md.
    };

    const provider = getFulfillmentProvider(providerId);

    try {
      const providerStatus = await provider.createFulfillmentOrder(providerInput);
      return prisma.fulfillmentOrder.update({
        where: { id: fulfillmentOrder.id },
        data: { externalOrderId: providerStatus.externalOrderId, status: providerStatus.status },
        include: { partner: true },
      });
    } catch (error) {
      // Best-effort cleanup writes — each wrapped so a logging/notification
      // failure here can never mask or replace the real provider error
      // that's about to be rethrown below.
      await prisma.fulfillmentOrder
        .update({ where: { id: fulfillmentOrder.id }, data: { status: 'failed' } })
        .catch((updateError) => console.error('[FulfillmentService] Failed to mark FulfillmentOrder as failed after provider error:', updateError));

      await prisma.order
        .update({ where: { id: fulfillmentOrder.orderId }, data: { status: 'error' } })
        .catch((updateError) => console.error('[FulfillmentService] Failed to mark Order as error after provider failure:', updateError));

      // NotificationService.createNotification never throws (it catches
      // its own errors internally) — not wrapped further here.
      const errorMessage = error instanceof Error ? error.message : String(error);
      await NotificationService.notifyFulfillmentError(
        fulfillmentOrder.workspaceId,
        fulfillmentOrder.orderId,
        errorMessage,
        order.customerEmail
      );

      throw error;
    }
  }

  /**
   * Send order to fulfillment partner — the real, main entry point.
   * PUBLIC SIGNATURE UNCHANGED (Phase C requirement): sendToFulfillment(
   * orderId, workspaceId, partnerId). Every existing caller (send_to_fulfillment
   * the AI tool, POST /api/fulfillment/send, the dashboard) keeps working
   * identically.
   *
   * Behavior:
   * - partner.providerId === null (every partner that exists today,
   *   including the seeded "ShipMock France") -> historical behavior,
   *   STRICTLY UNCHANGED: returns the freshly-created FulfillmentOrder,
   *   no provider ever called.
   * - partner.providerId set -> also dispatches to that real
   *   FulfillmentProvider via the shared dispatchToProvider above.
   */
  static async sendToFulfillment(orderId: string, workspaceId: string, partnerId: string) {
    const { fulfillmentOrder, partner, order } = await this.createFulfillmentOrderRecord(orderId, workspaceId, partnerId);

    if (!partner.providerId) {
      return fulfillmentOrder;
    }

    return this.dispatchToProvider(fulfillmentOrder, order, partner.providerId);
  }

  /**
   * Explicit-override entry point: dispatches to the given providerId
   * regardless of whatever is (or isn't) configured on the partner row —
   * useful to exercise/test the provider path for a partner that has no
   * providerId configured yet. Shares its creation and dispatch logic
   * with sendToFulfillment above (no duplication); never calls
   * sendToFulfillment internally (which would risk dispatching to a
   * provider TWICE if the partner also has its own providerId set).
   */
  static async sendToFulfillmentViaProvider(orderId: string, workspaceId: string, partnerId: string, providerId: string) {
    const { fulfillmentOrder, order } = await this.createFulfillmentOrderRecord(orderId, workspaceId, partnerId);
    return this.dispatchToProvider(fulfillmentOrder, order, providerId);
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
