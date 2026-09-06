'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/hooks';
import {
  DashboardCard,
  DashboardCardContent,
  DashboardCardDescription,
  DashboardCardHeader,
  DashboardCardTitle,
} from '@/components/dashboard/DashboardCard';
import { StatCard } from '@/components/dashboard/StatCard';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { DashboardButton } from '@/components/dashboard/DashboardButton';
import { DashboardLoadingState } from '@/components/dashboard/DashboardStates';
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
    return <DashboardLoadingState message="Loading dashboard..." />;
  }

  if (!metrics) {
    return <DashboardLoadingState message="Failed to load metrics" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Welcome back! Here's your business overview."
        action={
          <Link href="/dashboard/listings/new">
            <DashboardButton variant="primary">
              <Plus className="w-4 h-4" />
              Create Listing
            </DashboardButton>
          </Link>
        }
      />

      {/* Revenue trend sparkline — real data from the last 14 days, same
          source already used on the Analytics page (no new backend logic) */}
      {revenueTrend.length > 1 && (
        <DashboardCard className="px-5 sm:px-6 py-4 flex items-center justify-between gap-6 dash-reveal">
          <div className="shrink-0">
            <p className="text-sm text-gray-500">Last 14 days</p>
            <p className="text-lg font-bold text-white">
              {formatCurrency(revenueTrend.reduce((sum, p) => sum + p.revenue, 0))}
            </p>
          </div>
          <div className="flex items-end gap-[3px] h-10 flex-1 max-w-xs">
            {(() => {
              const max = Math.max(...revenueTrend.map((p) => p.revenue), 1);
              return revenueTrend.map((p) => (
                <div
                  key={p.date}
                  className="flex-1 bg-[#FF5A1F]/60 rounded-sm min-w-[2px]"
                  style={{ height: `${Math.max((p.revenue / max) * 100, 4)}%` }}
                  title={`${p.date}: ${formatCurrency(p.revenue)}`}
                />
              ));
            })()}
          </div>
        </DashboardCard>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <StatCard label="Revenue" value={formatCurrency(metrics.revenue)} icon={<TrendingUp className="w-5 h-5" />} accent />
        <StatCard label="Orders" value={formatNumber(metrics.orders)} icon={<ShoppingCart className="w-5 h-5" />} />
        <StatCard label="Profit" value={formatCurrency(metrics.profit)} icon={<TrendingUp className="w-5 h-5" />} accent />
        <StatCard label="Margin" value={`${metrics.margin.toFixed(1)}%`} icon={<Package className="w-5 h-5" />} />
      </div>

      {/* Revenue Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <DashboardCard>
          <DashboardCardHeader>
            <DashboardCardTitle>Inventory Overview</DashboardCardTitle>
            <DashboardCardDescription>Your current product status</DashboardCardDescription>
          </DashboardCardHeader>
          <DashboardCardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
                <span className="text-gray-400 text-sm">Total Products</span>
                <span className="text-xl font-bold text-white">{metrics.productsCount}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
                <span className="text-gray-400 text-sm">Active Listings</span>
                <span className="text-xl font-bold text-white">{metrics.activeListings}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Pending Orders</span>
                <span className="text-xl font-bold text-white">{metrics.pendingOrders}</span>
              </div>
            </div>
          </DashboardCardContent>
        </DashboardCard>

        <DashboardCard>
          <DashboardCardHeader>
            <DashboardCardTitle>Fulfillment Status</DashboardCardTitle>
            <DashboardCardDescription>Automatic fulfillment orders</DashboardCardDescription>
          </DashboardCardHeader>
          <DashboardCardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
                <span className="text-gray-400 text-sm">Active Fulfillments</span>
                <span className="text-xl font-bold text-[#FF5A1F]">{metrics.fulfillmentOrders}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
                <span className="text-gray-400 text-sm">Fulfillment Revenue</span>
                <span className="text-xl font-bold text-white">{formatCurrency(metrics.fulfillmentRevenue)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Fulfillment Costs</span>
                <span className="text-lg font-semibold text-white">{formatCurrency(metrics.fulfillmentCost)}</span>
              </div>
            </div>
          </DashboardCardContent>
        </DashboardCard>
      </div>

      {/* Marketplace Performance */}
      {Object.keys(metrics.revenueByMarketplace).length > 0 && (
        <DashboardCard>
          <DashboardCardHeader>
            <DashboardCardTitle>Marketplace Performance</DashboardCardTitle>
            <DashboardCardDescription>Revenue and profit by marketplace</DashboardCardDescription>
          </DashboardCardHeader>
          <DashboardCardContent>
            <div className="space-y-4">
              {Object.entries(metrics.revenueByMarketplace).map(([marketplace, revenue]) => (
                <div key={marketplace} className="flex justify-between items-center pb-4 border-b border-white/[0.06] last:border-b-0 last:pb-0">
                  <div>
                    <p className="font-medium text-white">{marketplace}</p>
                    <p className="text-sm text-gray-500">
                      Profit: {formatCurrency(metrics.profitByMarketplace[marketplace] || 0)}
                    </p>
                  </div>
                  <p className="text-lg font-semibold text-white">{formatCurrency(revenue)}</p>
                </div>
              ))}
            </div>
          </DashboardCardContent>
        </DashboardCard>
      )}

      {/* Summary */}
      <DashboardCard>
        <DashboardCardHeader>
          <DashboardCardTitle>Financial Summary</DashboardCardTitle>
        </DashboardCardHeader>
        <DashboardCardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500">Subscription Revenue</p>
              <p className="text-lg font-bold text-white mt-1">{formatCurrency(metrics.revenue)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Fulfillment Revenue</p>
              <p className="text-lg font-bold text-white mt-1">{formatCurrency(metrics.fulfillmentRevenue)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Gross Profit</p>
              <p className="text-lg font-bold text-emerald-400 mt-1">{formatCurrency(metrics.grossProfit)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Net Revenue</p>
              <p className="text-lg font-bold text-white mt-1">{formatCurrency(metrics.netRevenue)}</p>
            </div>
          </div>
        </DashboardCardContent>
      </DashboardCard>
    </div>
  );
}
