'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle, StatCard } from '@/components/UI/Card';
import { Badge } from '@/components/UI/Button';
import { Zap, TrendingUp, Package, Truck } from 'lucide-react';
import { formatCurrency, getStatusColor, getStatusLabel, formatDateTime } from '@/lib/utils';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateComponents';

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
    return <LoadingState message="Loading fulfillment data..." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold font-display text-[#14161A]">Fulfillment</h1>
        <p className="text-gray-600 mt-1">Track orders sent to fulfillment partners</p>
      </div>

      {error && (
        <ErrorState
          message="Failed to load fulfillment data"
          details={error || undefined}
          onRetry={() => fetchFulfillmentData()}
        />
      )}

      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            label="Fulfillment Orders"
            value={metrics.totalOrders}
            icon={<Zap className="w-8 h-8" />}
          />
          <StatCard
            label="Revenue"
            value={formatCurrency(metrics.totalRevenue)}
            icon={<TrendingUp className="w-8 h-8" />}
          />
          <StatCard
            label="Profit"
            value={formatCurrency(metrics.totalProfit)}
            icon={<Package className="w-8 h-8" />}
          />
          <StatCard
            label="Margin"
            value={`${metrics.margin.toFixed(1)}%`}
            icon={<Truck className="w-8 h-8" />}
          />
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setStatusFilter('')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                statusFilter === ''
                  ? 'bg-[#FF5A1F] text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              All
            </button>
            {statuses.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors capitalize ${
                  statusFilter === status
                    ? 'bg-[#FF5A1F] text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {getStatusLabel(status)}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Fulfillment Orders ({orders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <EmptyState
              title="No fulfillment orders yet"
              description="Orders sent to fulfillment partners will appear here"
              icon={<Zap className="w-12 h-12 text-gray-300 mb-4" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-left">Order</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-left">Partner</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-right">Qty</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-right">Cost</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-right">Profit</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-left">Status</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-left">Tracking</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-left">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((fo) => (
                    <tr key={fo.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium">{fo.order?.customerName || 'N/A'}</p>
                          <p className="text-xs text-gray-500 font-mono">{fo.order?.id?.slice(0, 8)}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-900">{fo.partner?.name}</p>
                        <p className="text-xs text-gray-500">{fo.partner?.country}</p>
                      </td>
                      <td className="px-6 py-4 text-right">{fo.quantity}</td>
                      <td className="px-6 py-4 text-right">{formatCurrency(fo.totalCost)}</td>
                      <td className="px-6 py-4 text-right text-green-600 font-semibold">
                        {formatCurrency(fo.profit)}
                      </td>
                      <td className="px-6 py-4">
                        <div className={`inline-flex px-2 py-1 rounded text-xs font-medium ${getStatusColor(fo.status)}`}>
                          {getStatusLabel(fo.status)}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-gray-600">
                        {fo.shipment?.trackingNumber || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatDateTime(new Date(fo.createdAt))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
