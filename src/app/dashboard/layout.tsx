import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { DashboardLayout } from '@/components/Layout/DashboardLayout';

/**
 * Server-side auth + email-verification gate for the whole /dashboard
 * tree. This used to be enforced in middleware.ts via direct Prisma
 * calls; middleware was split to be Edge-Runtime-safe (see
 * middleware.ts and src/auth.config.ts) and can no longer call Prisma,
 * so the check moved here — a Server Component, Node.js runtime, same
 * pattern as /dashboard/admin/layout.tsx.
 */
export default async function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { emailVerified: true },
  });

  if (!user?.emailVerified) {
    redirect('/verify-email');
  }

  // In a real app, would get workspace from auth context
  const workspaceSlug = 'demo-shop';

  return (
    <DashboardLayout workspaceSlug={workspaceSlug} baseUrl="/dashboard">
      {children}
    </DashboardLayout>
  );
}
