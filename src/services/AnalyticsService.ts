import { DashboardMetrics, AdminMetrics, BasicDashboardMetrics } from '@/types';
import { prisma } from '@/lib/prisma';
import {
  aggregateByCurrency,
  aggregateTrend,
  aggregateProductPerformance,
  choosePrimaryCurrency,
  isCancelledOrder,
  isProfitKnown,
  orderCurrency,
} from '@/lib/financial';

export class AnalyticsService {
  /**
   * Get dashboard metrics for a workspace/seller.
   *
   * S8: money is aggregated PER CURRENCY (src/lib/financial.ts) - amounts of different currencies are never
   * added. The flat figures are those of the primary currency (the one with most orders; EUR for a
   * single-currency EUR workspace, i.e. no change for it); every currency, the primary included, is also
   * in `byCurrency`. Cancelled orders are excluded from revenue/profit. A synced order's profit is
   * unknown (not 0): it is left out of profit and margin and counted in `ordersWithUnknownProfit`.
   */
  static async getDashboardMetrics(workspaceId: string, days: number = 30): Promise<DashboardMetrics> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const endDate = new Date();

    // Get orders
    const orders = await prisma.order.findMany({
      where: {
        workspaceId,
        createdAt: { gte: startDate, lte: endDate },
      },
      include: {
        listing: { include: { connection: { include: { marketplace: true } } } },
      },
    });

    // Get fulfillment metrics (each attributed to the currency of its order)
    const fulfillmentOrders = await prisma.fulfillmentOrder.findMany({
      where: {
        workspaceId,
        createdAt: { gte: startDate, lte: endDate },
      },
      include: { order: { select: { currency: true, externalOrderId: true, status: true } } },
    });

    // Count metrics
    const [
      productsCount,
      listings,
      pendingOrders,
      fulfillmentOrdersCount,
    ] = await Promise.all([
      prisma.product.count({ where: { workspaceId, deletedAt: null } }),
      prisma.listing.findMany({
        where: { workspaceId, status: 'active', deletedAt: null },
      }),
      prisma.order.count({
        where: { workspaceId, status: 'pending' },
      }),
      prisma.fulfillmentOrder.count({
        where: {
          workspaceId,
          status: { in: ['processing', 'accepted', 'pending'] },
        },
      }),
    ]);

    const byCurrency = aggregateByCurrency(orders, fulfillmentOrders, (o) => o.listing?.connection?.marketplace?.displayName ?? null);
    const currency = choosePrimaryCurrency(byCurrency);
    const primary = byCurrency.find((b) => b.currency === currency);

    return {
      revenue: primary?.revenue ?? 0,
      orders: orders.length,
      profit: primary?.profit ?? 0,
      margin: primary?.margin ?? 0,
      productsCount,
      activeListings: listings.length,
      pendingOrders,
      fulfillmentOrders: fulfillmentOrdersCount,
      revenueByMarketplace: primary?.revenueByMarketplace ?? {},
      profitByMarketplace: primary?.profitByMarketplace ?? {},
      fulfillmentRevenue: primary?.fulfillmentRevenue ?? 0,
      fulfillmentCost: primary?.fulfillmentCost ?? 0,
      grossProfit: primary?.grossProfit ?? 0,
      netRevenue: primary?.netRevenue ?? 0,
      currency,
      mixedCurrencies: byCurrency.length > 1,
      byCurrency,
      cancelledOrders: byCurrency.reduce((n, b) => n + b.cancelledOrders, 0),
      ordersWithUnknownProfit: primary?.ordersWithUnknownProfit ?? 0,
      marginAvailable: primary?.margin != null,
    };
  }

  /**
   * Basic metrics: the four activity counters of getDashboardMetrics (orders in the period, products,
   * active listings, pending orders), computed with the same filters - and nothing financial, so it can
   * be served to a plan without Advanced analytics. Never reads amounts.
   */
  static async getBasicMetrics(workspaceId: string, days: number = 30): Promise<BasicDashboardMetrics> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const endDate = new Date();

    const [orders, productsCount, activeListings, pendingOrders] = await Promise.all([
      prisma.order.count({ where: { workspaceId, createdAt: { gte: startDate, lte: endDate } } }),
      prisma.product.count({ where: { workspaceId, deletedAt: null } }),
      prisma.listing.count({ where: { workspaceId, status: 'active', deletedAt: null } }),
      prisma.order.count({ where: { workspaceId, status: 'pending' } }),
    ]);

    return { orders, productsCount, activeListings, pendingOrders };
  }

  /**
   * Get admin dashboard metrics
   */
  static async getAdminMetrics(): Promise<AdminMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // User metrics
    const totalUsers = await prisma.user.count();
    const activeUsersData = await prisma.order.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { workspaceId: true },
      distinct: ['workspaceId'],
    });
    const activeUsers = new Set(activeUsersData.map((o: any) => o.workspaceId)).size;

    // Subscription metrics
    const subscriptions = await prisma.subscription.findMany({
      where: { status: 'active' },
      include: { plan: true },
    });

    const mrr = subscriptions.reduce((sum: any, s: any) => sum + s.plan.price, 0);
    const arr = mrr * 12;

    // Subscription by plan
    const subscriptionsByPlan: Record<string, number> = {};
    for (const sub of subscriptions) {
      subscriptionsByPlan[sub.plan.name] = (subscriptionsByPlan[sub.plan.name] || 0) + 1;
    }

    // Order and GMV metrics
    const orders = await prisma.order.findMany();
    const totalOrders = orders.length;
    const gmv = orders.reduce((sum: any, o: any) => sum + o.totalPrice, 0);

    // Fulfillment metrics
    const fulfillmentOrders = await prisma.fulfillmentOrder.findMany();
    const fulfillmentRevenue = fulfillmentOrders.reduce((sum: any, o: any) => sum + o.revenue, 0);
    const fulfillmentCosts = fulfillmentOrders.reduce((sum: any, o: any) => sum + o.totalCost, 0);
    const grossProfit = gmv - fulfillmentCosts;

    // Churn calculation (simplified)
    const cancelledSubs = await prisma.subscription.count({
      where: { status: 'cancelled' },
    });
    const churn = subscriptions.length > 0 ? (cancelledSubs / subscriptions.length) * 100 : 0;

    // ARPU
    const arpu = totalUsers > 0 ? gmv / totalUsers : 0;

    // Orders per user
    const ordersPerUser = activeUsers > 0 ? totalOrders / activeUsers : 0;

    return {
      totalUsers,
      activeUsers,
      mrr,
      arr,
      totalOrders,
      gmv,
      fulfillmentRevenue,
      fulfillmentCosts,
      grossProfit,
      churn,
      arpu,
      ordersPerUser,
      subscriptionsByPlan,
    };
  }

  /**
   * Revenue trend, product performance and marketplace performance, all in ONE currency (S8): the primary
   * currency of the period's orders. Orders in other currencies are reported in `otherCurrencies` (counts
   * only), never added in. Cancelled orders are excluded everywhere. Profit is null when it cannot be
   * known (marketplace-synced orders, or an item without a recorded purchase cost).
   */
  static async getOverview(workspaceId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: { workspaceId, createdAt: { gte: startDate } },
      orderBy: { createdAt: 'asc' },
    });

    const buckets = aggregateByCurrency(orders);
    const currency = choosePrimaryCurrency(buckets);
    const otherCurrencies = buckets
      .filter((b) => b.currency !== currency)
      .map((b) => ({ currency: b.currency, orders: b.orders }));

    const revenueTrend = aggregateTrend(orders, currency);

    const products = await prisma.product.findMany({
      where: { workspaceId, deletedAt: null },
      include: {
        orderItems: {
          include: { order: { select: { currency: true, externalOrderId: true, status: true } } },
        },
      },
    });
    const productsPerformance = products.map((product: any) =>
      aggregateProductPerformance(product, product.orderItems, currency)
    );

    // Marketplace performance: orders grouped by the marketplace of their listing (as before), one currency
    const listings = await prisma.listing.findMany({
      where: { workspaceId },
      include: { connection: { include: { marketplace: true } } },
    });
    const labelOfListing = new Map<string, string>();
    const marketplacePerformance: Record<string, { listings: number; orders: number; revenue: number; profit: number | null; ordersWithUnknownProfit: number }> = {};
    for (const listing of listings) {
      const label = listing.connection?.marketplace?.displayName || 'Unknown';
      labelOfListing.set(listing.id, label);
      marketplacePerformance[label] ??= { listings: 0, orders: 0, revenue: 0, profit: 0, ordersWithUnknownProfit: 0 };
      marketplacePerformance[label].listings += 1;
    }
    const perMarketplace = aggregateByCurrency(
      orders.filter((o) => o.listingId && labelOfListing.has(o.listingId)),
      [],
      (o) => labelOfListing.get(o.listingId as string) ?? null
    ).find((b) => b.currency === currency);
    for (const [label, entry] of Object.entries(marketplacePerformance)) {
      const ordersOfLabel = orders.filter(
        (o) => o.listingId && labelOfListing.get(o.listingId) === label && !isCancelledOrder(o) && orderCurrency(o) === currency
      );
      entry.orders = ordersOfLabel.length;
      entry.revenue = perMarketplace?.revenueByMarketplace[label] ?? 0;
      entry.ordersWithUnknownProfit = ordersOfLabel.filter((o) => !isProfitKnown(o)).length;
      // profit only over orders whose profit is known; null when none is
      entry.profit = ordersOfLabel.some((o) => isProfitKnown(o)) ? perMarketplace?.profitByMarketplace[label] ?? 0 : null;
    }

    return { currency, otherCurrencies, revenueTrend, productsPerformance, marketplacePerformance };
  }

  /** @deprecated use getOverview (per-currency). Kept for callers that only need the trend. */
  static async getRevenueTrend(workspaceId: string, days: number = 30) {
    return (await this.getOverview(workspaceId, days)).revenueTrend;
  }

  /** @deprecated use getOverview (per-currency). */
  static async getProductsPerformance(workspaceId: string) {
    return (await this.getOverview(workspaceId, 30)).productsPerformance;
  }

  /** @deprecated use getOverview (per-currency). */
  static async getMarketplacePerformance(workspaceId: string, days: number = 30) {
    return (await this.getOverview(workspaceId, days)).marketplacePerformance;
  }

  /**
   * Calculate plan usage for a workspace
   */
  static async getPlanUsage(workspaceId: string) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { subscription: { include: { plan: true } } },
    });

    if (!workspace?.subscription?.plan) {
      throw new Error('No subscription found');
    }

    const [
      productCount,
      listingCount,
      orderCount,
      marketplaceConnectionCount,
    ] = await Promise.all([
      prisma.product.count({ where: { workspaceId, deletedAt: null } }),
      prisma.listing.count({ where: { workspaceId, deletedAt: null } }),
      prisma.order.count({ where: { workspaceId } }),
      prisma.marketplaceConnection.count({ where: { workspaceId } }),
    ]);

    const plan = workspace.subscription.plan;

    return {
      products: {
        used: productCount,
        limit: plan.maxProducts,
        percentage: (productCount / plan.maxProducts) * 100,
      },
      listings: {
        used: listingCount,
        limit: plan.maxListings,
        percentage: (listingCount / plan.maxListings) * 100,
      },
      orders: {
        used: orderCount,
        limit: plan.maxOrders,
        percentage: (orderCount / plan.maxOrders) * 100,
      },
      marketplaces: {
        used: marketplaceConnectionCount,
        limit: plan.maxMarketplaces,
        percentage: (marketplaceConnectionCount / plan.maxMarketplaces) * 100,
      },
    };
  }
}
