import prisma from '@/lib/prisma';

export class SubscriptionService {
  /**
   * Get all available plans
   */
  static async getPlans() {
    try {
      return await prisma.plan.findMany({
        orderBy: { price: 'asc' },
      });
    } catch (error) {
      console.error('[SubscriptionService] Error fetching plans:', error);
      throw error;
    }
  }

  /**
   * Get current subscription for workspace
   */
  static async getSubscription(workspaceId: string) {
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        include: {
          subscription: {
            include: { plan: true },
          },
        },
      });

      if (!workspace?.subscription) {
        // Return default free plan
        const freePlan = await prisma.plan.findUnique({
          where: { name: 'free' },
        });

        return {
          planId: freePlan?.id,
          plan: freePlan,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: null,
        };
      }

      return workspace.subscription;
    } catch (error) {
      console.error('[SubscriptionService] Error fetching subscription:', error);
      throw error;
    }
  }

  /**
   * Check if workspace has feature enabled
   */
  static async hasFeature(
    workspaceId: string,
    feature: 'fulfillmentEnabled' | 'advancedAnalytics' | 'apiAccess' | 'autoDelistEnabled' | 'aiAssistant'
  ): Promise<boolean> {
    try {
      const subscription = await this.getSubscription(workspaceId);

      if (!subscription?.plan) {
        return false;
      }

      return (subscription.plan as any)[feature] || false;
    } catch (error) {
      console.error('[SubscriptionService] Error checking feature:', error);
      return false;
    }
  }

  /**
   * Get plan limits for workspace
   */
  static async getPlanLimits(workspaceId: string) {
    try {
      const subscription = await this.getSubscription(workspaceId);

      if (!subscription?.plan) {
        return {
          maxProducts: 0,
          maxListings: 0,
          maxOrders: 0,
          maxMarketplaces: 0,
          maxUsers: 0,
        };
      }

      return {
        maxProducts: subscription.plan.maxProducts || 0,
        maxListings: subscription.plan.maxListings || 0,
        maxOrders: subscription.plan.maxOrders || 0,
        maxMarketplaces: subscription.plan.maxMarketplaces || 0,
        maxUsers: subscription.plan.maxUsers || 0,
      };
    } catch (error) {
      console.error('[SubscriptionService] Error getting limits:', error);
      throw error;
    }
  }

  /**
   * Check if limit is reached
   */
  static async isLimitReached(
    workspaceId: string,
    resource: 'products' | 'listings' | 'orders' | 'marketplaces' | 'users'
  ): Promise<boolean> {
    try {
      const limits = await this.getPlanLimits(workspaceId);
      const limitKey = `max${resource.charAt(0).toUpperCase() + resource.slice(1)}` as keyof typeof limits;
      const limit = limits[limitKey] as number;

      if (limit === 0) {
        return false; // No limit
      }

      let count = 0;

      switch (resource) {
        case 'products':
          count = await prisma.product.count({
            where: { workspaceId, deletedAt: null },
          });
          break;
        case 'listings':
          count = await prisma.listing.count({
            where: { workspaceId, deletedAt: null },
          });
          break;
        case 'orders':
          count = await prisma.order.count({
            where: { workspaceId },
          });
          break;
        case 'marketplaces':
          count = await prisma.marketplaceConnection.count({
            where: { workspaceId },
          });
          break;
        case 'users':
          // Count workspace users
          count = 1; // For now, only workspace owner
          break;
      }

      return count >= limit;
    } catch (error) {
      console.error('[SubscriptionService] Error checking limit:', error);
      return false;
    }
  }

  /**
   * Change plan (mock for now - Stripe integration in Phase 2.5)
   */
  static async changePlan(workspaceId: string, planId: string) {
    try {
      // Verify plan exists
      const plan = await prisma.plan.findUnique({
        where: { id: planId },
      });

      if (!plan) {
        throw new Error('Plan not found');
      }

      // Get or create subscription
      let workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });

      if (!workspace?.subscriptionId) {
        // Create new subscription
        const subscription = await prisma.subscription.create({
          data: {
            planId,
            status: 'active',
          },
        });

        await prisma.workspace.update({
          where: { id: workspaceId },
          data: { subscriptionId: subscription.id },
        });

        return subscription;
      } else {
        // Update existing subscription
        return await prisma.subscription.update({
          where: { id: workspace.subscriptionId },
          data: { planId },
        });
      }
    } catch (error) {
      console.error('[SubscriptionService] Error changing plan:', error);
      throw error;
    }
  }
}
