'use client';

import { AlertCircle, InboxIcon, Loader } from 'lucide-react';
import { ReactNode } from 'react';

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Loading...' }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Loader className="w-8 h-8 text-[#FF5A1F] animate-spin mb-4" />
      <p className="text-gray-600">{message}</p>
    </div>
  );
}

interface ErrorStateProps {
  message?: string;
  details?: string | null;
  onRetry?: (() => void) | null;
}

export function ErrorState({ 
  message = 'An error occurred', 
  details = null,
  onRetry = null 
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center bg-red-50 rounded-lg border border-red-200 p-6">
      <AlertCircle className="w-8 h-8 text-red-600 mb-4" />
      <p className="text-red-900 font-medium mb-1">{message}</p>
      {details && <p className="text-red-700 text-sm mb-4">{details}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: ReactNode | null;
  action?: ReactNode | null;
}

export function EmptyState({ 
  title = 'No items yet',
  description = 'Get started by creating your first item',
  icon = null,
  action = null
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon ? icon : <InboxIcon className="w-12 h-12 text-gray-300 mb-4" />}
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600 mb-6 max-w-sm">{description}</p>
      {action}
    </div>
  );
}
