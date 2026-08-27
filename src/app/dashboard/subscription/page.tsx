'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
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
  const [changing, setChanging] = useState(false);

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
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Subscription</h1>
        <p className="text-gray-600 mt-1">Manage your plan and billing</p>
      </div>

      {/* Current Plan */}
      {subscription && (
        <Card className="bg-[#FF5A1F]/10 border-[#FF5A1F]/30">
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
              <div>
                <p className="text-gray-600 text-sm mb-1">Plan Name</p>
                <p className="text-2xl font-bold text-gray-900 capitalize">
                  {subscription.plan?.name || 'Free'}
                </p>
              </div>
              <div>
                <p className="text-gray-600 text-sm mb-1">Price</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(subscription.plan?.price || 0)}/month
                </p>
              </div>
              <div>
                <p className="text-gray-600 text-sm mb-1">Status</p>
                <p className="text-lg font-semibold text-green-600 capitalize">
                  {subscription.status}
                </p>
              </div>
            </div>
            
            {subscription.plan?.price > 0 && (
              <Button
                variant="outline"
                onClick={openPortal}
              >
                Manage Billing →
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Available Plans */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-6">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => (
            <Card
              key={plan.id}
              className={`relative ${
                subscription?.plan?.id === plan.id
                  ? 'ring-2 ring-[#FF5A1F] shadow-lg'
                  : ''
              }`}
            >
              {subscription?.plan?.id === plan.id && (
                <div className="absolute top-4 right-4 bg-[#FF5A1F] text-white px-3 py-1 rounded-full text-xs font-semibold">
                  Current
                </div>
              )}

              <CardHeader>
                <CardTitle className="capitalize">{plan.name}</CardTitle>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {formatCurrency(plan.price)}
                </p>
                <p className="text-gray-600 text-sm">/month</p>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-gray-700">
                      Up to {plan.maxProducts} products
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-gray-700">
                      Up to {plan.maxListings} listings
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-gray-700">
                      {plan.maxMarketplaces} marketplaces
                    </span>
                  </div>
                  {plan.fulfillmentEnabled && (
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-gray-700">Fulfillment enabled</span>
                    </div>
                  )}
                  {plan.advancedAnalytics && (
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-gray-700">Advanced analytics</span>
                    </div>
                  )}
                  {plan.apiAccess && (
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-gray-700">API access</span>
                    </div>
                  )}
                </div>

                {subscription?.plan?.id !== plan.id && (
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => startCheckout(plan.id)}
                    disabled={checkoutLoading === plan.id}
                  >
                    {checkoutLoading === plan.id ? 'Processing...' : 'Upgrade to ' + plan.name}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Note */}
      <Card className="bg-yellow-50 border-yellow-200">
        <CardHeader>
          <CardTitle className="text-yellow-900">Stripe Integration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-yellow-800 text-sm">
            ✅ Stripe integration is now available in Phase 2.5!
          </p>
          <p className="text-yellow-800 text-sm">
            To enable real payments, configure your Stripe keys in .env:
          </p>
          <ul className="text-yellow-800 text-xs space-y-1 ml-4 list-disc">
            <li>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</li>
            <li>STRIPE_SECRET_KEY</li>
            <li>STRIPE_WEBHOOK_SECRET</li>
          </ul>
          <p className="text-yellow-800 text-sm">
            Without these, checkout will show an error message.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
