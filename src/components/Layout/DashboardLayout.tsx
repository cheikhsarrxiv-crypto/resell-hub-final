'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Box,
  FileText,
  Home,
  LogOut,
  Menu,
  Settings,
  ShoppingCart,
  X,
  Zap,
  Package,
  ShoppingBag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOutAction } from '@/app/actions/auth';

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Close the mobile drawer automatically on navigation, so tapping a
  // nav link doesn't leave it open over the new page.
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

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
      {/* Mobile top bar — hidden on desktop (md:hidden). Gives mobile
          portrait users a way to open the drawer sidebar below, since
          the sidebar itself is off-canvas by default there. */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 h-14 flex items-center justify-between bg-white border-b border-gray-200 px-4">
        <button
          type="button"
          onClick={() => setIsSidebarOpen(true)}
          aria-label="Open menu"
          aria-expanded={isSidebarOpen}
          className="p-2 -ml-2 text-gray-700"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 72 72" className="flex-shrink-0">
            <circle cx="36" cy="36" r="32" fill="none" stroke="#FF5A1F" strokeWidth="6" />
            <path d="M24 48 L36 22 L48 48 M29 39 H43" stroke="#14161A" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <span className="text-base font-bold text-[#14161A] tracking-tight">ADKSY</span>
        </div>
        {/* Spacer matching the hamburger button's width, so the logo above stays visually centered */}
        <div className="w-10" aria-hidden="true" />
      </div>

      {/* Backdrop — only rendered while the mobile drawer is open, and
          only relevant below md: (the sidebar is never off-canvas at
          md: and up, so isSidebarOpen has no effect there). */}
      {isSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — an off-canvas drawer on mobile (fixed + translated
          out of view, slides in over the content) that becomes the
          original always-visible, in-flow desktop sidebar at md: and
          up (md:relative cancels the fixed positioning, md:translate-x-0
          overrides the drawer's open/closed state unconditionally). */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 overflow-y-auto transform transition-transform duration-200 ease-in-out',
          'md:relative md:z-auto md:translate-x-0',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-6 border-b border-gray-200 flex items-start justify-between md:block">
          <div>
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
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close menu"
            className="md:hidden p-1 -mr-2 -mt-1 text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
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
          <form action={signOutAction} className="w-full">
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
      <main className="flex-1 min-w-0 overflow-auto pt-14 md:pt-0">
        <div className="p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
