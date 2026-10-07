'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { LogOut, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOutAction } from '@/app/actions/auth';
import { Logo } from '@/components/UI/Logo';

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
  /**
   * Explicit "close" affordance (the X button, mobile drawer only — see
   * its own `md:hidden` below, the permanent desktop sidebar never needs
   * it). Distinct from `onNavigate` only semantically; both ultimately
   * close the same drawer state in DashboardLayout.
   */
  onClose?: () => void;
}

/** First letter of the user's name, or email when no name is set — never a fabricated initial. */
function initialFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.trim();
  return source ? source[0].toUpperCase() : '?';
}

export function DashboardSidebar({ navigation, pathname, isAdmin = false, onNavigate, onClose }: DashboardSidebarProps) {
  const { data: session } = useSession();

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <Logo size={26} className="text-white" />
          <div>
            <p className="text-sm font-semibold text-white tracking-tight">ADKSY</p>
            <p className="text-[11px] text-gray-500">{isAdmin ? 'Admin Panel' : 'Seller Dashboard'}</p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le menu"
            className="md:hidden w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60"
          >
            <X className="w-4 h-4" />
          </button>
        )}
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
                'relative flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60',
                isActive ? 'bg-white/[0.06] text-white' : 'text-gray-400 hover:text-white hover:bg-white/[0.03]'
              )}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-[#FF5A1F]"
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
          <div className="flex items-center gap-2.5 px-3 py-2">
            <span className="w-8 h-8 rounded-full bg-[#FF5A1F]/10 text-[#FF5A1F] text-xs font-semibold flex items-center justify-center shrink-0">
              {initialFor(session.user.name, session.user.email)}
            </span>
            <div className="min-w-0">
              {session.user.name && <p className="text-xs font-medium text-white truncate">{session.user.name}</p>}
              <p className="text-[11px] text-gray-500 truncate">{session.user.email}</p>
            </div>
          </div>
        )}
        <form action={signOutAction}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/[0.06] rounded-xl transition-colors"
          >
            <LogOut className="w-[18px] h-[18px]" />
            Se déconnecter
          </button>
        </form>
      </div>
    </div>
  );
}
