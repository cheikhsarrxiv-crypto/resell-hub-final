'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { DashboardMetrics } from '@/types';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { TrendingUp, ShoppingCart, Package, Zap, Plus } from 'lucide-react';

export default function DashboardPage() {
  const { workspaceId, isReady } = useWorkspace();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [revenueTrend, setRevenueTrend] = useState<{ date: string; revenue: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isReady) return;
    fetchMetrics();
  }, [isReady, workspaceId]);

  const fetchMetrics = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    try {
      const [metricsRes, overviewRes] = await Promise.all([
        fetch(`/api/analytics/dashboard?workspaceId=${workspaceId}&days=30`),
        fetch(`/api/analytics/overview?workspaceId=${workspaceId}&days=14`),
      ]);
      const data = await metricsRes.json();
      if (data.success) {
        setMetrics(data.metrics);
      }
      const overviewData = await overviewRes.json();
      if (overviewData.success) {
        setRevenueTrend(overviewData.revenueTrend || []);
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
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-[#14161A]">Dashboard</h1>
          <p className="text-gray-600 mt-1">Welcome back! Here's your business overview.</p>
        </div>
        <Link href="/dashboard/listings/new">
          <Button variant="primary" className="gap-2">
            <Plus className="w-4 h-4" />
            Create Listing
          </Button>
        </Link>
      </div>

      {/* Revenue trend sparkline — real data from the last 14 days, same
          source already used on the Analytics page (no new backend logic) */}
      {revenueTrend.length > 1 && (
        <div className="bg-white border border-gray-200 rounded-lg px-6 py-4 flex items-center justify-between gap-6">
          <div>
            <p className="text-sm text-gray-500">Last 14 days</p>
            <p className="text-lg font-bold text-gray-900">
              {formatCurrency(revenueTrend.reduce((sum, p) => sum + p.revenue, 0))}
            </p>
          </div>
          <div className="flex items-end gap-[3px] h-10 flex-1 max-w-xs">
            {(() => {
              const max = Math.max(...revenueTrend.map((p) => p.revenue), 1);
              return revenueTrend.map((p) => (
                <div
                  key={p.date}
                  className="flex-1 bg-[#FF5A1F]/70 rounded-sm min-w-[2px]"
                  style={{ height: `${Math.max((p.revenue / max) * 100, 4)}%` }}
                  title={`${p.date}: ${formatCurrency(p.revenue)}`}
                />
              ));
            })()}
          </div>
        </div>
      )}

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
                <span className="text-2xl font-bold text-[#FF5A1F]">
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
