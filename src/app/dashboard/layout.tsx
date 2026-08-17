'use client';

import { DashboardLayout } from '@/components/Layout/DashboardLayout';

export default function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // In a real app, would get workspace from auth context
  const workspaceSlug = 'demo-shop';

  return (
    <DashboardLayout workspaceSlug={workspaceSlug} baseUrl="/dashboard">
      {children}
    </DashboardLayout>
  );
}
