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
import { DashboardLoadingState, DashboardErrorState, DashboardUpgradeState } from '@/components/dashboard/DashboardStates';
import { classifyMetricsResponse, type MetricsFetchOutcome } from '@/lib/dashboardMetricsState';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { TrendingUp, ShoppingCart, Package, Zap, Plus } from 'lucide-react';

export default function DashboardPage() {
  const { workspaceId, isReady } = useWorkspace();
  const [state, setState] = useState<MetricsFetchOutcome | { kind: 'loading' }>({ kind: 'loading' });
  const [revenueTrend, setRevenueTrend] = useState<{ date: string; revenue: number }[]>([]);

  useEffect(() => {
    if (!isReady) return;
    fetchMetrics();
  }, [isReady, workspaceId]);

  const fetchMetrics = async () => {
    if (!workspaceId) {
      setState({ kind: 'error', message: 'Aucun espace de travail trouvé pour ce compte.' });
      return;
    }

    setState({ kind: 'loading' });

    try {
      const [metricsRes, overviewRes] = await Promise.all([
        fetch(`/api/analytics/dashboard?workspaceId=${workspaceId}&days=30`),
        fetch(`/api/analytics/overview?workspaceId=${workspaceId}&days=14`),
      ]);
      const data = await metricsRes.json().catch(() => null);
      setState(classifyMetricsResponse(metricsRes.status, data, 'Échec du chargement des indicateurs.'));

      // Best-effort: the revenue sparkline is a nice-to-have, never the
      // reason the whole page shows an error — a failure here just means
      // no sparkline, same as before this fix.
      const overviewData = await overviewRes.json().catch(() => null);
      if (overviewRes.ok && overviewData?.success) {
        setRevenueTrend(overviewData.revenueTrend || []);
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
      setState({ kind: 'error', message: "Une erreur réseau s'est produite lors du chargement de ton tableau de bord." });
    }
  };

  if (state.kind === 'loading') {
    return <DashboardLoadingState message="Chargement du tableau de bord..." />;
  }

  if (state.kind === 'plan_upgrade_required') {
    return <DashboardUpgradeState message={state.message} />;
  }

  if (state.kind === 'unauthorized') {
    return (
      <DashboardErrorState
        message="Session expirée"
        details={state.message}
        action={
          <Link href="/login">
            <DashboardButton variant="primary" size="sm">
              Se reconnecter
            </DashboardButton>
          </Link>
        }
      />
    );
  }

  if (state.kind === 'error') {
    return <DashboardErrorState message="Échec du chargement des indicateurs" details={state.message} onRetry={fetchMetrics} />;
  }

  const metrics = state.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tableau de bord"
        description="Bienvenue ! Voici un aperçu de ton activité."
        action={
          <Link href="/dashboard/listings/new">
            <DashboardButton variant="primary">
              <Plus className="w-4 h-4" />
              Créer une annonce
            </DashboardButton>
          </Link>
        }
      />

      {/* Revenue trend sparkline — real data from the last 14 days, same
          source already used on the Analytics page (no new backend logic) */}
      {revenueTrend.length > 1 && (
        <DashboardCard className="px-5 sm:px-6 py-4 flex items-center justify-between gap-6 dash-reveal">
          <div className="shrink-0">
            <p className="text-sm text-gray-500">14 derniers jours</p>
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
        <StatCard label="Chiffre d'affaires" value={formatCurrency(metrics.revenue)} icon={<TrendingUp className="w-5 h-5" />} accent />
        <StatCard label="Commandes" value={formatNumber(metrics.orders)} icon={<ShoppingCart className="w-5 h-5" />} />
        <StatCard label="Bénéfice" value={formatCurrency(metrics.profit)} icon={<TrendingUp className="w-5 h-5" />} accent />
        <StatCard label="Marge" value={`${metrics.margin.toFixed(1)}%`} icon={<Package className="w-5 h-5" />} />
      </div>

      {/* Revenue Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <DashboardCard>
          <DashboardCardHeader>
            <DashboardCardTitle>Vue d'ensemble du stock</DashboardCardTitle>
            <DashboardCardDescription>État actuel de tes produits</DashboardCardDescription>
          </DashboardCardHeader>
          <DashboardCardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
                <span className="text-gray-400 text-sm">Total des produits</span>
                <span className="text-xl font-bold text-white">{metrics.productsCount}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
                <span className="text-gray-400 text-sm">Annonces actives</span>
                <span className="text-xl font-bold text-white">{metrics.activeListings}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Commandes en attente</span>
                <span className="text-xl font-bold text-white">{metrics.pendingOrders}</span>
              </div>
            </div>
          </DashboardCardContent>
        </DashboardCard>

        <DashboardCard>
          <DashboardCardHeader>
            <DashboardCardTitle>État du fulfillment</DashboardCardTitle>
            <DashboardCardDescription>Commandes de fulfillment automatique</DashboardCardDescription>
          </DashboardCardHeader>
          <DashboardCardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
                <span className="text-gray-400 text-sm">Fulfillments actifs</span>
                <span className="text-xl font-bold text-[#FF5A1F]">{metrics.fulfillmentOrders}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-white/[0.06]">
                <span className="text-gray-400 text-sm">Chiffre d'affaires fulfillment</span>
                <span className="text-xl font-bold text-white">{formatCurrency(metrics.fulfillmentRevenue)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Coûts de fulfillment</span>
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
            <DashboardCardTitle>Performance par marketplace</DashboardCardTitle>
            <DashboardCardDescription>Chiffre d'affaires et bénéfice par marketplace</DashboardCardDescription>
          </DashboardCardHeader>
          <DashboardCardContent>
            <div className="space-y-4">
              {Object.entries(metrics.revenueByMarketplace).map(([marketplace, revenue]) => (
                <div key={marketplace} className="flex justify-between items-center pb-4 border-b border-white/[0.06] last:border-b-0 last:pb-0">
                  <div>
                    <p className="font-medium text-white">{marketplace}</p>
                    <p className="text-sm text-gray-500">
                      Bénéfice : {formatCurrency(metrics.profitByMarketplace[marketplace] || 0)}
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
          <DashboardCardTitle>Résumé financier</DashboardCardTitle>
        </DashboardCardHeader>
        <DashboardCardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500">Revenus des abonnements</p>
              <p className="text-lg font-bold text-white mt-1">{formatCurrency(metrics.revenue)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Chiffre d'affaires fulfillment</p>
              <p className="text-lg font-bold text-white mt-1">{formatCurrency(metrics.fulfillmentRevenue)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Bénéfice brut</p>
              <p className="text-lg font-bold text-emerald-400 mt-1">{formatCurrency(metrics.grossProfit)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Chiffre d'affaires net</p>
              <p className="text-lg font-bold text-white mt-1">{formatCurrency(metrics.netRevenue)}</p>
            </div>
          </div>
        </DashboardCardContent>
      </DashboardCard>
    </div>
  );
}
