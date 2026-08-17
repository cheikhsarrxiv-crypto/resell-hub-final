'use client';

import { DashboardLayout } from '@/components/Layout/DashboardLayout';

export default function WorkspaceDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  return (
    <DashboardLayout workspaceSlug={params.slug}>
      {children}
    </DashboardLayout>
  );
}
