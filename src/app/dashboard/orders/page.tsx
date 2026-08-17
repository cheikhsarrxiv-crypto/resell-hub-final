'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Badge } from '@/components/UI/Button';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/UI/Button';
import { ShoppingCart, Eye } from 'lucide-react';
import { formatCurrency, getStatusLabel, getStatusColor, formatDateTime } from '@/lib/utils';
import Link from 'next/link';
import { Button } from '@/components/UI/Button';

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

  const statuses = [
    'pending',
    'processing',
    'shipped',
    'delivered',
    'cancelled',
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold font-display text-[#14161A]">Orders</h1>
          <p className="text-gray-600 mt-1">Manage and track your orders</p>
        </div>
      </div>

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
              All Orders
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

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle>Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-600">Loading orders...</div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">No orders found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-left">Order ID</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-left">Customer</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-right">Total</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-right">Profit</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-left">Status</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-left">Fulfillment</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-left">Date</th>
                    <th className="px-6 py-3 font-semibold text-gray-900 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-6 py-4 font-mono text-xs">{order.id.slice(0, 8)}</td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium">{order.customerName}</p>
                          <p className="text-xs text-gray-500">{order.customerEmail}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-semibold">
                        {formatCurrency(order.totalPrice)}
                      </td>
                      <td className="px-6 py-4 text-right text-green-600 font-semibold">
                        {formatCurrency(order.estimatedProfit)}
                      </td>
                      <td className="px-6 py-4">
                        <div className={`inline-flex px-2 py-1 rounded text-xs font-medium ${getStatusColor(order.status)}`}>
                          {getStatusLabel(order.status)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={order.fulfillmentType === 'automatic' ? 'success' : 'default'}>
                          {order.fulfillmentType}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatDateTime(new Date(order.createdAt))}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Link href={`/dashboard/orders/${order.id}`}>
                          <Eye className="w-4 h-4 inline cursor-pointer text-[#FF5A1F] hover:text-[#e64f18]" />
                        </Link>
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
