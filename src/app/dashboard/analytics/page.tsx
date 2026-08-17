'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/UI/Card';
import { formatCurrency } from '@/lib/utils';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateComponents';
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
    return <LoadingState message="Loading analytics..." />;
  }

  const maxRevenue = Math.max(...revenueTrend.map((p) => p.revenue), 1);
  const topProducts = [...productsPerformance].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const marketplaceEntries = Object.entries(marketplacePerformance);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold font-display text-[#14161A]">Analytics</h1>
        <p className="text-gray-600 mt-1">Revenue trends and performance over the last 30 days</p>
      </div>

      {error && (
        <ErrorState
          message="Failed to load analytics"
          details={error || undefined}
          onRetry={() => fetchAnalytics()}
        />
      )}

      {/* Revenue Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Trend</CardTitle>
          <CardDescription>Daily revenue over the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          {revenueTrend.length === 0 ? (
            <EmptyState
              title="No revenue data yet"
              description="Revenue trends will appear here once you have orders"
              icon={<BarChart3 className="w-12 h-12 text-gray-300 mb-4" />}
            />
          ) : (
            <div className="flex items-end gap-1 h-48 overflow-x-auto">
              {revenueTrend.map((point) => (
                <div
                  key={point.date}
                  className="flex flex-col items-center justify-end flex-1 min-w-[8px] group relative"
                >
                  <div
                    className="w-full bg-[#FF5A1F] hover:bg-[#e64f18] rounded-t transition-colors"
                    style={{ height: `${Math.max((point.revenue / maxRevenue) * 100, 2)}%` }}
                  />
                  <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                    {point.date}: {formatCurrency(point.revenue)} ({point.orders} orders)
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <Card>
          <CardHeader>
            <CardTitle>Top Products</CardTitle>
            <CardDescription>Best performing products by revenue</CardDescription>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <EmptyState
                title="No product sales yet"
                description="Product performance will appear here once you have sales"
              />
            ) : (
              <div className="space-y-3">
                {topProducts.map((product) => (
                  <div key={product.id} className="flex justify-between items-center pb-3 border-b last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{product.title}</p>
                      <p className="text-xs text-gray-500">
                        {product.sales} sales · {product.margin.toFixed(1)}% margin
                      </p>
                    </div>
                    <div className="text-right ml-4">
                      <p className="font-semibold text-gray-900">{formatCurrency(product.revenue)}</p>
                      <p className="text-xs text-green-600">{formatCurrency(product.profit)} profit</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Marketplace Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Marketplace Performance</CardTitle>
            <CardDescription>Revenue and profit by marketplace (30 days)</CardDescription>
          </CardHeader>
          <CardContent>
            {marketplaceEntries.length === 0 ? (
              <EmptyState
                title="No marketplace data yet"
                description="Connect a marketplace and create listings to see performance here"
              />
            ) : (
              <div className="space-y-4">
                {marketplaceEntries.map(([marketplace, stats]) => (
                  <div key={marketplace} className="pb-4 border-b last:border-b-0">
                    <div className="flex justify-between items-center mb-1">
                      <p className="font-medium text-gray-900">{marketplace}</p>
                      <p className="text-lg font-semibold text-gray-900">{formatCurrency(stats.revenue)}</p>
                    </div>
                    <p className="text-xs text-gray-500">
                      {stats.listings} listings · {stats.orders} orders · {formatCurrency(stats.profit)} profit
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
