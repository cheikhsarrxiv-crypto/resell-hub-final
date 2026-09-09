'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { DashboardCard, DashboardCardContent, DashboardCardHeader, DashboardCardTitle } from '@/components/dashboard/DashboardCard';
import { DashboardButton } from '@/components/dashboard/DashboardButton';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { DashboardLoadingState } from '@/components/dashboard/DashboardStates';
import { formatCurrency } from '@/lib/utils';
import { Check } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  price: number;
  description?: string;
  maxProducts?: number;
  maxListings?: number;
  maxMarketplaces?: number;
  fulfillmentEnabled?: boolean;
  advancedAnalytics?: boolean;
  apiAccess?: boolean;
}

export default function SubscriptionPage() {
  const { workspaceId, isReady } = useWorkspace();
  const [subscription, setSubscription] = useState<any>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isReady) return;
    fetchData();
  }, [isReady, workspaceId]);

  const fetchData = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/subscriptions?workspaceId=${workspaceId}`);
      const data = await response.json();
      if (data.success) {
        setSubscription(data.subscription);
        setPlans(data.plans);
      }
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const startCheckout = async (planId: string) => {
    if (!workspaceId) return;

    setCheckoutLoading(planId);
    try {
      const response = await fetch(`/api/stripe/checkout?workspaceId=${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });

      const data = await response.json();
      if (data.success && data.url) {
        // Redirect to Stripe checkout
        window.location.href = data.url;
      } else if (data.alreadySubscribed) {
        // Already have an active subscription — changing plans happens in
        // the billing portal, not through a second Checkout Session.
        alert('You already have an active subscription. Opening the billing portal to change your plan.');
        await openPortal();
      } else {
        alert('Failed to start checkout. Make sure Stripe is configured.');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('An error occurred during checkout');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const openPortal = async () => {
    if (!workspaceId) return;

    try {
      const response = await fetch(`/api/stripe/portal?workspaceId=${workspaceId}`, {
        method: 'POST',
      });

      const data = await response.json();
      if (data.success && data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Portal error:', error);
      alert('Failed to open billing portal');
    }
  };

  if (loading) {
    return <DashboardLoadingState message="Loading subscription..." />;
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Subscription" description="Manage your plan and billing" />

      {/* Current Plan */}
      {subscription && (
        <DashboardCard className="bg-[#FF5A1F]/[0.06] border-[#FF5A1F]/20">
          <DashboardCardHeader>
            <DashboardCardTitle>Current Plan</DashboardCardTitle>
          </DashboardCardHeader>
          <DashboardCardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
              <div>
                <p className="text-gray-500 text-sm mb-1">Plan Name</p>
                <p className="text-xl font-bold text-white capitalize">{subscription.plan?.name || 'Free'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-sm mb-1">Price</p>
                <p className="text-xl font-bold text-white">{formatCurrency(subscription.plan?.price || 0)}/month</p>
              </div>
              <div>
                <p className="text-gray-500 text-sm mb-1">Status</p>
                <p className="text-lg font-semibold text-emerald-400 capitalize">{subscription.status}</p>
              </div>
            </div>

            {subscription.plan?.price > 0 && (
              <DashboardButton variant="outline" onClick={openPortal}>
                Manage Billing →
              </DashboardButton>
            )}
          </DashboardCardContent>
        </DashboardCard>
      )}

      {/* Available Plans */}
      <div>
        <h2 className="text-lg font-bold text-white mb-6" style={{ fontFamily: 'var(--font-display)' }}>
          Available Plans
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {plans.map((plan) => {
            const isCurrent = subscription?.plan?.id === plan.id;
            return (
              <DashboardCard key={plan.id} className={`relative p-6 ${isCurrent ? 'ring-1 ring-[#FF5A1F]/50' : ''}`}>
                {isCurrent && (
                  <div className="absolute top-4 right-4 bg-[#FF5A1F] text-white px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide">
                    Current
                  </div>
                )}

                <p className="text-sm font-medium text-gray-400 capitalize">{plan.name}</p>
                <p className="text-2xl font-bold text-white mt-2">{formatCurrency(plan.price)}</p>
                <p className="text-gray-500 text-sm mb-5">/month</p>

                <div className="space-y-2.5 mb-6">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-sm text-gray-300">Up to {plan.maxProducts} products</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-sm text-gray-300">Up to {plan.maxListings} listings</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-sm text-gray-300">{plan.maxMarketplaces} marketplaces</span>
                  </div>
                  {plan.fulfillmentEnabled && (
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-sm text-gray-300">Fulfillment enabled</span>
                    </div>
                  )}
                  {plan.advancedAnalytics && (
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-sm text-gray-300">Advanced analytics</span>
                    </div>
                  )}
                  {plan.apiAccess && (
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-sm text-gray-300">API access</span>
                    </div>
                  )}
                </div>

                {!isCurrent && (
                  <DashboardButton
                    variant="primary"
                    className="w-full"
                    onClick={() => startCheckout(plan.id)}
                    disabled={checkoutLoading === plan.id}
                  >
                    {checkoutLoading === plan.id ? 'Processing...' : 'Upgrade to ' + plan.name}
                  </DashboardButton>
                )}
              </DashboardCard>
            );
          })}
        </div>
      </div>

      {/* Note */}
      <DashboardCard className="bg-amber-500/[0.04] border-amber-500/20">
        <DashboardCardHeader>
          <DashboardCardTitle className="text-amber-300">Stripe Integration</DashboardCardTitle>
        </DashboardCardHeader>
        <DashboardCardContent className="space-y-3">
          <p className="text-amber-200/80 text-sm">✅ Stripe integration is now available in Phase 2.5!</p>
          <p className="text-amber-200/80 text-sm">To enable real payments, configure your Stripe keys in .env:</p>
          <ul className="text-amber-200/80 text-xs space-y-1 ml-4 list-disc">
            <li>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</li>
            <li>STRIPE_SECRET_KEY</li>
            <li>STRIPE_WEBHOOK_SECRET</li>
          </ul>
          <p className="text-amber-200/80 text-sm">Without these, checkout will show an error message.</p>
        </DashboardCardContent>
      </DashboardCard>
    </div>
  );
}
