'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { ArrowLeft, AlertCircle, ImageIcon } from 'lucide-react';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { LoadingState, ErrorState } from '@/components/StateComponents';

const SYNC_STATUS_COLORS: Record<string, string> = {
  not_synced: 'bg-gray-100 text-gray-800',
  syncing: 'bg-yellow-100 text-yellow-800',
  synced: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const SYNC_STATUS_LABELS: Record<string, string> = {
  not_synced: 'Not synced',
  syncing: 'Syncing',
  synced: 'Published',
  failed: 'Failed',
};

export default function ListingDetailPage() {
  const params = useParams();
  const listingId = params.id as string;
  const { workspaceId, isReady } = useWorkspace();

  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !workspaceId) return;
    fetchListing();
  }, [isReady, workspaceId, listingId]);

  const fetchListing = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/listings/${listingId}?workspaceId=${workspaceId}`);
      const data = await response.json();

      if (data.success) {
        setListing(data.listing);
      } else {
        setError(data.error || 'Failed to load listing');
      }
    } catch (err) {
      console.error('Failed to fetch listing:', err);
      setError('An error occurred while loading the listing');
    } finally {
      setLoading(false);
    }
  };

  if (!isReady || loading) {
    return <LoadingState message="Loading listing..." />;
  }

  if (error || !listing) {
    return (
      <ErrorState
        message="Failed to load listing"
        details={error || undefined}
        onRetry={() => fetchListing()}
      />
    );
  }

  const mainImage =
    listing.product?.images?.find((img: any) => img.isMain) || listing.product?.images?.[0];
  const marketplaceName = listing.connection?.marketplace?.displayName || 'N/A';
  const syncStatus = listing.syncStatus as string;

  return (
    <div className="max-w-3xl mx-auto px-4">
      <div className="mb-6">
        <Link href="/dashboard/listings">
          <button className="text-[#FF5A1F] hover:text-[#e64f18] flex items-center gap-1 text-sm sm:text-base">
            <ArrowLeft className="w-4 h-4" />
            Back to Listings
          </button>
        </Link>
      </div>

      {syncStatus === 'failed' && listing.syncError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm mb-6">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{listing.syncError}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <CardTitle>{listing.title}</CardTitle>
            <span
              className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                SYNC_STATUS_COLORS[syncStatus] || 'bg-gray-100 text-gray-800'
              }`}
            >
              {SYNC_STATUS_LABELS[syncStatus] || syncStatus}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-6">
            {/* Product image */}
            <div className="w-full sm:w-[120px] h-[120px] rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
              {mainImage ? (
                <Image
                  src={mainImage.url}
                  alt={listing.product?.title || listing.title}
                  width={120}
                  height={120}
                  className="object-cover w-full h-full"
                />
              ) : (
                <ImageIcon className="w-8 h-8 text-gray-300" />
              )}
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Product</p>
                {listing.product ? (
                  <Link
                    href={`/dashboard/products/${listing.product.id}`}
                    className="text-[#FF5A1F] hover:text-[#e64f18] font-medium"
                  >
                    {listing.product.title}
                  </Link>
                ) : (
                  <p className="text-gray-900">N/A</p>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Marketplace</p>
                  <p className="text-gray-900 font-medium">{marketplaceName}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Price</p>
                  <p className="text-gray-900 font-medium">{formatCurrency(listing.price)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Quantity</p>
                  <p className="text-gray-900 font-medium">{listing.quantity}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Created</p>
                  <p className="text-gray-900 text-sm">{formatDateTime(new Date(listing.createdAt))}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">External ID</p>
                  <p className="text-gray-900 text-sm font-mono">
                    {listing.externalId || '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-100 my-6" />

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Description</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{listing.description}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
