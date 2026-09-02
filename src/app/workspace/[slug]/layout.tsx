import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { DashboardLayout } from '@/components/Layout/DashboardLayout';

// See src/app/dashboard/layout.tsx for why this is pinned explicitly
// (Prisma's Edge Runtime false-positive on Vercel). This is a separate
// top-level route tree, not nested under /dashboard, so it needs its
// own declaration rather than inheriting one.
export const runtime = 'nodejs';

/**
 * Same server-side auth + email-verification gate as
 * /dashboard/layout.tsx — see that file for why this moved out of
 * middleware.ts.
 */
export default async function WorkspaceDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
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

  return (
    // The rest of the app (products, listings, orders, fulfillment,
    // analytics, subscription, settings) only exists under /dashboard/*
    // — without this override, DashboardLayout's default baseUrl
    // (/workspace/${slug}) points every sidebar link except "Dashboard"
    // at a route that doesn't exist. Same baseUrl as /dashboard/layout.tsx.
    <DashboardLayout workspaceSlug={params.slug} baseUrl="/dashboard">
      {children}
    </DashboardLayout>
  );
}
