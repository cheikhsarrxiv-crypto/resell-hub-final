'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { DashboardCard, DashboardCardContent, DashboardCardHeader, DashboardCardTitle } from '@/components/dashboard/DashboardCard';
import { DashboardButton } from '@/components/dashboard/DashboardButton';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { DashboardLoadingState, DashboardErrorState, DashboardEmptyState } from '@/components/dashboard/DashboardStates';
import { getWorkspaceReadiness, parseApiListResponse, getListPageState } from '@/lib/dashboardListPageState';
import Link from 'next/link';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { Plus, Eye, Trash2 } from 'lucide-react';

export default function ListingsPage() {
  const { workspaceId, isReady, loading: workspaceLoading, workspace, error: workspaceError } = useWorkspace();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [syncStatusFilter, setSyncStatusFilter] = useState<string>('');

  useEffect(() => {
    if (!isReady) return;
    fetchListings();
  }, [isReady, workspaceId]);

  const fetchListings = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setApiError(null);

    try {
      const response = await fetch(`/api/listings?workspaceId=${workspaceId}`);
      const data = await response.json();
      const result = parseApiListResponse<any>(response.ok, data, 'listings', 'Failed to load listings. Please try again.');
      if (result.ok) {
        setListings(result.items);
      } else {
        setApiError(result.error);
      }
    } catch (error) {
      console.error('Failed to fetch listings:', error);
      setApiError(error instanceof Error ? error.message : 'Failed to load listings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const workspaceReadiness = getWorkspaceReadiness(workspace, workspaceLoading, workspaceError);

  const visibleListings = syncStatusFilter
    ? listings.filter((l) => l.syncStatus === syncStatusFilter)
    : listings;

  const syncStatuses = ['not_synced', 'syncing', 'synced', 'failed'];

  const getSyncStatusLabel = (syncStatus: string) => {
    const labels: { [key: string]: string } = {
      not_synced: 'Not synced',
      syncing: 'Syncing',
      synced: 'Published',
      failed: 'Failed',
    };
    return labels[syncStatus] || syncStatus;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Listings"
        description="Manage your marketplace listings"
        action={
          <Link href="/dashboard/listings/new">
            <DashboardButton variant="primary">
              <Plus className="w-4 h-4" />
              Create Listing
            </DashboardButton>
          </Link>
        }
      />

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <DashboardButton
          variant={syncStatusFilter === '' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setSyncStatusFilter('')}
        >
          All
        </DashboardButton>
        {syncStatuses.map((s) => (
          <DashboardButton
            key={s}
            variant={syncStatusFilter === s ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setSyncStatusFilter(s)}
          >
            {getSyncStatusLabel(s)}
          </DashboardButton>
        ))}
      </div>

      {/* Listings Table */}
      <DashboardCard>
        <DashboardCardHeader>
          <DashboardCardTitle>Your Listings ({visibleListings.length})</DashboardCardTitle>
        </DashboardCardHeader>
        <DashboardCardContent>
          {(() => {
            const pageState = getListPageState(workspaceReadiness, loading, apiError, visibleListings.length);

            if (pageState === 'error') {
              const isWorkspaceError = workspaceReadiness.status === 'error';
              return (
                <DashboardErrorState
                  message={isWorkspaceError ? workspaceReadiness.message : apiError || 'Failed to load listings.'}
                  onRetry={isWorkspaceError ? () => window.location.reload() : fetchListings}
                />
              );
            }

            if (pageState === 'loading') {
              return <DashboardLoadingState message="Loading listings..." />;
            }

            if (pageState === 'empty') {
              return <DashboardEmptyState title="No listings yet" description="Create one to get started." />;
            }

            return (
            <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left py-3 pr-4 font-medium text-gray-500">Title</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Marketplace</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Price</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Created</th>
                    <th className="text-left py-3 pl-4 font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleListings.map((listing) => (
                    <tr key={listing.id} className="border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 pr-4 text-white font-medium">{listing.title}</td>
                      <td className="py-3 px-4 text-gray-400">
                        {listing.connection?.marketplace?.displayName || 'N/A'}
                      </td>
                      <td className="py-3 px-4 text-gray-300">{formatCurrency(listing.price)}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={listing.syncStatus} label={getSyncStatusLabel(listing.syncStatus)} />
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-sm">
                        {formatDateTime(new Date(listing.createdAt))}
                      </td>
                      <td className="py-3 pl-4">
                        <div className="flex gap-1">
                          <Link href={`/dashboard/listings/${listing.id}`}>
                            <button className="p-1.5 hover:bg-white/[0.06] rounded-full transition-colors">
                              <Eye className="w-4 h-4 text-gray-400" />
                            </button>
                          </Link>
                          <button className="p-1.5 hover:bg-white/[0.06] rounded-full transition-colors">
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
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
