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
import { DashboardLoadingState, DashboardErrorState, DashboardLockedCard } from '@/components/dashboard/DashboardStates';
import { getWorkspaceReadiness } from '@/lib/dashboardListPageState';
import {
  classifyMetricsResponse,
  classifyBasicResponse,
  composeAccessView,
  metricsOutcomeToAdvanced,
  type AccessView,
  type BasicOutcome,
} from '@/lib/dashboardMetricsState';
import type { DashboardMetrics } from '@/types';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { sumMoney, UNKNOWN_CURRENCY } from '@/lib/financial';
import { TrendingUp, ShoppingCart, Package, Zap, Plus } from 'lucide-react';

export default function DashboardPage() {
  const { workspaceId, isReady, workspace, loading: workspaceLoading, error: workspaceError } = useWorkspace();
  const [state, setState] = useState<AccessView<DashboardMetrics> | { kind: 'loading' }>({ kind: 'loading' });
  const workspaceReadiness = getWorkspaceReadiness(workspace, workspaceLoading, workspaceError);
  const [revenueTrend, setRevenueTrend] = useState<{ date: string; revenue: number }[]>([]);
  const [trendCurrency, setTrendCurrency] = useState<string>('EUR');

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
      // Basic (every plan) and Advanced (plan feature) are separate requests: an Advanced refusal
      // must never take the Basic figures down with it. A Basic network failure is turned into a
      // Basic error outcome instead of rejecting the whole Promise.all, so it cannot break a plan
      // that does not need Basic.
      const [metricsRes, overviewRes, basicRes] = await Promise.all([
        fetch(`/api/analytics/dashboard?workspaceId=${workspaceId}&days=30`),
        fetch(`/api/analytics/overview?workspaceId=${workspaceId}&days=14`),
        fetch(`/api/analytics/basic?workspaceId=${workspaceId}&days=30`).catch(() => null),
      ]);
      const data = await metricsRes.json().catch(() => null);
      const advanced = metricsOutcomeToAdvanced(
        classifyMetricsResponse(metricsRes.status, data, 'Échec du chargement des indicateurs.')
      );
      let basic: BasicOutcome = { kind: 'error', message: 'Échec du chargement des indicateurs.' };
      if (basicRes) {
        const basicData = await basicRes.json().catch(() => null);
        basic = classifyBasicResponse(basicRes.status, basicData, 'Échec du chargement des indicateurs.');
      }
      setState(composeAccessView(basic, advanced));

      // Best-effort: the revenue sparkline is a nice-to-have, never the
      // reason the whole page shows an error — a failure here just means
      // no sparkline, same as before this fix.
      const overviewData = await overviewRes.json().catch(() => null);
      if (overviewRes.ok && overviewData?.success) {
        setRevenueTrend(overviewData.revenueTrend || []);
        if (typeof overviewData.currency === 'string') setTrendCurrency(overviewData.currency);
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
      setState({ kind: 'error', message: "Une erreur réseau s'est produite lors du chargement de ton tableau de bord." });
    }
  };

  if (workspaceReadiness.status === 'error') {
    return (
      <DashboardErrorState
        message="Aucun espace de travail disponible"
        details={workspaceReadiness.message}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (state.kind === 'loading') {
    return <DashboardLoadingState message="Chargement du tableau de bord..." />;
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

  if (state.access === 'basic') {
    const basic = state.basic;
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <StatCard label="Commandes (30 j)" value={formatNumber(basic.orders)} icon={<ShoppingCart className="w-5 h-5" />} accent />
          <StatCard label="Produits" value={formatNumber(basic.productsCount)} icon={<Package className="w-5 h-5" />} />
          <StatCard label="Annonces actives" value={formatNumber(basic.activeListings)} icon={<Zap className="w-5 h-5" />} />
          <StatCard label="Commandes en attente" value={formatNumber(basic.pendingOrders)} icon={<ShoppingCart className="w-5 h-5" />} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <DashboardLockedCard title="Chiffre d'affaires, bénéfice et marge" description={state.lockedMessage} />
          <DashboardLockedCard title="Performance par marketplace" description={state.lockedMessage} />
          <DashboardLockedCard title="Fulfillment et résumé financier" description={state.lockedMessage} />
        </div>
      </div>
    );
  }

  const metrics = state.advanced;
  const money = (value: number) => formatCurrency(value, metrics.currency);

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
              {formatCurrency(sumMoney(revenueTrend.map((p) => p.revenue), trendCurrency), trendCurrency)}
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
                  title={`${p.date}: ${formatCurrency(p.revenue, trendCurrency)}`}
                />
              ));
            })()}
          </div>
        </DashboardCard>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <StatCard label="Chiffre d'affaires" value={money(metrics.revenue)} icon={<TrendingUp className="w-5 h-5" />} accent />
        <StatCard label="Commandes" value={formatNumber(metrics.orders)} icon={<ShoppingCart className="w-5 h-5" />} />
        <StatCard label="Bénéfice" value={metrics.marginAvailable ? money(metrics.profit) : '—'} icon={<TrendingUp className="w-5 h-5" />} accent />
        <StatCard label="Marge" value={metrics.marginAvailable ? `${metrics.margin.toFixed(1)}%` : '—'} icon={<Package className="w-5 h-5" />} />
      </div>

      {(metrics.ordersWithUnknownProfit > 0 || metrics.cancelledOrders > 0 || metrics.mixedCurrencies) && (
        <DashboardCard className="px-5 sm:px-6 py-4 space-y-2 text-sm text-gray-400" data-testid="financial-notes">
          {metrics.ordersWithUnknownProfit > 0 && (
            <p>
              Bénéfice non calculé pour {metrics.ordersWithUnknownProfit} commande(s) synchronisée(s) : le coût d'achat, les frais,
              la livraison et les remboursements ne sont pas importés. Elles sont exclues du bénéfice et de la marge.
            </p>
          )}
          {metrics.cancelledOrders > 0 && <p>{metrics.cancelledOrders} commande(s) annulée(s) exclue(s) des montants.</p>}
          {metrics.mixedCurrencies && (
            <div>
              <p>Montants en {metrics.currency}. Autres devises, jamais additionnées :</p>
              <ul className="list-disc ml-5">
                {metrics.byCurrency
                  .filter((b) => b.currency !== metrics.currency)
                  .map((b) => (
                    <li key={b.currency}>
                      {b.currency === UNKNOWN_CURRENCY ? 'Devise inconnue (commandes synchronisées avant l\'enregistrement des devises)' : b.currency} :{' '}
                      {b.orders} commande(s)
                      {b.currency !== UNKNOWN_CURRENCY && ` · ${formatCurrency(b.revenue, b.currency)} de chiffre d'affaires`}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </DashboardCard>
      )}

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
                <span className="text-xl font-bold text-white">{money(metrics.fulfillmentRevenue)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Coûts de fulfillment</span>
                <span className="text-lg font-semibold text-white">{money(metrics.fulfillmentCost)}</span>
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
                      Bénéfice : {marketplace in metrics.profitByMarketplace ? money(metrics.profitByMarketplace[marketplace]) : '—'}
                    </p>
                  </div>
                  <p className="text-lg font-semibold text-white">{money(revenue)}</p>
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
              <p className="text-lg font-bold text-white mt-1">{money(metrics.revenue)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Chiffre d'affaires fulfillment</p>
              <p className="text-lg font-bold text-white mt-1">{money(metrics.fulfillmentRevenue)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Bénéfice brut</p>
              <p className="text-lg font-bold text-emerald-400 mt-1">{money(metrics.grossProfit)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Chiffre d'affaires net</p>
              <p className="text-lg font-bold text-white mt-1">{money(metrics.netRevenue)}</p>
            </div>
          </div>
        </DashboardCardContent>
      </DashboardCard>
    </div>
  );
}
