'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Badge } from '@/components/UI/Button';
import Link from 'next/link';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { Plus, Eye, Trash2 } from 'lucide-react';

export default function ListingsPage() {
  const { workspaceId, isReady } = useWorkspace();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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

    try {
      const response = await fetch(`/api/listings?workspaceId=${workspaceId}`);
      const data = await response.json();
      if (data.success) {
        setListings(data.listings);
      }
    } catch (error) {
      console.error('Failed to fetch listings:', error);
    } finally {
      setLoading(false);
    }
  };

  const visibleListings = syncStatusFilter
    ? listings.filter((l) => l.syncStatus === syncStatusFilter)
    : listings;

  const syncStatuses = ['not_synced', 'syncing', 'synced', 'failed'];

  const getSyncStatusBadge = (syncStatus: string) => {
    const colors: { [key: string]: string } = {
      not_synced: 'bg-gray-100 text-gray-800',
      syncing: 'bg-yellow-100 text-yellow-800',
      synced: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };
    return colors[syncStatus] || 'bg-gray-100 text-gray-800';
  };

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
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold font-display text-[#14161A]">Listings</h1>
          <p className="text-gray-600 mt-1">Manage your marketplace listings</p>
        </div>
        <Link href="/dashboard/listings/new">
          <Button variant="primary" size="lg">
            <Plus className="w-5 h-5 mr-2" />
            Create Listing
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={syncStatusFilter === '' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setSyncStatusFilter('')}
        >
          All
        </Button>
        {syncStatuses.map((s) => (
          <Button
            key={s}
            variant={syncStatusFilter === s ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setSyncStatusFilter(s)}
          >
            {getSyncStatusLabel(s)}
          </Button>
        ))}
      </div>

      {/* Listings Table */}
      <Card>
        <CardHeader>
          <CardTitle>Your Listings ({visibleListings.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : visibleListings.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No listings yet. Create one to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Title</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Marketplace</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Price</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Status</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Created</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleListings.map((listing) => (
                    <tr key={listing.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 text-gray-900 font-medium">{listing.title}</td>
                      <td className="py-3 px-4 text-gray-600">
                        {listing.connection?.marketplace?.displayName || 'N/A'}
                      </td>
                      <td className="py-3 px-4 text-gray-900">{formatCurrency(listing.price)}</td>
                      <td className="py-3 px-4">
                        <Badge className={getSyncStatusBadge(listing.syncStatus)}>
                          {getSyncStatusLabel(listing.syncStatus)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-gray-600 text-sm">
                        {formatDateTime(listing.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-2">
                          <Link href={`/dashboard/listings/${listing.id}`}>
                            <button className="p-1 hover:bg-gray-100 rounded">
                              <Eye className="w-4 h-4 text-gray-600" />
                            </button>
                          </Link>
                          <button className="p-1 hover:bg-gray-100 rounded">
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </button>
                        </div>
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
