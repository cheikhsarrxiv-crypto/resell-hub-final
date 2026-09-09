'use client';

import { Menu } from 'lucide-react';

interface DashboardHeaderProps {
  onOpenMenu: () => void;
}

/**
 * Mobile-only top bar (hidden at md: and up — the sidebar is always
 * visible there, so per-page PageHeader already carries page context on
 * desktop without a redundant second header chrome).
 */
export function DashboardHeader({ onOpenMenu }: DashboardHeaderProps) {
  return (
    <div className="md:hidden fixed top-0 inset-x-0 z-30 h-14 flex items-center justify-between bg-[#0a0a0c]/90 backdrop-blur-md border-b border-white/[0.06] px-4">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="p-2 -ml-2 text-gray-300"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 18 L12 5 L20 18 M7.5 13.5 H16.5"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <span className="text-sm font-semibold text-white tracking-tight">ADKSY</span>
      </div>
      <div className="w-9" aria-hidden="true" />
    </div>
  );
}
