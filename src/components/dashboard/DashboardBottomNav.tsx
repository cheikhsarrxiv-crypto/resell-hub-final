'use client';

import Link from 'next/link';
import { Home, Sparkles, Package, ShoppingCart, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DashboardBottomNavProps {
  pathname: string;
  /** Same convention as DashboardLayout's own `baseUrl` (e.g. '/dashboard') — routes are built from it, never hardcoded. */
  baseUrl: string;
  onOpenMenu: () => void;
}

/**
 * Mobile-only persistent bottom navigation (hidden at md: and up, where
 * the existing DashboardSidebar is always visible — same breakpoint
 * convention as DashboardHeader). 4 real routes + a "Menu" button that
 * opens the EXISTING mobile drawer (DashboardSidebar via
 * DashboardLayout's own isSidebarOpen state) — this is not a second
 * navigation system, just another entry point into the same one.
 *
 * Active-state matching mirrors DashboardSidebar's own `pathname ===
 * item.href` (exact match, not startsWith) — deliberately identical
 * convention so the two navigations never disagree about what counts as
 * "active" for the same route.
 */
export function DashboardBottomNav({ pathname, baseUrl, onOpenMenu }: DashboardBottomNavProps) {
  const items = [
    { name: 'Accueil', href: baseUrl, icon: Home },
    { name: 'Agent IA', href: `${baseUrl}/agent`, icon: Sparkles },
    { name: 'Produits', href: `${baseUrl}/products`, icon: Package },
    { name: 'Commandes', href: `${baseUrl}/orders`, icon: ShoppingCart },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[#0a0a0c]/95 backdrop-blur-md border-t border-white/[0.06] pb-[calc(0.375rem+env(safe-area-inset-bottom))]"
      aria-label="Navigation principale"
    >
      <div className="flex items-stretch justify-around">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center gap-1 flex-1 min-w-0 pt-2.5 pb-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60 rounded-lg',
                isActive ? 'text-[#FF5A1F]' : 'text-gray-500'
              )}
            >
              <Icon className={cn('w-5 h-5 shrink-0', isActive ? 'text-[#FF5A1F]' : 'text-gray-500')} />
              <span className="truncate max-w-full">{item.name}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Ouvrir le menu"
          className="flex flex-col items-center justify-center gap-1 flex-1 min-w-0 pt-2.5 pb-1.5 text-[11px] font-medium text-gray-500 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60 rounded-lg"
        >
          <Menu className="w-5 h-5 shrink-0 text-gray-500" />
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
}

export default DashboardBottomNav;
