import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Dark-theme card primitives for the Dashboard V2 redesign. Deliberately
 * separate from src/components/UI/Card.tsx (which stays light-themed) —
 * Card.tsx is also used by pages outside this redesign's scope (admin,
 * /workspace/[slug], products/new, orders/[id], etc.) that haven't been
 * touched or tested here.
 */

interface DashboardCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function DashboardCard({ className, ...props }: DashboardCardProps) {
  return (
    <div
      className={cn(
        'bg-white/[0.03] border border-white/[0.08] rounded-2xl',
        className
      )}
      {...props}
    />
  );
}

export function DashboardCardHeader({ className, ...props }: DashboardCardProps) {
  return (
    <div
      className={cn('px-5 sm:px-6 py-4 sm:py-5 border-b border-white/[0.06]', className)}
      {...props}
    />
  );
}

interface DashboardCardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode;
}

export function DashboardCardTitle({ className, style, ...props }: DashboardCardTitleProps) {
  return (
    <h3
      className={cn('text-base font-semibold text-white', className)}
      style={{ fontFamily: 'var(--font-display)', ...style }}
      {...props}
    />
  );
}

interface DashboardCardDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
}

export function DashboardCardDescription({ className, ...props }: DashboardCardDescriptionProps) {
  return (
    <p className={cn('text-sm text-gray-500 mt-1', className)} {...props} />
  );
}

export function DashboardCardContent({ className, ...props }: DashboardCardProps) {
  return <div className={cn('px-5 sm:px-6 py-4 sm:py-5', className)} {...props} />;
}

export function DashboardCardFooter({ className, ...props }: DashboardCardProps) {
  return (
    <div
      className={cn('px-5 sm:px-6 py-4 border-t border-white/[0.06]', className)}
      {...props}
    />
  );
}
