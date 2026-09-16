'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ETSY_WHEN_MADE_OPTIONS } from '@/services/marketplace/EtsyListingMapper';

interface EtsyTaxonomyNode {
  id: number;
  fullPath: string;
}

export default function NewProductPage() {
  const router = useRouter();
  const { workspaceId, isReady } = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    purchasePrice: '',
    sellingPrice: '',
    quantity: '',
    category: '',
    etsyTaxonomyId: '',
    etsyWhenMade: '',
  });
  const [etsyTaxonomyNodes, setEtsyTaxonomyNodes] = useState<EtsyTaxonomyNode[]>([]);

  useEffect(() => {
    fetch('/api/etsy/taxonomy')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setEtsyTaxonomyNodes(data.nodes);
      })
      .catch(() => {
        // Non-fatal: the product can still be created and edited later
        // once the Etsy category list is available.
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;

    // Validation
    if (!formData.title.trim()) {
      setFormError('Product title is required.');
      return;
    }
    if (!formData.purchasePrice || isNaN(parseFloat(formData.purchasePrice))) {
      setFormError('Purchase price must be a valid number.');
      return;
    }
    if (!formData.sellingPrice || isNaN(parseFloat(formData.sellingPrice))) {
      setFormError('Selling price must be a valid number.');
      return;
    }
    if (!formData.quantity || isNaN(parseInt(formData.quantity))) {
      setFormError('Quantity must be a valid number.');
      return;
    }
    setFormError(null);
    setLoading(true);
    try {
      const response = await fetch(`/api/products?workspaceId=${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description.trim() || undefined,
          purchasePrice: parseFloat(formData.purchasePrice),
          sellingPrice: parseFloat(formData.sellingPrice),
          quantity: parseInt(formData.quantity),
          category: formData.category,
          etsyTaxonomyId: formData.etsyTaxonomyId ? parseInt(formData.etsyTaxonomyId) : undefined,
          etsyWhenMade: formData.etsyWhenMade || undefined,
          // SKU will be auto-generated on server
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Redirect to images page to upload photos
        router.push(`/dashboard/products/${data.product.id}/images`);
      } else {
        const error = await response.json();
        setFormError(error.error || 'Failed to create product.');
      }
    } catch (error) {
      console.error('Error:', error);
      setFormError('An error occurred while creating the product.');
    } finally {
      setLoading(false);
    }
  };

  if (!isReady) {
    return <div className="text-center py-12">Loading...</div>;
  }

  const purchasePriceNum = parseFloat(formData.purchasePrice);
  const sellingPriceNum = parseFloat(formData.sellingPrice);
  const hasValidPrices =
    !isNaN(purchasePriceNum) && purchasePriceNum > 0 && !isNaN(sellingPriceNum);
  const previewProfit = hasValidPrices ? sellingPriceNum - purchasePriceNum : 0;
  const previewMargin = hasValidPrices ? (previewProfit / purchasePriceNum) * 100 : 0;

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="mb-6 flex items-center gap-2">
        <Link href="/dashboard/products">
          <button className="text-[#FF5A1F] hover:text-[#e64f18] flex items-center gap-1 text-sm sm:text-base">
            <ArrowLeft className="w-4 h-4" />
            Back to Products
          </button>
        </Link>
      </div>

      {/* Journey indicator — this page redirects to the images step on submit */}
      <div className="flex items-center gap-2 mb-6 text-xs sm:text-sm">
        <span className="flex items-center gap-1.5 font-medium text-[#14161A]">
          <span className="w-5 h-5 rounded-full bg-[#FF5A1F] text-white flex items-center justify-center text-[11px] font-semibold">1</span>
          Product Info
        </span>
        <span className="flex-1 h-px bg-gray-200" />
        <span className="flex items-center gap-1.5 text-gray-400">
          <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[11px] font-semibold">2</span>
          Photos
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create New Product</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Product Title <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Nike Air Max 95"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Describe the product..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Purchase Price (€) <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formData.purchasePrice}
                  onChange={(e) =>
                    setFormData({ ...formData, purchasePrice: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="40.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Selling Price (€) <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formData.sellingPrice}
                  onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="120.00"
                />
              </div>
            </div>

            {hasValidPrices && (
              <div className="bg-[#F7F6F2] border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-gray-600">Estimated profit / margin</span>
                <span className={`text-sm font-semibold ${previewProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  €{previewProfit.toFixed(2)} · {previewMargin.toFixed(1)}%
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantity in Stock <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  required
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select category</option>
                  <option value="fashion">Fashion</option>
                  <option value="electronics">Electronics</option>
                  <option value="home">Home</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Etsy details</h3>
              <p className="text-xs text-gray-500 mb-4">
                Only needed if you plan to publish this product to Etsy. Etsy requires a real
                category and a "when made" era for every listing — leave these blank if you only
                sell on eBay.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Etsy category
                  </label>
                  <select
                    value={formData.etsyTaxonomyId}
                    onChange={(e) => setFormData({ ...formData, etsyTaxonomyId: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">
                      {etsyTaxonomyNodes.length === 0 ? 'No Etsy categories loaded yet' : 'Select Etsy category'}
                    </option>
                    {etsyTaxonomyNodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.fullPath}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    When was it made?
                  </label>
                  <select
                    value={formData.etsyWhenMade}
                    onChange={(e) => setFormData({ ...formData, etsyWhenMade: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select when made</option>
                    {ETSY_WHEN_MADE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div className="flex gap-4 pt-6 flex-col-reverse sm:flex-row">
              <Link href="/dashboard/products" className="flex-1">
                <Button variant="outline" className="w-full">
                  Cancel
                </Button>
              </Link>
              <Button variant="primary" type="submit" disabled={loading} className="flex-1">
                {loading ? 'Creating...' : 'Create Product'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
