'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/UI/Card';
import { LoadingState, ErrorState, UpgradeState } from '@/components/StateComponents';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { TrendingUp, ShoppingCart, Package, Zap } from 'lucide-react';
import { getWorkspaceId } from '@/lib/workspace-client';
import {
  classifyMetricsResponse,
  classifyBasicResponse,
  composeAccessView,
  metricsOutcomeToAdvanced,
  type AccessView,
  type BasicOutcome,
} from '@/lib/dashboardMetricsState';
import type { DashboardMetrics } from '@/types';

export default function DashboardPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [state, setState] = useState<AccessView<DashboardMetrics> | { kind: 'loading' }>({ kind: 'loading' });
  const [workspaceId, setWorkspaceId] = useState<string>('');

  useEffect(() => {
    fetchWorkspaceId();
  }, [slug]);

  useEffect(() => {
    if (workspaceId) {
      fetchMetrics();
    }
  }, [workspaceId]);

  const fetchWorkspaceId = async () => {
    try {
      const id = await getWorkspaceId(slug);
      setWorkspaceId(id);
    } catch (error) {
      console.error('Failed to get workspace ID:', error);
      setState({ kind: 'error', message: 'Unable to load your workspace. Please try again.' });
    }
  };

  const fetchMetrics = async () => {
    setState({ kind: 'loading' });
    try {
      // Basic (every plan) and Advanced (plan feature) are separate requests: an Advanced refusal
      // never takes the Basic figures down with it.
      const [response, basicResponse] = await Promise.all([
        fetch(`/api/analytics/dashboard?workspaceId=${workspaceId}&days=30`),
        fetch(`/api/analytics/basic?workspaceId=${workspaceId}&days=30`).catch(() => null),
      ]);
      const data = await response.json().catch(() => null);
      const advanced = metricsOutcomeToAdvanced(classifyMetricsResponse(response.status, data, 'Failed to load metrics.'));
      let basic: BasicOutcome = { kind: 'error', message: 'Failed to load metrics.' };
      if (basicResponse) {
        basic = classifyBasicResponse(basicResponse.status, await basicResponse.json().catch(() => null), 'Failed to load metrics.');
      }
      setState(composeAccessView(basic, advanced));
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
      setState({ kind: 'error', message: 'A network error occurred while loading your dashboard.' });
    }
  };

  if (state.kind === 'loading') {
    return <LoadingState message="Loading dashboard..." />;
  }

  if (state.kind === 'unauthorized') {
    return (
      <ErrorState
        message="Session expired"
        details={state.message}
        action={
          <Link href="/login" className="px-4 py-2 bg-[#FF5A1F] text-white rounded hover:bg-[#e64f18] text-sm font-medium">
            Sign in again
          </Link>
        }
      />
    );
  }

  if (state.kind === 'error') {
    return <ErrorState message="Failed to load metrics" details={state.message} onRetry={fetchMetrics} />;
  }

  if (state.access === 'basic') {
    const basic = state.basic;
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">Welcome back! Here's your business overview.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard label="Orders (30 days)" value={formatNumber(basic.orders)} icon={<ShoppingCart className="w-8 h-8" />} />
          <StatCard label="Products" value={formatNumber(basic.productsCount)} icon={<Package className="w-8 h-8" />} />
          <StatCard label="Active listings" value={formatNumber(basic.activeListings)} icon={<Zap className="w-8 h-8" />} />
          <StatCard label="Pending orders" value={formatNumber(basic.pendingOrders)} icon={<ShoppingCart className="w-8 h-8" />} />
        </div>
        <UpgradeState message={state.lockedMessage} />
      </div>
    );
  }

  const metrics = state.advanced;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Welcome back! Here's your business overview.</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          label="Revenue"
          value={formatCurrency(metrics.revenue, metrics.currency)}
          icon={<TrendingUp className="w-8 h-8" />}
        />
        <StatCard
          label="Orders"
          value={formatNumber(metrics.orders)}
          icon={<ShoppingCart className="w-8 h-8" />}
        />
        <StatCard
          label="Profit"
          value={metrics.marginAvailable ? formatCurrency(metrics.profit, metrics.currency) : '—'}
          icon={<TrendingUp className="w-8 h-8" />}
        />
        <StatCard
          label="Margin"
          value={metrics.marginAvailable ? `${metrics.margin.toFixed(1)}%` : '—'}
          icon={<Package className="w-8 h-8" />}
        />
      </div>

      {/* Revenue Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Inventory Overview</CardTitle>
            <CardDescription>Your current product status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-gray-600">Total Products</span>
                <span className="text-2xl font-bold text-gray-900">
                  {metrics.productsCount}
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-gray-600">Active Listings</span>
                <span className="text-2xl font-bold text-gray-900">
                  {metrics.activeListings}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Pending Orders</span>
                <span className="text-2xl font-bold text-gray-900">
                  {metrics.pendingOrders}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fulfillment Status</CardTitle>
            <CardDescription>Automatic fulfillment orders</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-gray-600">Active Fulfillments</span>
                <span className="text-2xl font-bold text-blue-600">
                  {metrics.fulfillmentOrders}
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-gray-600">Fulfillment Revenue</span>
                <span className="text-2xl font-bold text-gray-900">
                  {formatCurrency(metrics.fulfillmentRevenue, metrics.currency)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Fulfillment Costs</span>
                <span className="text-lg font-semibold text-gray-900">
                  {formatCurrency(metrics.fulfillmentCost, metrics.currency)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Marketplace Performance */}
      {Object.keys(metrics.revenueByMarketplace).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Marketplace Performance</CardTitle>
            <CardDescription>Revenue and profit by marketplace</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(metrics.revenueByMarketplace).map(([marketplace, revenue]) => (
                <div key={marketplace} className="flex justify-between items-center pb-4 border-b last:border-b-0">
                  <div>
                    <p className="font-medium text-gray-900">{marketplace}</p>
                    <p className="text-sm text-gray-500">
                      Profit: {formatCurrency(metrics.profitByMarketplace[marketplace] || 0)}
                    </p>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatCurrency(revenue)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Financial Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-600">Subscription Revenue</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {formatCurrency(metrics.revenue, metrics.currency)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Fulfillment Revenue</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {formatCurrency(metrics.fulfillmentRevenue, metrics.currency)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Gross Profit</p>
              <p className="text-xl font-bold text-green-600 mt-1">
                {formatCurrency(metrics.grossProfit, metrics.currency)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Net Revenue</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {formatCurrency(metrics.netRevenue, metrics.currency)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
