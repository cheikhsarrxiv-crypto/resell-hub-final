import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="min-w-0">
        <h1
          className="text-2xl sm:text-3xl font-bold text-white tracking-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h1>
        {description && <p className="text-gray-500 mt-1 text-sm sm:text-base">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
