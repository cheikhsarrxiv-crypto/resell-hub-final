'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Box,
  FileText,
  Home,
  Settings,
  ShoppingCart,
  Zap,
  Package,
  ShoppingBag,
} from 'lucide-react';
import { DashboardSidebar, type NavItem } from '@/components/dashboard/DashboardSidebar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';

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

  const navigation: NavItem[] = isAdmin
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
    <div className="flex h-screen bg-[#08080a]">
      <DashboardHeader onOpenMenu={() => setIsSidebarOpen(true)} />

      {/* Backdrop — only rendered while the mobile drawer is open, and
          only relevant below md: (the sidebar is never off-canvas at
          md: and up, so isSidebarOpen has no effect there). */}
      {isSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
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
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#0a0a0c] border-r border-white/[0.06] transform transition-transform duration-200 ease-in-out md:relative md:z-auto md:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <DashboardSidebar
          navigation={navigation}
          pathname={pathname}
          isAdmin={isAdmin}
          onNavigate={() => setIsSidebarOpen(false)}
        />
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 overflow-auto pt-14 md:pt-0">
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
