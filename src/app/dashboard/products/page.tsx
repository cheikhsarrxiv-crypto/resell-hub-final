'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/hooks';
import { DashboardCard, DashboardCardContent, DashboardCardHeader, DashboardCardTitle } from '@/components/dashboard/DashboardCard';
import { DashboardButton } from '@/components/dashboard/DashboardButton';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { DashboardLoadingState, DashboardErrorState, DashboardEmptyState } from '@/components/dashboard/DashboardStates';
import { Plus, Package, Search } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export default function ProductsPage() {
  const { workspaceId, isReady } = useWorkspace();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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

  const visibleProducts = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.trim().toLowerCase();
    return products.filter((p) => p.title?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q));
  }, [products, search]);

  if (!isReady || loading) {
    return <DashboardLoadingState message="Loading products..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Manage your product catalog"
        action={
          <Link href="/dashboard/products/new">
            <DashboardButton variant="primary">
              <Plus className="w-4 h-4" />
              Add Product
            </DashboardButton>
          </Link>
        }
      />

      {error && (
        <DashboardErrorState message="Failed to load products" details={error || undefined} onRetry={() => fetchProducts()} />
      )}

      <DashboardCard>
        <DashboardCardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <DashboardCardTitle>Your Products ({visibleProducts.length})</DashboardCardTitle>
          {products.length > 0 && (
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#FF5A1F]/50 focus:border-[#FF5A1F]/50"
              />
            </div>
          )}
        </DashboardCardHeader>
        <DashboardCardContent>
          {products.length === 0 ? (
            <DashboardEmptyState
              title="No products yet"
              description="Create your first product to get started selling"
              icon={<Package className="w-10 h-10 text-gray-700 mb-4" />}
              action={
                <Link href="/dashboard/products/new">
                  <DashboardButton variant="primary">Create First Product</DashboardButton>
                </Link>
              }
            />
          ) : visibleProducts.length === 0 ? (
            <DashboardEmptyState title="No matches" description={`No products match "${search}"`} />
          ) : (
            <div className="overflow-x-auto -mx-5 sm:-mx-6 px-5 sm:px-6">
              <table className="w-full text-sm min-w-[420px] md:min-w-[640px]">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="py-3 pr-4 font-medium text-gray-500 text-left">Title</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-left hidden md:table-cell">SKU</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-right">Price</th>
                    <th className="py-3 px-4 font-medium text-gray-500 text-right hidden sm:table-cell">Stock</th>
                    <th className="py-3 pl-4 font-medium text-gray-500 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => (
                    <tr key={product.id} className="border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.02] transition-colors">
                      <td className="py-4 pr-4 font-medium text-white">{product.title}</td>
                      <td className="py-4 px-4 hidden md:table-cell text-xs font-mono text-gray-500">{product.sku}</td>
                      <td className="py-4 px-4 text-right text-gray-300">{formatCurrency(product.sellingPrice)}</td>
                      <td className="py-4 px-4 text-right hidden sm:table-cell">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium border ${
                            product.quantity > 0
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}
                        >
                          {product.quantity}
                        </span>
                      </td>
                      <td className="py-4 pl-4 text-right text-emerald-400 font-semibold">
                        {formatCurrency(product.sellingPrice - product.purchasePrice - (product.fulfillmentCost || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashboardCardContent>
      </DashboardCard>
    </div>
  );
}
