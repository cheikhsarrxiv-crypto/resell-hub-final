'use client';

import { AlertCircle, InboxIcon, Loader } from 'lucide-react';
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
}

export function DashboardErrorState({
  message = 'An error occurred',
  details = null,
  onRetry = null,
}: DashboardErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center bg-red-500/[0.04] rounded-2xl border border-red-500/20 p-6">
      <AlertCircle className="w-6 h-6 text-red-400 mb-4" />
      <p className="text-red-300 font-medium mb-1">{message}</p>
      {details && <p className="text-red-400/70 text-sm mb-4">{details}</p>}
      {onRetry && (
        <DashboardButton variant="danger" size="sm" onClick={onRetry}>
          Try Again
        </DashboardButton>
      )}
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
