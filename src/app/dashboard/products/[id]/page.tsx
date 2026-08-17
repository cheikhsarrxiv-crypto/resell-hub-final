'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { ProductImageDisplay } from '@/components/ProductImageDisplay';
import { LoadingState, ErrorState } from '@/components/StateComponents';
import { ArrowLeft, ImageIcon, Tag } from 'lucide-react';

interface Product {
  id: string;
  title: string;
  description: string;
  purchasePrice: number;
  sellingPrice: number;
  quantity: number;
  category?: string;
  brand?: string;
  size?: string;
  color?: string;
  condition?: string;
  images?: Array<{
    id: string;
    url: string;
    isMain: boolean;
    order: number;
  }>;
  listings?: Array<{
    id: string;
    syncStatus: string;
    price: number;
    connection?: {
      marketplace?: {
        displayName: string;
      };
    } | null;
  }>;
}

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

export default function ProductDetailPage() {
  const { id: productId } = useParams();
  const { workspaceId, isReady } = useWorkspace();
  
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !workspaceId) return;
    fetchProduct();
  }, [isReady, workspaceId, productId]);

  const fetchProduct = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        `/api/products/${productId}?workspaceId=${workspaceId}`
      );
      const data = await response.json();
      
      if (data.success) {
        setProduct(data.product);
      } else {
        setError(data.error || 'Failed to load product');
      }
    } catch (err) {
      console.error('Failed to fetch product:', err);
      setError('An error occurred while loading the product');
    } finally {
      setLoading(false);
    }
  };

  if (!isReady || loading) {
    return <LoadingState message="Loading product..." />;
  }

  if (error || !product) {
    return (
      <ErrorState
        message="Failed to load product"
        details={error}
        onRetry={fetchProduct}
      />
    );
  }

  const profit = product.sellingPrice - product.purchasePrice;
  const marginValue = product.purchasePrice > 0 ? (profit / product.purchasePrice) * 100 : 0;
  const margin = marginValue.toFixed(1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/products">
            <button className="text-[#FF5A1F] hover:text-[#e64f18] flex items-center gap-1">
              <ArrowLeft className="w-4 h-4" />
              Back to Products
            </button>
          </Link>
        </div>
        <div className="flex gap-2">
          <Link href={`/dashboard/products/${productId}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
          <Link href={`/dashboard/products/${productId}/images`}>
            <Button className="gap-2">
              <ImageIcon className="w-4 h-4" />
              Manage Images
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Images - Left */}
        <div className="md:col-span-1">
          <ProductImageDisplay
            images={product.images || []}
            productName={product.title}
          />
        </div>

        {/* Details - Right */}
        <div className="md:col-span-2 space-y-4">
          {/* Title & Description */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">{product.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-gray-600">
              {product.description && (
                <p className="whitespace-pre-wrap">{product.description}</p>
              )}
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pricing & Profit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Purchase Price</p>
                  <p className="text-xl font-bold">€{product.purchasePrice.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Selling Price</p>
                  <p className="text-xl font-bold text-green-600">€{product.sellingPrice.toFixed(2)}</p>
                </div>
              </div>
              <div className="border-t pt-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Profit</p>
                    <p className={`text-lg font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      €{profit.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Margin</p>
                    <p className={`text-lg font-bold ${marginValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {margin}%
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Inventory */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Inventory</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-8">
                <div>
                  <p className="text-sm text-gray-600">Quantity</p>
                  <p className="text-2xl font-bold">{product.quantity}</p>
                </div>
                <div className="flex-1">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-[#FF5A1F] h-2 rounded-full"
                      style={{
                        width: `${Math.min(100, (product.quantity / 100) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Listing */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Listing</CardTitle>
            </CardHeader>
            <CardContent>
              {product.listings && product.listings.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm text-gray-600">
                        {product.listings[0].connection?.marketplace?.displayName || 'Marketplace'}
                      </p>
                      <span
                        className={`inline-flex mt-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                          SYNC_STATUS_COLORS[product.listings[0].syncStatus] || 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {SYNC_STATUS_LABELS[product.listings[0].syncStatus] || product.listings[0].syncStatus}
                      </span>
                    </div>
                    <Link href={`/dashboard/listings/${product.listings[0].id}`}>
                      <Button variant="outline" size="sm">
                        View Listing
                      </Button>
                    </Link>
                  </div>
                  <Link href={`/dashboard/listings/new?productId=${productId}`}>
                    <Button variant="outline" className="w-full sm:w-auto gap-2">
                      <Tag className="w-4 h-4" />
                      Create Another Listing
                    </Button>
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-600 mb-3">
                    This product isn&apos;t listed on any marketplace yet.
                  </p>
                  <Link href={`/dashboard/listings/new?productId=${productId}`}>
                    <Button variant="primary" className="gap-2">
                      <Tag className="w-4 h-4" />
                      Create Listing
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Details */}
          {(product.category ||
            product.brand ||
            product.size ||
            product.color ||
            product.condition) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                {product.category && (
                  <div>
                    <p className="text-sm text-gray-600">Category</p>
                    <p className="font-medium">{product.category}</p>
                  </div>
                )}
                {product.brand && (
                  <div>
                    <p className="text-sm text-gray-600">Brand</p>
                    <p className="font-medium">{product.brand}</p>
                  </div>
                )}
                {product.size && (
                  <div>
                    <p className="text-sm text-gray-600">Size</p>
                    <p className="font-medium">{product.size}</p>
                  </div>
                )}
                {product.color && (
                  <div>
                    <p className="text-sm text-gray-600">Color</p>
                    <p className="font-medium">{product.color}</p>
                  </div>
                )}
                {product.condition && (
                  <div>
                    <p className="text-sm text-gray-600">Condition</p>
                    <p className="font-medium capitalize">{product.condition}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
