'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';
import { Plus, Package } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { LoadingState, ErrorState, EmptyState } from '@/components/StateComponents';

export default function ProductsPage() {
  const { workspaceId, isReady } = useWorkspace();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady) return;
    fetchProducts();
  }, [isReady, workspaceId]);

  const fetchProducts = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/products?workspaceId=${workspaceId}`);
      const data = await response.json();
      if (data.success) {
        setProducts(data.products);
      } else {
        setError(data.error || 'Failed to load products');
      }
    } catch (err) {
      console.error('Failed to fetch products:', err);
      setError('An error occurred while loading products');
    } finally {
      setLoading(false);
    }
  };

  if (!isReady || loading) {
    return <LoadingState message="Loading products..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-col sm:flex-row gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-[#14161A]">Products</h1>
          <p className="text-gray-600 mt-1">Manage your product catalog</p>
        </div>
        <Link href="/dashboard/products/new">
          <Button variant="primary" size="lg">
            <Plus className="w-5 h-5 mr-2" />
            Add Product
          </Button>
        </Link>
      </div>

      {error && (
        <ErrorState
          message="Failed to load products"
          details={error || undefined}
          onRetry={() => fetchProducts()}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Your Products ({products.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <EmptyState
              title="No products yet"
              description="Create your first product to get started selling"
              icon={<Package className="w-12 h-12 text-gray-300 mb-4" />}
              action={
                <Link href="/dashboard/products/new">
                  <Button variant="primary">Create First Product</Button>
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 sm:px-6 py-3 font-semibold text-gray-900 text-left">Title</th>
                    <th className="px-4 sm:px-6 py-3 font-semibold text-gray-900 text-left hidden md:table-cell">SKU</th>
                    <th className="px-4 sm:px-6 py-3 font-semibold text-gray-900 text-right">Price</th>
                    <th className="px-4 sm:px-6 py-3 font-semibold text-gray-900 text-right hidden sm:table-cell">Stock</th>
                    <th className="px-4 sm:px-6 py-3 font-semibold text-gray-900 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 sm:px-6 py-4 font-medium">{product.title}</td>
                      <td className="px-4 sm:px-6 py-4 hidden md:table-cell text-xs font-mono text-gray-600">
                        {product.sku}
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-right">{formatCurrency(product.sellingPrice)}</td>
                      <td className="px-4 sm:px-6 py-4 text-right hidden sm:table-cell">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          product.quantity > 0
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {product.quantity}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-right text-green-600 font-semibold">
                        {formatCurrency(product.sellingPrice - product.purchasePrice - (product.fulfillmentCost || 0))}
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
