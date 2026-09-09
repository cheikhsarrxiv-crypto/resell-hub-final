'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { LogOut, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOutAction } from '@/app/actions/auth';

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

interface DashboardSidebarProps {
  navigation: NavItem[];
  pathname: string;
  isAdmin?: boolean;
  onNavigate?: () => void;
}

function AdksyMark({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M4 18 L12 5 L20 18 M7.5 13.5 H16.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function DashboardSidebar({ navigation, pathname, isAdmin = false, onNavigate }: DashboardSidebarProps) {
  const { data: session } = useSession();

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-white">
          <AdksyMark />
        </span>
        <div>
          <p className="text-sm font-semibold text-white tracking-tight">ADKSY</p>
          <p className="text-[11px] text-gray-500">{isAdmin ? 'Admin Panel' : 'Seller Dashboard'}</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'relative flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-colors',
                isActive ? 'bg-white/[0.06] text-white' : 'text-gray-400 hover:text-white hover:bg-white/[0.03]'
              )}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-[#FF5A1F]"
                  style={{ boxShadow: '0 0 12px 1px rgba(255,90,31,0.6)' }}
                  aria-hidden="true"
                />
              )}
              <Icon className={cn('w-[18px] h-[18px] shrink-0', isActive ? 'text-[#FF5A1F]' : 'text-gray-500')} />
              <span className="truncate">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-white/[0.06] space-y-2">
        {session?.user?.email && (
          <div className="px-3 py-2">
            <p className="text-xs text-gray-600 truncate">{session.user.email}</p>
          </div>
        )}
        <form action={signOutAction}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/[0.06] rounded-xl transition-colors"
          >
            <LogOut className="w-[18px] h-[18px]" />
            Sign Out
          </button>
        </form>
      </div>
    </div>
  );
}
