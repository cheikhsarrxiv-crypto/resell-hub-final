'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { DashboardCard, DashboardCardContent, DashboardCardHeader, DashboardCardTitle } from '@/components/dashboard/DashboardCard';
import { StatCard } from '@/components/dashboard/StatCard';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { DashboardButton } from '@/components/dashboard/DashboardButton';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { DashboardLoadingState, DashboardErrorState, DashboardEmptyState } from '@/components/dashboard/DashboardStates';
import { Zap, TrendingUp, Package, Truck } from 'lucide-react';
import { formatCurrency, getStatusLabel, formatDateTime } from '@/lib/utils';

interface FulfillmentOrder {
  id: string;
  status: string;
  quantity: number;
  totalCost: number;
  revenue: number;
  profit: number;
  createdAt: string;
  partner: { name: string; country: string };
  order: {
    id: string;
    customerName: string;
  };
  shipment?: {
    trackingNumber?: string;
    trackingEvents?: { status: string; timestamp: string }[];
  } | null;
}

interface FulfillmentMetrics {
  totalOrders: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  averageCostPerOrder: number;
  averageProfitPerOrder: number;
  margin: number;
}

export default function FulfillmentPage() {
  const { workspaceId, isReady } = useWorkspace();
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [metrics, setMetrics] = useState<FulfillmentMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    if (!isReady) return;
    fetchFulfillmentData();
  }, [isReady, workspaceId, statusFilter]);

  const fetchFulfillmentData = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let url = `/api/fulfillment?workspaceId=${workspaceId}&days=30`;
      if (statusFilter) url += `&status=${statusFilter}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.success) {
        setOrders(data.orders);
        setMetrics(data.metrics);
      } else {
        setError(data.error || 'Failed to load fulfillment data');
      }
    } catch (err) {
      console.error('Failed to fetch fulfillment data:', err);
      setError('An error occurred while loading fulfillment data');
    } finally {
      setLoading(false);
    }
  };

  const statuses = ['pending', 'accepted', 'processing', 'shipped', 'delivered', 'failed', 'cancelled'];

  if (!isReady || loading) {
    return <DashboardLoadingState message="Loading fulfillment data..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Fulfillment" description="Track orders sent to fulfillment partners" />

      {error && (
        <DashboardErrorState
          message="Failed to load fulfillment data"
          details={error || undefined}
          onRetry={() => fetchFulfillmentData()}
        />
      )}

      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <StatCard label="Fulfillment Orders" value={metrics.totalOrders} icon={<Zap className="w-5 h-5" />} />
          <StatCard label="Revenue" value={formatCurrency(metrics.totalRevenue)} icon={<TrendingUp className="w-5 h-5" />} accent />
          <StatCard label="Profit" value={formatCurrency(metrics.totalProfit)} icon={<Package className="w-5 h-5" />} accent />
          <StatCard label="Margin" value={`${metrics.margin.toFixed(1)}%`} icon={<Truck className="w-5 h-5" />} />
        </div>
      )}

      {/* Filters */}
      <DashboardCard className="p-4 sm:p-5">
        <div className="flex gap-2 flex-wrap">
          <DashboardButton
            variant={statusFilter === '' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('')}
          >
            All
          </DashboardButton>
          {statuses.map((status) => (
            <DashboardButton
              key={status}
              variant={statusFilter === status ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(status)}
              className="capitalize"
            >
              {getStatusLabel(status)}
            </DashboardButton>
          ))}
        </div>
      </DashboardCard>

      {/* Table */}
      <DashboardCard>
        <DashboardCardHeader>
          <DashboardCardTitle>Fulfillment Orders ({orders.length})</DashboardCardTitle>
        </DashboardCardHeader>
        <DashboardCardContent>
          {orders.length === 0 ? (
            <DashboardEmptyState
              title="No fulfillment orders yet"
              description="Orders sent to fulfillment partners will appear here"
              icon={<Zap className="w-10 h-10 text-gray-700 mb-4" />}
            />
          ) : (
            <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="py-3 pr-4 font-medium text-gray-500 text-left">Order</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-left">Partner</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-right">Qty</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-right">Cost</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-right">Profit</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-left">Status</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-left">Tracking</th>
                    <th className="py-3 pl-4 font-medium text-gray-500 text-left">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((fo) => (
                    <tr key={fo.id} className="border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.02] transition-colors">
                      <td className="py-4 pr-4">
                        <div>
                          <p className="font-medium text-white">{fo.order?.customerName || 'N/A'}</p>
                          <p className="text-xs text-gray-500 font-mono">{fo.order?.id?.slice(0, 8)}</p>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <p className="font-medium text-white">{fo.partner?.name}</p>
                        <p className="text-xs text-gray-500">{fo.partner?.country}</p>
                      </td>
                      <td className="py-4 px-4 text-right text-gray-300">{fo.quantity}</td>
                      <td className="py-4 px-4 text-right text-gray-300">{formatCurrency(fo.totalCost)}</td>
                      <td className="py-4 px-4 text-right text-emerald-400 font-semibold">
                        {formatCurrency(fo.profit)}
                      </td>
                      <td className="py-4 px-4">
                        <StatusBadge status={fo.status} />
                      </td>
                      <td className="py-4 px-4 text-xs font-mono text-gray-500">
                        {fo.shipment?.trackingNumber || '—'}
                      </td>
                      <td className="py-4 pl-4 text-sm text-gray-500">
                        {formatDateTime(new Date(fo.createdAt))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCardContent>
      </DashboardCard>
    </div>
  );
}
