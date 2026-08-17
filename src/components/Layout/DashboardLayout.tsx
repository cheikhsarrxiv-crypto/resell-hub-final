'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Box,
  FileText,
  Home,
  LogOut,
  Settings,
  ShoppingCart,
  Zap,
  Package,
  ShoppingBag,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DashboardLayoutProps {
  children: React.ReactNode;
  workspaceSlug: string;
  isAdmin?: boolean;
  baseUrl?: string;
}

export function DashboardLayout({
  children,
  workspaceSlug,
  isAdmin = false,
  baseUrl: baseUrlOverride,
}: DashboardLayoutProps) {
  const pathname = usePathname();

  const baseUrl = baseUrlOverride ?? (isAdmin ? '/admin' : `/workspace/${workspaceSlug}`);

  const navigation = isAdmin
    ? [
        { name: 'Dashboard', href: '/admin', icon: Home },
        { name: 'Users', href: '/admin/users', icon: ShoppingBag },
        { name: 'Orders', href: '/admin/orders', icon: ShoppingCart },
        { name: 'Metrics', href: '/admin/metrics', icon: BarChart3 },
        { name: 'Settings', href: '/admin/settings', icon: Settings },
      ]
    : [
        { name: 'Dashboard', href: `${baseUrl}`, icon: Home },
        { name: 'Products', href: `${baseUrl}/products`, icon: Package },
        { name: 'Listings', href: `${baseUrl}/listings`, icon: FileText },
        { name: 'Orders', href: `${baseUrl}/orders`, icon: ShoppingCart },
        { name: 'Fulfillment', href: `${baseUrl}/fulfillment`, icon: Zap },
        { name: 'Analytics', href: `${baseUrl}/analytics`, icon: BarChart3 },
        { name: 'Subscription', href: `${baseUrl}/subscription`, icon: Box },
        { name: 'Settings', href: `${baseUrl}/settings`, icon: Settings },
      ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 72 72" className="flex-shrink-0">
              <circle cx="36" cy="36" r="32" fill="none" stroke="#FF5A1F" strokeWidth="6" />
              <path d="M24 48 L36 22 L48 48 M29 39 H43" stroke="#14161A" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <h2 className="text-lg font-bold text-[#14161A] tracking-tight">ADKSY</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {isAdmin ? 'Admin Panel' : 'Seller Dashboard'}
          </p>
        </div>

        <nav className="p-4 space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  isActive
                    ? 'bg-[#FF5A1F]/10 text-[#FF5A1F]'
                    : 'text-gray-700 hover:bg-gray-50'
                )}
              >
                <Icon className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 bg-white">
          <form
            action="/api/auth/signout"
            method="POST"
            className="w-full"
          >
            <button
              type="submit"
              className="w-full flex items-center px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5 mr-3" />
              Sign Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
