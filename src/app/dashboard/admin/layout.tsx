import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getAdminEmails } from '@/lib/admin';

/**
 * Server-side admin gate for the whole /dashboard/admin section.
 * Without this, AdminPage (a client component) rendered its full shell
 * — headers, stat card layout — for any authenticated user before its
 * fetch('/api/admin/metrics') came back 403. The API route was already
 * correctly protected (adminRoute/verifyAdmin), but the page itself
 * wasn't, so a non-admin briefly saw the admin panel's structure.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const adminEmails = getAdminEmails();
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email || adminEmails.length === 0 || !adminEmails.includes(email)) {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
