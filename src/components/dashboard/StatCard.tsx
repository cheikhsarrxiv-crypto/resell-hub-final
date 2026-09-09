import React from 'react';
import { cn } from '@/lib/utils';
import { DashboardCard } from './DashboardCard';

interface StatCardProps {
  label: string;
  value: string | number;
  change?: number;
  icon?: React.ReactNode;
  accent?: boolean;
}

export function StatCard({ label, value, change, icon, accent = false }: StatCardProps) {
  return (
    <DashboardCard className="p-5 sm:p-6 dash-reveal">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{label}</p>
          <p
            className="text-2xl sm:text-3xl font-bold text-white mt-2 tabular-nums truncate"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {value}
          </p>
          {change !== undefined && (
            <p
              className={cn(
                'text-xs mt-2 font-medium',
                change >= 0 ? 'text-emerald-400' : 'text-red-400'
              )}
            >
              {change >= 0 ? '+' : ''}
              {change}% from last month
            </p>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
              accent ? 'bg-[#FF5A1F]/10 text-[#FF5A1F]' : 'bg-white/[0.05] text-gray-400'
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
