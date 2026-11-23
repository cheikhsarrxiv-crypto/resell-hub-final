'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { DashboardCard, DashboardCardContent, DashboardCardHeader, DashboardCardTitle, DashboardCardDescription } from '@/components/dashboard/DashboardCard';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { formatCurrency } from '@/lib/utils';
import { DashboardLoadingState, DashboardErrorState, DashboardEmptyState, DashboardLockedCard } from '@/components/dashboard/DashboardStates';
import { StatCard } from '@/components/dashboard/StatCard';
import {
  classifyOverviewResponse,
  classifyBasicResponse,
  composeAccessView,
  type BasicOutcome,
} from '@/lib/dashboardMetricsState';
import type { BasicDashboardMetrics } from '@/types';
import { formatNumber } from '@/lib/utils';
import { getWorkspaceReadiness } from '@/lib/dashboardListPageState';
import { BarChart3 } from 'lucide-react';

interface RevenueTrendPoint {
  date: string;
  revenue: number;
  orders: number;
}

interface ProductPerformance {
  id: string;
  sku: string;
  title: string;
  sales: number;
  revenue: number;
  /** null = cannot be known (an item without a recorded purchase cost): shown as "—", never as revenue minus 0 */
  profit: number | null;
  margin: number | null;
}

interface MarketplacePerformance {
  [marketplace: string]: {
    listings: number;
    orders: number;
    revenue: number;
    profit: number | null;
  };
}

export default function AnalyticsPage() {
  const { workspaceId, isReady, workspace, loading: workspaceLoading, error: workspaceError } = useWorkspace();
  const [revenueTrend, setRevenueTrend] = useState<RevenueTrendPoint[]>([]);
  const [productsPerformance, setProductsPerformance] = useState<ProductPerformance[]>([]);
  const [marketplacePerformance, setMarketplacePerformance] = useState<MarketplacePerformance>({});
  const [currency, setCurrency] = useState<string>('EUR');
  const [otherCurrencies, setOtherCurrencies] = useState<{ currency: string; orders: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set only when the plan does not include Advanced analytics (identified 403): Basic figures
  // are shown and the Advanced sections are rendered locked instead of failing the page.
  const [basicOnly, setBasicOnly] = useState<{ metrics: BasicDashboardMetrics; message: string } | null>(null);

  useEffect(() => {
    if (!isReady) return;
    fetchAnalytics();
  }, [isReady, workspaceId]);

  const fetchAnalytics = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setBasicOnly(null);

    try {
      const [response, basicResponse] = await Promise.all([
        fetch(`/api/analytics/overview?workspaceId=${workspaceId}&days=30`),
        fetch(`/api/analytics/basic?workspaceId=${workspaceId}&days=30`).catch(() => null),
      ]);
      const data = await response.json().catch(() => null);
      const advanced = classifyOverviewResponse(response.status, data, 'Failed to load analytics');
      let basic: BasicOutcome = { kind: 'error', message: 'Failed to load analytics' };
      if (basicResponse) {
        basic = classifyBasicResponse(basicResponse.status, await basicResponse.json().catch(() => null), 'Failed to load analytics');
      }
      const view = composeAccessView(basic, advanced);

      if (view.kind === 'ready' && view.access === 'advanced') {
        setRevenueTrend(view.advanced.revenueTrend);
        setProductsPerformance(view.advanced.productsPerformance);
        setMarketplacePerformance(view.advanced.marketplacePerformance);
        setCurrency(view.advanced.currency);
        setOtherCurrencies(view.advanced.otherCurrencies);
      } else if (view.kind === 'ready') {
        setBasicOnly({ metrics: view.basic, message: view.lockedMessage });
      } else {
        // 401, server error, unrelated 403, Basic failure while locked: a REAL error, never an empty page
        setError(view.message || 'Failed to load analytics');
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError('An error occurred while loading analytics');
    } finally {
      setLoading(false);
    }
  };

  const workspaceReadiness = getWorkspaceReadiness(workspace, workspaceLoading, workspaceError);

  if (workspaceReadiness.status === 'error') {
    return (
      <DashboardErrorState
        message="Unable to load your workspace"
        details={workspaceReadiness.message}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!isReady || loading) {
    return <DashboardLoadingState message="Loading analytics..." />;
  }

  const maxRevenue = Math.max(...revenueTrend.map((p) => p.revenue), 1);
  const topProducts = [...productsPerformance].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const marketplaceEntries = Object.entries(marketplacePerformance);

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Revenue trends and performance over the last 30 days" />

      {!basicOnly && otherCurrencies.length > 0 && (
        <p className="text-sm text-gray-400" data-testid="other-currencies-note">
          Amounts are in {currency}. Orders in other currencies are not added in:{' '}
          {otherCurrencies.map((c) => `${c.currency === 'UNKNOWN' ? 'unknown currency' : c.currency} (${c.orders})`).join(', ')}.
        </p>
      )}

      {error && (
        <DashboardErrorState message="Failed to load analytics" details={error || undefined} onRetry={() => fetchAnalytics()} />
      )}

      {basicOnly && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            <StatCard label="Orders (30 days)" value={formatNumber(basicOnly.metrics.orders)} accent />
            <StatCard label="Products" value={formatNumber(basicOnly.metrics.productsCount)} />
            <StatCard label="Active listings" value={formatNumber(basicOnly.metrics.activeListings)} />
            <StatCard label="Pending orders" value={formatNumber(basicOnly.metrics.pendingOrders)} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            <DashboardLockedCard title="Revenue trend" description={basicOnly.message} />
            <DashboardLockedCard title="Top products" description={basicOnly.message} />
            <DashboardLockedCard title="Marketplace performance" description={basicOnly.message} />
          </div>
        </>
      )}

      {!basicOnly && (
      <>
      {/* Revenue Trend */}
      <DashboardCard>
        <DashboardCardHeader>
          <DashboardCardTitle>Revenue Trend</DashboardCardTitle>
          <DashboardCardDescription>Daily revenue over the last 30 days</DashboardCardDescription>
        </DashboardCardHeader>
        <DashboardCardContent>
          {revenueTrend.length === 0 ? (
            <DashboardEmptyState
              title="No revenue data yet"
              description="Revenue trends will appear here once you have orders"
              icon={<BarChart3 className="w-10 h-10 text-gray-700 mb-4" />}
            />
          ) : (
            <div className="flex gap-1 h-40 sm:h-48 overflow-x-auto">
              {revenueTrend.map((point) => (
                <div
                  key={point.date}
                  className="flex flex-col justify-end items-center flex-1 min-w-[6px] group relative"
                >
                  <div
                    className="w-full bg-[#FF5A1F]/70 hover:bg-[#FF5A1F] rounded-t transition-colors"
                    style={{ height: `${Math.max((point.revenue / maxRevenue) * 100, 2)}%` }}
                  />
                  <div className="absolute bottom-full mb-2 hidden group-hover:block bg-[#151517] border border-white/10 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap z-10 shadow-lg">
                    {point.date}: {formatCurrency(point.revenue, currency)} ({point.orders} orders)
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashboardCardContent>
      </DashboardCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Top Products */}
        <DashboardCard>
          <DashboardCardHeader>
            <DashboardCardTitle>Top Products</DashboardCardTitle>
            <DashboardCardDescription>Best performing products by revenue</DashboardCardDescription>
          </DashboardCardHeader>
          <DashboardCardContent>
            {topProducts.length === 0 ? (
              <DashboardEmptyState title="No product sales yet" description="Product performance will appear here once you have sales" />
            ) : (
              <div className="space-y-3">
                {topProducts.map((product) => (
                  <div key={product.id} className="flex justify-between items-center pb-3 border-b border-white/[0.06] last:border-b-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-white truncate">{product.title}</p>
                      <p className="text-xs text-gray-500">
                        {product.sales} sales · {product.margin === null ? 'margin n/a' : `${product.margin.toFixed(1)}% margin`}
                      </p>
                    </div>
                    <div className="text-right ml-4 shrink-0">
                      <p className="font-semibold text-white">{formatCurrency(product.revenue, currency)}</p>
                      <p className="text-xs text-emerald-400">{product.profit === null ? 'profit n/a (cost missing)' : `${formatCurrency(product.profit, currency)} profit`}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DashboardCardContent>
        </DashboardCard>

        {/* Marketplace Performance */}
        <DashboardCard>
          <DashboardCardHeader>
            <DashboardCardTitle>Marketplace Performance</DashboardCardTitle>
            <DashboardCardDescription>Revenue and profit by marketplace (30 days)</DashboardCardDescription>
          </DashboardCardHeader>
          <DashboardCardContent>
            {marketplaceEntries.length === 0 ? (
              <DashboardEmptyState
                title="No marketplace data yet"
                description="Connect a marketplace and create listings to see performance here"
              />
            ) : (
              <div className="space-y-4">
                {marketplaceEntries.map(([marketplace, stats]) => (
                  <div key={marketplace} className="pb-4 border-b border-white/[0.06] last:border-b-0 last:pb-0">
                    <div className="flex justify-between items-center mb-1">
                      <p className="font-medium text-white">{marketplace}</p>
                      <p className="text-lg font-semibold text-white">{formatCurrency(stats.revenue, currency)}</p>
                    </div>
                    <p className="text-xs text-gray-500">
                      {stats.listings} listings · {stats.orders} orders · {stats.profit === null ? 'profit n/a (synced orders)' : `${formatCurrency(stats.profit, currency)} profit`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </DashboardCardContent>
        </DashboardCard>
      </div>
      </>
      )}
    </div>
  );
}
