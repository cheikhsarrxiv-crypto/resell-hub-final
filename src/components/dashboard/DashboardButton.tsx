import React from 'react';
import { cn } from '@/lib/utils';

interface DashboardButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: React.ReactNode;
}

/**
 * Dark-theme button, separate from src/components/UI/Button.tsx (which
 * stays as-is for pages outside this redesign's scope). Only 'primary'
 * (solid orange) and 'danger' (solid red) look fine on any background —
 * 'outline'/'ghost' here assume a dark surface, unlike Button.tsx's.
 */
export function DashboardButton({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  disabled,
  children,
  ...props
}: DashboardButtonProps) {
  const baseClasses = 'font-medium rounded-full transition-colors inline-flex items-center justify-center gap-2';

  const variantClasses = {
    primary: 'bg-[#FF5A1F] text-white hover:bg-[#e64f18] disabled:bg-[#FF5A1F]/40',
    outline: 'border border-white/15 text-white hover:bg-white/[0.06] disabled:opacity-50',
    ghost: 'text-gray-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-50',
    danger: 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      className={cn(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        disabled || loading ? 'opacity-50 cursor-not-allowed' : '',
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
