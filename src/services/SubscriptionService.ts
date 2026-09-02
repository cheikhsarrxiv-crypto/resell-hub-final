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

      // A limit of 0 means the plan allows none of this resource at all
      // (e.g. no subscription -> the free-tier fallback in getPlanLimits())
      // — it must block, not be read as "no limit". No real plan in this
      // app currently uses 0 to mean "unlimited" (Enterprise uses a large
      // finite number instead), so there is no unlimited case to special-case
      // here; count >= limit below handles every real value correctly,
      // including 0 (count >= 0 is always true, so it blocks immediately).
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

  // NOTE: There is intentionally no changePlan()/direct plan-write method
  // here. Upgrading to a paid plan must go through Stripe Checkout
  // (StripeService.createCheckoutSession + the customer.subscription.*
  // webhooks); downgrading/cancelling goes through the Stripe customer
  // portal (StripeService.createPortalSession), which triggers
  // handleSubscriptionDeleted on cancellation. A prior version of this
  // method let a client set subscription.planId directly with no payment
  // — removed as a real payment-bypass vulnerability.
}
