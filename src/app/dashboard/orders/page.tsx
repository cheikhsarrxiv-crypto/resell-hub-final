'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { DashboardCard, DashboardCardContent, DashboardCardHeader, DashboardCardTitle } from '@/components/dashboard/DashboardCard';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { DashboardButton } from '@/components/dashboard/DashboardButton';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { DashboardLoadingState, DashboardEmptyState } from '@/components/dashboard/DashboardStates';
import { ShoppingCart, Eye } from 'lucide-react';
import { formatCurrency, getStatusLabel, formatDateTime } from '@/lib/utils';
import Link from 'next/link';

export default function OrdersPage() {
  const { workspaceId, isReady } = useWorkspace();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    if (!isReady) return;
    fetchOrders();
  }, [statusFilter, isReady, workspaceId]);

  const fetchOrders = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    try {
      let url = `/api/orders?workspaceId=${workspaceId}`;
      if (statusFilter) url += `&status=${statusFilter}`;

      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        setOrders(data.orders);
      }
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const statuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

  return (
    <div className="space-y-6">
      <PageHeader title="Orders" description="Manage and track your orders" />

      {/* Filters */}
      <DashboardCard className="p-4 sm:p-5">
        <div className="flex gap-2 flex-wrap">
          <DashboardButton
            variant={statusFilter === '' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('')}
          >
            All Orders
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

      {/* Orders Table */}
      <DashboardCard>
        <DashboardCardHeader>
          <DashboardCardTitle>Orders</DashboardCardTitle>
        </DashboardCardHeader>
        <DashboardCardContent>
          {loading ? (
            <DashboardLoadingState message="Loading orders..." />
          ) : orders.length === 0 ? (
            <DashboardEmptyState
              title="No orders found"
              description="Orders will appear here once you make a sale"
              icon={<ShoppingCart className="w-10 h-10 text-gray-700 mb-4" />}
            />
          ) : (
            <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="py-3 pr-4 font-medium text-gray-500 text-left">Order ID</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-left">Customer</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-right">Total</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-right">Profit</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-left">Status</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-left">Fulfillment</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-left">Date</th>
                    <th className="py-3 pl-4 font-medium text-gray-500 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.02] transition-colors">
                      <td className="py-4 pr-4 font-mono text-xs text-gray-500">{order.id.slice(0, 8)}</td>
                      <td className="py-4 px-4">
                        <div>
                          <p className="font-medium text-white">{order.customerName}</p>
                          <p className="text-xs text-gray-500">{order.customerEmail}</p>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right font-semibold text-white">
                        {formatCurrency(order.totalPrice)}
                      </td>
                      <td className="py-4 px-4 text-right text-emerald-400 font-semibold">
                        {formatCurrency(order.estimatedProfit)}
                      </td>
                      <td className="py-4 px-4">
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium border ${
                            order.fulfillmentType === 'automatic'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-white/[0.06] text-gray-400 border-white/10'
                          }`}
                        >
                          {order.fulfillmentType}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-sm text-gray-500">
                        {formatDateTime(new Date(order.createdAt))}
                      </td>
                      <td className="py-4 pl-4 text-center">
                        <Link href={`/dashboard/orders/${order.id}`}>
                          <button className="p-1.5 hover:bg-white/[0.06] rounded-full transition-colors inline-flex">
                            <Eye className="w-4 h-4 text-[#FF5A1F]" />
                          </button>
                        </Link>
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
