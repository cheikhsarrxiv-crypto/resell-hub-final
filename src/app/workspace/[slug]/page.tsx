'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/UI/Card';
import { DashboardMetrics } from '@/types';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { TrendingUp, ShoppingCart, Package, Zap } from 'lucide-react';
import { getWorkspaceId } from '@/lib/workspace-client';

export default function DashboardPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
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
      setLoading(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      const response = await fetch(
        `/api/analytics/dashboard?workspaceId=${workspaceId}&days=30`
      );
      const data = await response.json();
      if (data.success) {
        setMetrics(data.metrics);
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading dashboard...</div>;
  }

  if (!metrics) {
    return <div className="text-center py-12">Failed to load metrics</div>;
  }

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
          value={formatCurrency(metrics.revenue)}
          icon={<TrendingUp className="w-8 h-8" />}
        />
        <StatCard
          label="Orders"
          value={formatNumber(metrics.orders)}
          icon={<ShoppingCart className="w-8 h-8" />}
        />
        <StatCard
          label="Profit"
          value={formatCurrency(metrics.profit)}
          icon={<TrendingUp className="w-8 h-8" />}
        />
        <StatCard
          label="Margin"
          value={`${metrics.margin.toFixed(1)}%`}
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
                  {formatCurrency(metrics.fulfillmentRevenue)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Fulfillment Costs</span>
                <span className="text-lg font-semibold text-gray-900">
                  {formatCurrency(metrics.fulfillmentCost)}
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
                {formatCurrency(metrics.revenue)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Fulfillment Revenue</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {formatCurrency(metrics.fulfillmentRevenue)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Gross Profit</p>
              <p className="text-xl font-bold text-green-600 mt-1">
                {formatCurrency(metrics.grossProfit)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Net Revenue</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {formatCurrency(metrics.netRevenue)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
