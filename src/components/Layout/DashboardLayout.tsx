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
  Sparkles,
  Zap,
  Package,
  ShoppingBag,
} from 'lucide-react';
import { DashboardSidebar, type NavItem } from '@/components/dashboard/DashboardSidebar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { DashboardBottomNav } from '@/components/dashboard/DashboardBottomNav';
import { AiChatWidget } from '@/components/dashboard/AiChatWidget';
import { NotificationBell } from '@/components/dashboard/NotificationBell';

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

  // <main>'s own overflow-auto (below) is meant to be the dashboard's only
  // scroll container — but document.documentElement ("html", the actual
  // CSSOM "scrolling element") can still independently respond to a wheel
  // event that lands outside main (e.g. over the sidebar) or to keyboard
  // paging (End/Page Down) even when every element's own bounding box is
  // already exactly viewport-height, because a descendant's scrollable
  // overflow — even one an ancestor's own `overflow-hidden` visually
  // clips — can still inflate html's reported scrollHeight. The result:
  // the page shell (styled dark) stays put, but the few extra pixels of
  // document-level scroll room reveal the UNstyled <body> (bg-gray-50,
  // the light theme other, non-dashboard routes use) underneath it.
  // Locking body/html scroll only while this layout is mounted — never
  // globally in globals.css, which would also freeze the public/landing
  // pages that rely on real document scroll — closes that gap without
  // touching any other route.
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

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
        { name: 'Agent', href: `${baseUrl}/agent`, icon: Sparkles },
        { name: 'Products', href: `${baseUrl}/products`, icon: Package },
        { name: 'Listings', href: `${baseUrl}/listings`, icon: FileText },
        { name: 'Orders', href: `${baseUrl}/orders`, icon: ShoppingCart },
        { name: 'Fulfillment', href: `${baseUrl}/fulfillment`, icon: Zap },
        { name: 'Analytics', href: `${baseUrl}/analytics`, icon: BarChart3 },
        { name: 'Subscription', href: `${baseUrl}/subscription`, icon: Box },
        { name: 'Settings', href: `${baseUrl}/settings`, icon: Settings },
      ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#08080a]">
      <DashboardHeader onOpenMenu={() => setIsSidebarOpen(true)} />
      <NotificationBell />

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
          onClose={() => setIsSidebarOpen(false)}
        />
      </aside>

      {/* Main Content — pb-16 (mobile only) reserves room for the fixed
          DashboardBottomNav below, the same way pt-14 already reserves
          room for DashboardHeader above; md:pb-0 drops it once the
          bottom nav itself is hidden at md: and up. */}
      <main className="flex-1 min-w-0 min-h-0 overflow-auto pt-14 pb-16 md:pt-0 md:pb-0">
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>

      {/* Merchant-facing assistant only — not shown in the admin section,
          which has a different context/audience. Hidden below md: on
          purpose (mobile redesign): DashboardBottomNav's own "Agent IA"
          tab is now the mobile entry point into the Agent, and this
          floating button would otherwise collide with the fixed bottom
          nav. Desktop keeps it exactly as before. The component itself
          is untouched — only whether it's rendered here changes. */}
      {!isAdmin && (
        <div className="hidden md:block">
          <AiChatWidget />
        </div>
      )}

      {/* Mobile-only persistent navigation — see DashboardBottomNav's own
          header comment. Same isAdmin guard as AiChatWidget above: the
          admin section's navigation (Dashboard/Users/Orders/Metrics/
          Settings) has no Agent/Products routes to point to, so this
          never renders there. */}
      {!isAdmin && (
        <DashboardBottomNav pathname={pathname} baseUrl={baseUrl} onOpenMenu={() => setIsSidebarOpen(true)} />
      )}
    </div>
  );
}
