'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { LoadingState, ErrorState } from '@/components/StateComponents';
import { Users, Building2, TrendingUp, DollarSign, ShoppingCart, AlertCircle } from 'lucide-react';

interface AdminStats {
  users: number;
  workspaces: number;
  activeSubscriptions: number;
  freePlanUsers: number;
  mrr: number;
  arr: number;
  arpu: number;
  gmv: number;
  totalOrders: number;
  subscriptionRevenue: number;
  fulfillmentRevenue: number;
  fulfillmentCosts: number;
  grossProfit: number;
  churnRate: number;
  fulfillment: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
  };
  subscriptionsByPlan: Array<{ planName: string; count: number }>;
  ordersByStatus: Array<{ status: string; count: number }>;
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/metrics');
      const data = await response.json();

      if (data.success) {
        setStats(data.data);
      } else {
        setError('Failed to load metrics');
      }
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
      setError('An error occurred while loading metrics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading admin dashboard..." />;
  }

  if (error || !stats) {
    return (
      <ErrorState
        message="Failed to load admin dashboard"
        details={error || undefined}
        onRetry={() => fetchMetrics()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600 mt-1">Real-time metrics from database</p>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Users */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Total Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.users}</p>
            <p className="text-xs text-gray-600 mt-1">
              Free: {stats.freePlanUsers} | Paid: {stats.activeSubscriptions}
            </p>
          </CardContent>
        </Card>

        {/* Workspaces */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Total Workspaces
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.workspaces}</p>
            <p className="text-xs text-gray-600 mt-1">
              Active: {stats.activeSubscriptions}
            </p>
          </CardContent>
        </Card>

        {/* MRR */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Monthly Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">€{stats.mrr.toFixed(2)}</p>
            <p className="text-xs text-gray-600 mt-1">
              ARR: €{stats.arr.toFixed(0)}
            </p>
          </CardContent>
        </Card>

        {/* GMV */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Gross Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">€{stats.gmv.toFixed(2)}</p>
            <p className="text-xs text-gray-600 mt-1">
              {stats.totalOrders} orders
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Subscription Revenue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="text-sm text-gray-600">Monthly (MRR)</p>
              <p className="text-2xl font-bold">€{stats.subscriptionRevenue.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fulfillment Revenue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="text-sm text-gray-600">Completed Orders</p>
              <p className="text-2xl font-bold">€{stats.fulfillmentRevenue.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fulfillment Costs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="text-sm text-gray-600">Total Costs</p>
              <p className="text-2xl font-bold text-red-600">€{stats.fulfillmentCosts.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Profitability */}
      <Card>
        <CardHeader>
          <CardTitle>Profitability Metrics</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-sm text-gray-600">Gross Profit</p>
            <p className="text-3xl font-bold text-green-600">
              €{stats.grossProfit.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">ARPU</p>
            <p className="text-3xl font-bold">€{stats.arpu.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Churn Rate</p>
            <p className={`text-3xl font-bold ${stats.churnRate > 10 ? 'text-red-600' : 'text-green-600'}`}>
              {stats.churnRate.toFixed(1)}%
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Subscriptions Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Subscriptions by Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {stats.subscriptionsByPlan.map((plan) => (
              <div key={plan.planName} className="flex items-center justify-between">
                <span className="font-medium">{plan.planName}</span>
                <div className="flex items-center gap-4">
                  <div className="w-32 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-[#FF5A1F] h-2 rounded-full"
                      style={{
                        width: `${Math.min(100, (plan.count / Math.max(...stats.subscriptionsByPlan.map(p => p.count))) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="font-bold w-8 text-right">{plan.count}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Orders Status */}
      <Card>
        <CardHeader>
          <CardTitle>Orders by Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.ordersByStatus.map((status) => (
              <div key={status.status} className="text-center">
                <p className="text-sm text-gray-600 capitalize">{status.status}</p>
                <p className="text-2xl font-bold">{status.count}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Fulfillment Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            Fulfillment Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-600">Total</p>
            <p className="text-2xl font-bold">{stats.fulfillment.total}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Completed</p>
            <p className="text-2xl font-bold text-green-600">{stats.fulfillment.completed}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Pending</p>
            <p className="text-2xl font-bold text-yellow-600">{stats.fulfillment.pending}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Failed</p>
            <p className="text-2xl font-bold text-red-600">{stats.fulfillment.failed}</p>
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="bg-[#FF5A1F]/10 border-[#FF5A1F]/30">
        <CardHeader>
          <CardTitle className="text-[#14161A] flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            About Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-700 space-y-2">
          <p>• All metrics are calculated from real database data</p>
          <p>• MRR = Monthly Recurring Revenue from active subscriptions</p>
          <p>• ARR = MRR × 12</p>
          <p>• ARPU = Average Revenue Per User</p>
          <p>• GMV = Gross Merchandise Volume (all order prices)</p>
          <p>• Churn Rate = Canceled subscriptions last 30 days</p>
          <p>• Data updated in real-time from database</p>
        </CardContent>
      </Card>
    </div>
  );
}
