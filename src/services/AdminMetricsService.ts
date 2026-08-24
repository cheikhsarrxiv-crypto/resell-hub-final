import prisma from '@/lib/prisma';

/**
 * Admin Metrics Service
 * All metrics are calculated from real database data
 * NO HARDCODED VALUES
 */
export class AdminMetricsService {
  /**
   * Get total users count
   */
  static async getTotalUsers(): Promise<number> {
    return prisma.user.count({
      where: { deletedAt: null },
    });
  }

  /**
   * Get total workspaces count
   */
  static async getTotalWorkspaces(): Promise<number> {
    return prisma.workspace.count();
  }

  /**
   * Get active subscriptions (not canceled, not free)
   */
  static async getActiveSubscriptions(): Promise<number> {
    return prisma.subscription.count({
      where: {
        status: { in: ['active', 'past_due'] },
        plan: {
          name: { not: 'free' },
        },
      },
    });
  }

  /**
   * Get Free plan users
   */
  static async getFreePlanUsers(): Promise<number> {
    return prisma.subscription.count({
      where: {
        plan: { name: 'free' },
      },
    });
  }

  /**
   * Get subscriptions by plan
   */
  static async getSubscriptionsByPlan(): Promise<
    Array<{ planName: string; count: number }>
  > {
    const subscriptions = await prisma.subscription.groupBy({
      by: ['planId'],
      _count: { planId: true },
      where: {
        status: { not: 'canceled' },
      },
    });

    const result = [];
    for (const sub of subscriptions) {
      const plan = await prisma.plan.findUnique({
        where: { id: sub.planId },
        select: { name: true, displayName: true },
      });
      if (plan) {
        result.push({
          planName: plan.displayName,
          count: sub._count.planId,
        });
      }
    }

    return result;
  }

  /**
   * Calculate MRR (Monthly Recurring Revenue)
   */
  static async calculateMRR(): Promise<number> {
    const subscriptions = await prisma.subscription.findMany({
      where: {
        status: 'active',
        plan: {
          name: { not: 'free' },
        },
      },
      include: { plan: true },
    });

    return subscriptions.reduce((total: any, sub: any) => {
      return total + sub.plan.price;
    }, 0);
  }

  /**
   * Calculate ARR (Annual Recurring Revenue)
   */
  static async calculateARR(): Promise<number> {
    const mrr = await this.calculateMRR();
    return mrr * 12;
  }

  /**
   * Get ARPU (Average Revenue Per User)
   */
  static async calculateARPU(): Promise<number> {
    const activeUsers = await this.getTotalUsers();
    if (activeUsers === 0) return 0;

    const mrr = await this.calculateMRR();
    return mrr / activeUsers;
  }

  /**
   * Get total GMV (Gross Merchandise Volume)
   */
  static async calculateGMV(): Promise<number> {
    const orders = await prisma.order.findMany({
      where: {
        status: { in: ['completed', 'shipped', 'accepted'] },
      },
      select: { totalPrice: true },
    });

    return orders.reduce((total: any, order: any) => total + order.totalPrice, 0);
  }

  /**
   * Get total orders
   */
  static async getTotalOrders(): Promise<number> {
    return prisma.order.count();
  }

  /**
   * Get orders by status
   */
  static async getOrdersByStatus(): Promise<
    Array<{ status: string; count: number }>
  > {
    const orders = await prisma.order.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    return orders.map((o: any) => ({
      status: o.status,
      count: o._count.status,
    }));
  }

  /**
   * Get fulfillment stats
   */
  static async getFulfillmentStats(): Promise<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
  }> {
    const [total, completed, failed, pending] = await Promise.all([
      prisma.fulfillmentOrder.count(),
      prisma.fulfillmentOrder.count({
        where: { status: 'completed' },
      }),
      prisma.fulfillmentOrder.count({
        where: { status: 'failed' },
      }),
      prisma.fulfillmentOrder.count({
        where: { status: { in: ['pending', 'processing'] } },
      }),
    ]);

    return { total, completed, failed, pending };
  }

  /**
   * Calculate subscription revenue (from subscription table)
   */
  static async calculateSubscriptionRevenue(): Promise<number> {
    const mrr = await this.calculateMRR();
    // MRR is monthly revenue, for total use all active subscriptions
    return mrr;
  }

  /**
   * Calculate fulfillment revenue (from completed fulfillment orders)
   */
  static async calculateFulfillmentRevenue(): Promise<number> {
    const orders = await prisma.order.findMany({
      where: {
        fulfillmentOrder: {
          status: 'completed',
        },
      },
      select: { totalPrice: true },
    });

    return orders.reduce((total: any, order: any) => total + order.totalPrice, 0);
  }

  /**
   * Calculate fulfillment costs
   */
  static async calculateFulfillmentCosts(): Promise<number> {
    const products = await prisma.product.findMany({
      where: { deletedAt: null },
      select: { fulfillmentCost: true, quantity: true },
    });

    return products.reduce((total: any, product: any) => {
      return total + product.fulfillmentCost * product.quantity;
    }, 0);
  }

  /**
   * Calculate gross profit
   */
  static async calculateGrossProfit(): Promise<number> {
    const orders = await prisma.order.findMany({
      where: {
        status: { in: ['completed', 'shipped', 'accepted'] },
      },
      select: {
        totalPrice: true,
        items: {
          select: {
            product: {
              select: {
                purchasePrice: true,
                fulfillmentCost: true,
              },
            },
          },
        },
      },
    });

    return orders.reduce((total: any, order: any) => {
      const product = order.items[0]?.product;
      const profit = order.totalPrice - (product?.purchasePrice || 0) - (product?.fulfillmentCost || 0);
      return total + Math.max(0, profit);
    }, 0);
  }

  /**
   * Calculate churn rate (canceled subscriptions last month)
   */
  static async calculateChurnRate(): Promise<number> {
    const now = new Date();
    const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const activeCount = await prisma.subscription.count({
      where: {
        status: 'active',
        plan: { name: { not: 'free' } },
      },
    });

    const churnedCount = await prisma.subscription.count({
      where: {
        status: 'canceled',
        plan: { name: { not: 'free' } },
        updatedAt: { gte: lastMonth },
      },
    });

    if (activeCount === 0) return 0;
    return (churnedCount / (activeCount + churnedCount)) * 100;
  }

  /**
   * Get recent orders
   */
  static async getRecentOrders(limit: number = 10): Promise<any[]> {
    return prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        items: { include: { product: { select: { title: true } } } },
        workspace: { select: { name: true } },
      },
    });
  }

  /**
   * Get top products by revenue
   */
  static async getTopProducts(limit: number = 5): Promise<any[]> {
    const orders = await prisma.order.findMany({
      select: {
        totalPrice: true,
        items: {
          select: { productId: true, product: { select: { title: true } } },
        },
      },
      where: {
        status: { in: ['completed', 'shipped'] },
      },
    });

    // Group by product (first item of each order)
    const grouped = new Map<string, { title: string; revenue: number; count: number }>();
    for (const order of orders) {
      const item = order.items[0];
      if (!item) continue;
      const key = item.productId;
      if (!grouped.has(key)) {
        grouped.set(key, {
          title: item.product?.title || 'Unknown',
          revenue: 0,
          count: 0,
        });
      }
      const entry = grouped.get(key)!;
      entry.revenue += order.totalPrice;
      entry.count += 1;
    }

    return Array.from(grouped.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  /**
   * Get workspace stats
   */
  static async getWorkspaceStats(
    workspaceId: string
  ): Promise<{
    products: number;
    orders: number;
    revenue: number;
    subscriptionStatus: string;
  }> {
    const [products, orders, subscription] = await Promise.all([
      prisma.product.count({
        where: { workspaceId, deletedAt: null },
      }),
      prisma.order.count({
        where: { workspace: { id: workspaceId } },
      }),
      prisma.subscription.findFirst({
        where: {
          workspace: { id: workspaceId },
        },
        include: { plan: true },
      }),
    ]);

    const orderRevenue = await prisma.order.aggregate({
      _sum: { totalPrice: true },
      where: { workspace: { id: workspaceId } },
    });

    return {
      products,
      orders,
      revenue: orderRevenue._sum.totalPrice || 0,
      subscriptionStatus: subscription?.status || 'none',
    };
  }

  /**
   * Get all admin stats in one call (efficient)
   */
  static async getAllAdminStats(): Promise<{
    users: number;
    workspaces: number;
    activeSubscriptions: number;
    freePlanUsers: number;
    mrr: number;
    arr: number;
    arpu: number;
    gmv: number;
    totalOrders: number;
    subscriptionRevenue: number;
    fulfillmentRevenue: number;
    fulfillmentCosts: number;
    grossProfit: number;
    churnRate: number;
    fulfillment: {
      total: number;
      completed: number;
      failed: number;
      pending: number;
    };
    subscriptionsByPlan: Array<{ planName: string; count: number }>;
    ordersByStatus: Array<{ status: string; count: number }>;
  }> {
    const [
      users,
      workspaces,
      activeSubscriptions,
      freePlanUsers,
      mrr,
      arr,
      arpu,
      gmv,
      totalOrders,
      subscriptionRevenue,
      fulfillmentRevenue,
      fulfillmentCosts,
      grossProfit,
      churnRate,
      fulfillment,
      subscriptionsByPlan,
      ordersByStatus,
    ] = await Promise.all([
      this.getTotalUsers(),
      this.getTotalWorkspaces(),
      this.getActiveSubscriptions(),
      this.getFreePlanUsers(),
      this.calculateMRR(),
      this.calculateARR(),
      this.calculateARPU(),
      this.calculateGMV(),
      this.getTotalOrders(),
      this.calculateSubscriptionRevenue(),
      this.calculateFulfillmentRevenue(),
      this.calculateFulfillmentCosts(),
      this.calculateGrossProfit(),
      this.calculateChurnRate(),
      this.getFulfillmentStats(),
      this.getSubscriptionsByPlan(),
      this.getOrdersByStatus(),
    ]);

    return {
      users,
      workspaces,
      activeSubscriptions,
      freePlanUsers,
      mrr,
      arr,
      arpu,
      gmv,
      totalOrders,
      subscriptionRevenue,
      fulfillmentRevenue,
      fulfillmentCosts,
      grossProfit,
      churnRate,
      fulfillment,
      subscriptionsByPlan,
      ordersByStatus,
    };
  }
}
