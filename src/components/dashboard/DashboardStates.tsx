'use client';

import Link from 'next/link';
import { AlertCircle, InboxIcon, Loader, Lock } from 'lucide-react';
import { ReactNode } from 'react';
import { DashboardButton } from './DashboardButton';

/**
 * Dark-theme Loading/Error/Empty states, parallel to
 * src/components/StateComponents.tsx (which stays as-is — used by pages
 * outside this redesign's scope: products/[id], listings/new, admin, etc.)
 */

export function DashboardLoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Loader className="w-6 h-6 text-[#FF5A1F] animate-spin mb-4" />
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  );
}

interface DashboardErrorStateProps {
  message?: string;
  details?: string | null;
  onRetry?: (() => void) | null;
  /** Takes precedence over onRetry when given — e.g. a "Sign in again" link for an auth error, where retrying the same request would just fail again. */
  action?: ReactNode | null;
}

export function DashboardErrorState({
  message = 'An error occurred',
  details = null,
  onRetry = null,
  action = null,
}: DashboardErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center bg-red-500/[0.04] rounded-2xl border border-red-500/20 p-6">
      <AlertCircle className="w-6 h-6 text-red-400 mb-4" />
      <p className="text-red-300 font-medium mb-1">{message}</p>
      {details && <p className="text-red-400/70 text-sm mb-4">{details}</p>}
      {action ? (
        action
      ) : (
        onRetry && (
          <DashboardButton variant="danger" size="sm" onClick={onRetry}>
            Try Again
          </DashboardButton>
        )
      )}
    </div>
  );
}

interface DashboardUpgradeStateProps {
  message?: string;
}

/**
 * A 403 from a plan-gated endpoint (e.g. advancedAnalytics) is never a
 * failure — it's expected tiering. Rendered instead of
 * DashboardErrorState so the user sees an actionable upgrade path, not a
 * generic "something went wrong".
 */
export function DashboardUpgradeState({
  message = 'This feature is not included in your current plan.',
}: DashboardUpgradeStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center bg-[#FF5A1F]/[0.04] rounded-2xl border border-[#FF5A1F]/20 p-6">
      <Lock className="w-6 h-6 text-[#FF5A1F] mb-4" />
      <p className="text-white font-medium mb-1">Upgrade required</p>
      <p className="text-gray-400 text-sm mb-4 max-w-sm">{message}</p>
      <Link href="/dashboard/subscription">
        <DashboardButton variant="primary" size="sm">
          View plans
        </DashboardButton>
      </Link>
    </div>
  );
}

interface DashboardEmptyStateProps {
  title?: string;
  description?: string;
  icon?: ReactNode | null;
  action?: ReactNode | null;
}

export function DashboardEmptyState({
  title = 'No items yet',
  description = 'Get started by creating your first item',
  icon = null,
  action = null,
}: DashboardEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      {icon ? icon : <InboxIcon className="w-10 h-10 text-gray-700 mb-4" />}
      <h3 className="text-base font-medium text-white mb-1.5">{title}</h3>
      <p className="text-gray-500 text-sm mb-6 max-w-sm">{description}</p>
      {action}
    </div>
  );
}
