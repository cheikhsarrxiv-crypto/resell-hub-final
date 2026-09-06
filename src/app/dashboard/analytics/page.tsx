'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { DashboardCard, DashboardCardContent, DashboardCardHeader, DashboardCardTitle, DashboardCardDescription } from '@/components/dashboard/DashboardCard';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { formatCurrency } from '@/lib/utils';
import { DashboardLoadingState, DashboardErrorState, DashboardEmptyState } from '@/components/dashboard/DashboardStates';
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
  profit: number;
  margin: number;
}

interface MarketplacePerformance {
  [marketplace: string]: {
    listings: number;
    orders: number;
    revenue: number;
    profit: number;
  };
}

export default function AnalyticsPage() {
  const { workspaceId, isReady } = useWorkspace();
  const [revenueTrend, setRevenueTrend] = useState<RevenueTrendPoint[]>([]);
  const [productsPerformance, setProductsPerformance] = useState<ProductPerformance[]>([]);
  const [marketplacePerformance, setMarketplacePerformance] = useState<MarketplacePerformance>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    try {
      const response = await fetch(`/api/analytics/overview?workspaceId=${workspaceId}&days=30`);
      const data = await response.json();

      if (data.success) {
        setRevenueTrend(data.revenueTrend);
        setProductsPerformance(data.productsPerformance);
        setMarketplacePerformance(data.marketplacePerformance);
      } else {
        setError(data.error || 'Failed to load analytics');
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError('An error occurred while loading analytics');
    } finally {
      setLoading(false);
    }
  };

  if (!isReady || loading) {
    return <DashboardLoadingState message="Loading analytics..." />;
  }

  const maxRevenue = Math.max(...revenueTrend.map((p) => p.revenue), 1);
  const topProducts = [...productsPerformance].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const marketplaceEntries = Object.entries(marketplacePerformance);

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Revenue trends and performance over the last 30 days" />

      {error && (
        <DashboardErrorState message="Failed to load analytics" details={error || undefined} onRetry={() => fetchAnalytics()} />
      )}

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
                    {point.date}: {formatCurrency(point.revenue)} ({point.orders} orders)
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
                        {product.sales} sales · {product.margin.toFixed(1)}% margin
                      </p>
                    </div>
                    <div className="text-right ml-4 shrink-0">
                      <p className="font-semibold text-white">{formatCurrency(product.revenue)}</p>
                      <p className="text-xs text-emerald-400">{formatCurrency(product.profit)} profit</p>
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
                      <p className="text-lg font-semibold text-white">{formatCurrency(stats.revenue)}</p>
                    </div>
                    <p className="text-xs text-gray-500">
                      {stats.listings} listings · {stats.orders} orders · {formatCurrency(stats.profit)} profit
                    </p>
                  </div>
                ))}
              </div>
            )}
          </DashboardCardContent>
        </DashboardCard>
      </div>
    </div>
  );
}
