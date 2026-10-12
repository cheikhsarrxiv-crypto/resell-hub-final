'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/hooks';
import { DashboardCard, DashboardCardContent, DashboardCardHeader, DashboardCardTitle } from '@/components/dashboard/DashboardCard';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { DashboardButton } from '@/components/dashboard/DashboardButton';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { DashboardLoadingState, DashboardErrorState, DashboardEmptyState } from '@/components/dashboard/DashboardStates';
import { getWorkspaceReadiness, parseApiListResponse, getListPageState } from '@/lib/dashboardListPageState';
import { ArrowLeft, Download, FileWarning, PackageSearch } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { CdslExportPreDownloadWarning, CdslExportPostDownloadWarning } from './CdslExportWarnings';

interface CdslCandidateItem {
  productId: string;
  sku: string | null;
  title: string;
  quantity: number;
}

interface CdslCandidateOrder {
  id: string;
  createdAt: string;
  status: string;
  customerName: string;
  customerEmail: string;
  shippingAddress: string;
  shippingAddress2: string | null;
  shippingCity: string;
  shippingPostalCode: string;
  shippingCountry: string;
  shippingPhone: string | null;
  items: CdslCandidateItem[];
  cdslValidationErrors: string[];
}

export default function CdslExportPage() {
  const { workspaceId, isReady, loading: workspaceLoading, workspace, error: workspaceError } = useWorkspace();
  const [orders, setOrders] = useState<CdslCandidateOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [desiredDeliveryDate, setDesiredDeliveryDate] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string[] | null>(null);
  const [lastExport, setLastExport] = useState<{ at: Date; orderIds: string[]; filename: string } | null>(null);

  useEffect(() => {
    if (!isReady) return;
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, workspaceId]);

  const fetchOrders = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setApiError(null);

    try {
      const response = await fetch(`/api/orders/export/cdsl?workspaceId=${workspaceId}`);
      const data = await response.json();
      const result = parseApiListResponse<CdslCandidateOrder>(
        response.ok,
        data,
        'orders',
        'Impossible de charger les commandes. Veuillez réessayer.'
      );
      if (result.ok) {
        setOrders(result.items);
        // Pre-select every order that passes validation today — the
        // server re-validates at download time regardless, so this is a
        // convenience default, never trusted on its own.
        setSelected(new Set(result.items.filter((o) => o.cdslValidationErrors.length === 0).map((o) => o.id)));
      } else {
        setApiError(result.error);
      }
    } catch (error) {
      console.error('Failed to fetch CDSL export candidates:', error);
      setApiError(error instanceof Error ? error.message : 'Impossible de charger les commandes. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  };

  const workspaceReadiness = getWorkspaceReadiness(workspace, workspaceLoading, workspaceError);

  const toggleOrder = (orderId: string, hasErrors: boolean) => {
    if (hasErrors) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const selectableOrders = orders.filter((o) => o.cdslValidationErrors.length === 0);
  const allSelectableSelected = selectableOrders.length > 0 && selectableOrders.every((o) => selected.has(o.id));

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableOrders.map((o) => o.id)));
    }
  };

  const handleDownload = async () => {
    if (!workspaceId || selected.size === 0) return;

    setDownloading(true);
    setDownloadError(null);

    try {
      const response = await fetch('/api/orders/export/cdsl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          orderIds: Array.from(selected),
          desiredDeliveryDate: desiredDeliveryDate || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setDownloadError(
          Array.isArray(data.details) && data.details.length > 0
            ? data.details
            : [data.error || 'Échec de la génération du fichier CSV.']
        );
        return;
      }

      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch ? filenameMatch[1] : 'cdsl-export.csv';

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setLastExport({ at: new Date(), orderIds: Array.from(selected), filename });
    } catch (error) {
      console.error('CDSL export download failed:', error);
      setDownloadError([error instanceof Error ? error.message : 'Échec de la génération du fichier CSV.']);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Export CDSL"
        description="Génère un fichier CSV de commandes au format CDSL, à envoyer manuellement — aucun e-mail ni appel API n'est déclenché."
        action={
          <Link href="/dashboard/orders">
            <DashboardButton variant="outline">
              <ArrowLeft className="w-4 h-4" />
              Retour aux commandes
            </DashboardButton>
          </Link>
        }
      />

      {lastExport && (
        <CdslExportPostDownloadWarning
          exportedAtLabel={formatDateTime(lastExport.at)}
          orderCount={lastExport.orderIds.length}
          filename={lastExport.filename}
        />
      )}

      <CdslExportPreDownloadWarning />

      {downloadError && (
        <DashboardErrorState
          message="Validation échouée — aucun fichier n'a été généré"
          details={downloadError.join(' · ')}
          onRetry={() => setDownloadError(null)}
        />
      )}

      {/* Desired delivery date — applies to every selected order in this
          export; ADKSY has no per-order field for this today (see
          CdslExportService.ts). Optional, left blank by default. */}
      <DashboardCard className="p-4 sm:p-5">
        <label className="block text-sm font-medium text-gray-300 mb-2" htmlFor="cdsl-delivery-date">
          Date de livraison souhaitée (facultative, appliquée à tout l&apos;export)
        </label>
        <input
          id="cdsl-delivery-date"
          type="date"
          value={desiredDeliveryDate}
          onChange={(e) => setDesiredDeliveryDate(e.target.value)}
          className="bg-[#0d0e11] border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60"
        />
      </DashboardCard>

      <DashboardCard>
        <DashboardCardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <DashboardCardTitle>Commandes à exporter ({orders.length})</DashboardCardTitle>
          <div className="flex items-center gap-3">
            <DashboardButton variant="outline" size="sm" onClick={toggleSelectAll} disabled={selectableOrders.length === 0}>
              {allSelectableSelected ? 'Tout désélectionner' : 'Tout sélectionner (valides)'}
            </DashboardButton>
            <DashboardButton
              variant="primary"
              size="sm"
              onClick={handleDownload}
              loading={downloading}
              disabled={selected.size === 0}
            >
              <Download className="w-4 h-4" />
              Télécharger le CSV ({selected.size})
            </DashboardButton>
          </div>
        </DashboardCardHeader>
        <DashboardCardContent>
          {(() => {
            const pageState = getListPageState(workspaceReadiness, loading, apiError, orders.length);

            if (pageState === 'error') {
              const isWorkspaceError = workspaceReadiness.status === 'error';
              return (
                <DashboardErrorState
                  message={isWorkspaceError ? workspaceReadiness.message : apiError || 'Impossible de charger les commandes.'}
                  onRetry={isWorkspaceError ? () => window.location.reload() : fetchOrders}
                />
              );
            }

            if (pageState === 'loading') {
              return <DashboardLoadingState message="Chargement des commandes..." />;
            }

            if (pageState === 'empty') {
              return (
                <DashboardEmptyState
                  title="Aucune commande éligible"
                  description="Les commandes déjà annulées, livrées, ou déjà prises en charge par un autre partenaire de fulfillment n'apparaissent pas ici."
                  icon={<PackageSearch className="w-10 h-10 text-gray-700 mb-4" />}
                />
              );
            }

            return (
              <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="py-3 pr-4 font-medium text-gray-500 text-left"> </th>
                      <th className="py-3 px-4 font-medium text-gray-500 text-left">Commande</th>
                      <th className="py-3 px-4 font-medium text-gray-500 text-left">Client</th>
                      <th className="py-3 px-4 font-medium text-gray-500 text-left">Produits</th>
                      <th className="py-3 px-4 font-medium text-gray-500 text-left">Statut</th>
                      <th className="py-3 pl-4 font-medium text-gray-500 text-left">Validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => {
                      const hasErrors = order.cdslValidationErrors.length > 0;
                      return (
                        <tr key={order.id} className="border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.02] transition-colors align-top">
                          <td className="py-4 pr-4">
                            <input
                              type="checkbox"
                              checked={selected.has(order.id)}
                              onChange={() => toggleOrder(order.id, hasErrors)}
                              disabled={hasErrors}
                              aria-label={`Sélectionner la commande ${order.id}`}
                              className="w-4 h-4 accent-[#FF5A1F]"
                            />
                          </td>
                          <td className="py-4 px-4">
                            <p className="font-mono text-xs text-gray-500">{order.id.slice(0, 10)}…</p>
                            <p className="text-xs text-gray-600">{formatDateTime(new Date(order.createdAt))}</p>
                          </td>
                          <td className="py-4 px-4">
                            <p className="font-medium text-white">{order.customerName}</p>
                            <p className="text-xs text-gray-500">{order.customerEmail}</p>
                          </td>
                          <td className="py-4 px-4">
                            {order.items.map((item) => (
                              <p key={item.productId} className="text-xs text-gray-400 font-mono">
                                {item.sku || '—'} × {item.quantity}
                              </p>
                            ))}
                          </td>
                          <td className="py-4 px-4">
                            <StatusBadge status={order.status} />
                          </td>
                          <td className="py-4 pl-4 max-w-xs">
                            {hasErrors ? (
                              <div className="flex items-start gap-1.5 text-red-400 text-xs">
                                <FileWarning className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <ul className="space-y-1">
                                  {order.cdslValidationErrors.map((err, i) => (
                                    <li key={i}>{err}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : (
                              <span className="text-emerald-400 text-xs">Prête pour l&apos;export</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </DashboardCardContent>
      </DashboardCard>
    </div>
  );
}
