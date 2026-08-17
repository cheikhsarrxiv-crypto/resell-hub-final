'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { ArrowLeft, AlertCircle, CheckCircle, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { LoadingState } from '@/components/StateComponents';

interface Product {
  id: string;
  title: string;
  sku: string;
  sellingPrice: number;
  quantity: number;
}

interface MarketplaceConnection {
  id: string;
  marketplaceId: string;
  status: string;
  marketplace: {
    name: string;
    displayName: string;
  };
}

function NewListingForm() {
  const searchParams = useSearchParams();
  const preselectedProductId = searchParams.get('productId');
  const { workspaceId, isReady } = useWorkspace();

  const [products, setProducts] = useState<Product[]>([]);
  const [connections, setConnections] = useState<MarketplaceConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [selectedMarketplaceIds, setSelectedMarketplaceIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');

  useEffect(() => {
    if (!isReady) return;
    fetchFormData();
  }, [isReady, workspaceId]);

  const fetchFormData = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [productsRes, connectionsRes] = await Promise.all([
        fetch(`/api/products?workspaceId=${workspaceId}`),
        fetch(`/api/marketplace/connections?workspaceId=${workspaceId}`),
      ]);

      const productsData = await productsRes.json();
      const connectionsData = await connectionsRes.json();

      if (productsData.success) {
        setProducts(productsData.products);
        if (preselectedProductId) {
          const match = productsData.products.find((p: Product) => p.id === preselectedProductId);
          if (match) {
            setProductId(match.id);
            setTitle(match.title);
            setPrice(match.sellingPrice.toString());
            setQuantity(match.quantity.toString());
          }
        }
      }
      if (connectionsData.success) setConnections(connectionsData.connections);
    } catch (err) {
      console.error('Failed to load form data:', err);
      setError('Failed to load products or marketplace connections');
    } finally {
      setLoading(false);
    }
  };

  const connectedMarketplaces = connections.filter((c) => c.status === 'connected');

  const handleProductChange = (id: string) => {
    setProductId(id);
    const product = products.find((p) => p.id === id);
    if (product) {
      setTitle(product.title);
      setPrice(product.sellingPrice.toString());
      setQuantity(product.quantity.toString());
    }
  };

  const toggleMarketplace = (marketplaceId: string) => {
    setSelectedMarketplaceIds((prev) =>
      prev.includes(marketplaceId)
        ? prev.filter((id) => id !== marketplaceId)
        : [...prev, marketplaceId]
    );
  };

  const [publishedListing, setPublishedListing] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;
    setError(null);

    if (!productId) {
      setError('Please select a product');
      return;
    }
    if (selectedMarketplaceIds.length === 0) {
      setError('Please select at least one marketplace');
      return;
    }
    if (description.trim().length < 20) {
      setError('Description must be at least 20 characters');
      return;
    }
    if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
      setError('Price must be a valid positive number');
      return;
    }
    if (!quantity || isNaN(parseInt(quantity)) || parseInt(quantity) < 1) {
      setError('Quantity must be a valid number of at least 1');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/listings?workspaceId=${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          marketplaceIds: selectedMarketplaceIds,
          title,
          description,
          price: parseFloat(price),
          quantity: parseInt(quantity),
          fulfillmentType: 'self',
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // The API can return success:true even when the marketplace publish
        // itself failed (per-marketplace errors are caught individually).
        // Check the real syncStatus of the created listing before showing
        // a success confirmation.
        const created = Array.isArray(data.listing) ? data.listing[0] : data.listing;
        if (created?.syncStatus === 'synced') {
          setPublishedListing(created);
        } else {
          setError(created?.syncError || 'Failed to publish listing. Please try again.');
        }
      } else {
        setError(data.error || 'Failed to create listing');
      }
    } catch (err) {
      console.error('Failed to create listing:', err);
      setError('An error occurred while creating the listing');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isReady || loading) {
    return <LoadingState message="Loading..." />;
  }

  const stepProductDone = !!productId;
  const stepMarketplaceDone = selectedMarketplaceIds.length > 0;
  const stepDetailsDone =
    stepMarketplaceDone &&
    title.trim().length > 0 &&
    description.trim().length >= 20 &&
    !!price &&
    !isNaN(parseFloat(price)) &&
    !!quantity &&
    !isNaN(parseInt(quantity));

  const steps = [
    { label: 'Product', done: stepProductDone },
    { label: 'Marketplace', done: stepMarketplaceDone },
    { label: 'Details', done: stepDetailsDone },
    { label: 'Publish', done: false },
  ];
  const activeStepIndex = steps.findIndex((s) => !s.done);

  if (publishedListing) {
    const publishedProduct = products.find((p) => p.id === productId);
    const publishedMarketplace = connectedMarketplaces.find((c) =>
      selectedMarketplaceIds.includes(c.marketplaceId)
    );

    return (
      <div className="max-w-2xl mx-auto px-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              Listing published successfully
            </h2>
            <p className="text-gray-600 mb-6">
              {publishedProduct?.title || 'Your product'} is now live on{' '}
              {publishedMarketplace?.marketplace.displayName || 'eBay'}.
            </p>

            <div className="bg-gray-50 rounded-lg p-4 text-left mb-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Product</span>
                <span className="font-medium text-gray-900">{publishedProduct?.title || '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Marketplace</span>
                <span className="font-medium text-gray-900">
                  {publishedMarketplace?.marketplace.displayName || 'eBay'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Status</span>
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Published
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link href={`/dashboard/listings/${publishedListing.id}`} className="flex-1">
                <Button variant="primary" className="w-full">
                  View Listing
                </Button>
              </Link>
              <Link href="/dashboard/listings/new" className="flex-1">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setPublishedListing(null);
                    setProductId('');
                    setSelectedMarketplaceIds([]);
                    setTitle('');
                    setDescription('');
                    setPrice('');
                    setQuantity('');
                  }}
                >
                  Create Another Listing
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/dashboard/listings">
          <button className="text-[#FF5A1F] hover:text-[#e64f18] flex items-center gap-1 text-sm sm:text-base">
            <ArrowLeft className="w-4 h-4" />
            Back to Listings
          </button>
        </Link>
      </div>

      {/* Step indicator — reflects real form state, not a fixed script */}
      <div className="flex items-center justify-between mb-8">
        {steps.map((step, index) => {
          const isDone = step.done;
          const isActive = !isDone && index === activeStepIndex;
          return (
            <div key={step.label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold flex-shrink-0 ${
                    isDone
                      ? 'bg-[#FF5A1F] text-white'
                      : isActive
                      ? 'bg-[#14161A] text-white'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {isDone ? <Check className="w-4 h-4" /> : index + 1}
                </div>
                <span
                  className={`text-[10px] sm:text-xs font-medium whitespace-nowrap ${
                    isDone || isActive ? 'text-[#14161A]' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-px mx-1.5 sm:mx-2 mt-[-16px] ${
                    steps[index + 1].done || steps[index].done ? 'bg-[#FF5A1F]' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create New Listing</CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-4">You need at least one product before creating a listing.</p>
              <Link href="/dashboard/products/new">
                <Button variant="primary">Create a Product First</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Product selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Product <span className="text-red-600">*</span>
                </label>
                <select
                  value={productId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Select a product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title} — {formatCurrency(product.sellingPrice)} ({product.quantity} in stock)
                    </option>
                  ))}
                </select>
              </div>

              {/* Marketplace selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Marketplace <span className="text-red-600">*</span>
                </label>
                {connectedMarketplaces.length === 0 ? (
                  <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-sm">
                    No marketplace connected yet.{' '}
                    <Link href="/dashboard/settings/integrations" className="underline font-medium">
                      Connect eBay in Settings
                    </Link>{' '}
                    before creating a listing.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {connectedMarketplaces.map((conn) => (
                      <label
                        key={conn.id}
                        className="flex items-center gap-3 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMarketplaceIds.includes(conn.marketplaceId)}
                          onChange={() => toggleMarketplace(conn.marketplaceId)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-medium text-gray-900">{conn.marketplace.displayName}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Listing Title <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  minLength={5}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Nike Air Max 95 - Size 42 - Excellent Condition"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description <span className="text-red-600">*</span>
                </label>
                <textarea
                  required
                  minLength={20}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Describe the item's condition, features, and any relevant details (min. 20 characters)..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Price (€) <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="89.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Quantity <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="1"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-6 flex-col-reverse sm:flex-row">
                <Link href="/dashboard/listings" className="flex-1">
                  <Button variant="outline" className="w-full" type="button">
                    Cancel
                  </Button>
                </Link>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={submitting || connectedMarketplaces.length === 0}
                  className="flex-1"
                >
                  {submitting ? 'Publishing...' : 'Publish Listing'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewListingPage() {
  return (
    <Suspense fallback={<LoadingState message="Loading..." />}>
      <NewListingForm />
    </Suspense>
  );
}
