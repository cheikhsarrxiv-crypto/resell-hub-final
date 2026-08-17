import { DashboardMetrics, AdminMetrics } from '@/types';
import { prisma } from '@/lib/prisma';

export class AnalyticsService {
  /**
   * Get dashboard metrics for a workspace/seller
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
        fulfillmentOrder: true,
        listing: { include: { connection: { include: { marketplace: true } } } },
      },
    });

    // Calculate revenue metrics
    const revenue = orders.reduce((sum: any, o: any) => sum + o.totalPrice, 0);
    const fees = orders.reduce((sum: any, o: any) => sum + o.marketplaceFees, 0);
    const profit = orders.reduce((sum: any, o: any) => sum + o.estimatedProfit, 0);
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    // Get fulfillment metrics
    const fulfillmentOrders = await prisma.fulfillmentOrder.findMany({
      where: {
        workspaceId,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    const fulfillmentRevenue = fulfillmentOrders.reduce((sum: any, o: any) => sum + o.revenue, 0);
    const fulfillmentCost = fulfillmentOrders.reduce((sum: any, o: any) => sum + o.totalCost, 0);
    const grossProfit = profit + (fulfillmentRevenue > 0 ? fulfillmentRevenue - fulfillmentCost : 0);
    const netRevenue = revenue + fulfillmentRevenue;

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

    // Revenue by marketplace
    const revenueByMarketplace: Record<string, number> = {};
    const profitByMarketplace: Record<string, number> = {};

    for (const order of orders) {
      if (order.listing?.connection?.marketplace) {
        const marketplace = order.listing.connection.marketplace.displayName;
        revenueByMarketplace[marketplace] = (revenueByMarketplace[marketplace] || 0) + order.totalPrice;
        profitByMarketplace[marketplace] = (profitByMarketplace[marketplace] || 0) + order.estimatedProfit;
      }
    }

    return {
      revenue,
      orders: orders.length,
      profit,
      margin,
      productsCount,
      activeListings: listings.length,
      pendingOrders,
      fulfillmentOrders: fulfillmentOrdersCount,
      revenueByMarketplace,
      profitByMarketplace,
      fulfillmentRevenue,
      fulfillmentCost,
      grossProfit,
      netRevenue,
    };
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
   * Get revenue trends
   */
  static async getRevenueTrend(workspaceId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: {
        workspaceId,
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by day
    const trendMap: Record<string, { revenue: number; orders: number }> = {};

    for (const order of orders) {
      const day = order.createdAt.toISOString().split('T')[0];
      if (!trendMap[day]) {
        trendMap[day] = { revenue: 0, orders: 0 };
      }
      trendMap[day].revenue += order.totalPrice;
      trendMap[day].orders += 1;
    }

    return Object.entries(trendMap).map(([date, data]) => ({
      date,
      ...data,
    }));
  }

  /**
   * Get products performance
   */
  static async getProductsPerformance(workspaceId: string) {
    const products = await prisma.product.findMany({
      where: { workspaceId, deletedAt: null },
      include: {
        orderItems: {
          include: { order: true },
        },
      },
    });

    return products.map((product: any) => {
      const sales = product.orderItems.length;
      const revenue = product.orderItems.reduce(
        (sum: any, item: any) => sum + (item.price * item.quantity),
        0
      );
      const profit = revenue - (product.purchasePrice * sales) - (product.fulfillmentCost * sales);

      return {
        id: product.id,
        sku: product.sku,
        title: product.title,
        sales,
        revenue,
        profit,
        margin: revenue > 0 ? (profit / revenue) * 100 : 0,
      };
    });
  }

  /**
   * Get marketplace performance
   */
  static async getMarketplacePerformance(workspaceId: string, days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const listings = await prisma.listing.findMany({
      where: { workspaceId },
      include: {
        connection: { include: { marketplace: true } },
        orders: {
          where: {
            createdAt: { gte: startDate },
          },
        },
      },
    });

    const performance: Record<string, any> = {};

    for (const listing of listings) {
      const marketplace = listing.connection?.marketplace?.displayName || 'Unknown';

      if (!performance[marketplace]) {
        performance[marketplace] = {
          listings: 0,
          orders: 0,
          revenue: 0,
          profit: 0,
        };
      }

      performance[marketplace].listings += 1;
      performance[marketplace].orders += listing.orders.length;
      performance[marketplace].revenue += listing.orders.reduce(
        (sum: any, o: any) => sum + o.totalPrice,
        0
      );
      performance[marketplace].profit += listing.orders.reduce(
        (sum: any, o: any) => sum + o.estimatedProfit,
        0
      );
    }

    return performance;
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
