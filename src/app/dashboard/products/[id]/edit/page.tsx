'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/StateComponents';

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;
  const { workspaceId, isReady } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    purchasePrice: '',
    sellingPrice: '',
    quantity: '',
    category: '',
  });

  useEffect(() => {
    if (!isReady || !workspaceId) return;
    fetchProduct();
  }, [isReady, workspaceId, productId]);

  const fetchProduct = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/products/${productId}?workspaceId=${workspaceId}`);
      const data = await response.json();

      if (data.success) {
        const p = data.product;
        setFormData({
          title: p.title || '',
          description: p.description || '',
          purchasePrice: p.purchasePrice?.toString() || '',
          sellingPrice: p.sellingPrice?.toString() || '',
          quantity: p.quantity?.toString() || '',
          category: p.category || '',
        });
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;

    if (!formData.title.trim()) {
      alert('Product title is required');
      return;
    }
    if (!formData.purchasePrice || isNaN(parseFloat(formData.purchasePrice))) {
      alert('Purchase price must be a valid number');
      return;
    }
    if (!formData.sellingPrice || isNaN(parseFloat(formData.sellingPrice))) {
      alert('Selling price must be a valid number');
      return;
    }
    if (!formData.quantity || isNaN(parseInt(formData.quantity))) {
      alert('Quantity must be a valid number');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/products/${productId}?workspaceId=${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description,
          purchasePrice: parseFloat(formData.purchasePrice),
          sellingPrice: parseFloat(formData.sellingPrice),
          quantity: parseInt(formData.quantity),
          category: formData.category,
        }),
      });

      if (response.ok) {
        router.push(`/dashboard/products/${productId}`);
      } else {
        const err = await response.json();
        alert(`Failed to update product: ${err.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error:', err);
      alert('An error occurred while updating the product');
    } finally {
      setSaving(false);
    }
  };

  if (!isReady || loading) {
    return <LoadingState message="Loading product..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Failed to load product"
        details={error}
        onRetry={() => fetchProduct()}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="mb-6 flex items-center gap-2">
        <Link href={`/dashboard/products/${productId}`}>
          <button className="text-[#FF5A1F] hover:text-[#e64f18] flex items-center gap-1 text-sm sm:text-base">
            <ArrowLeft className="w-4 h-4" />
            Back to Product
          </button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Edit Product</CardTitle>
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

            <div className="flex gap-4 pt-6 flex-col-reverse sm:flex-row">
              <Link href={`/dashboard/products/${productId}`} className="flex-1">
                <Button variant="outline" type="button" className="w-full">
                  Cancel
                </Button>
              </Link>
              <Button variant="primary" type="submit" disabled={saving} className="flex-1">
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
