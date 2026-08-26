import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * Admin emails come only from ADMIN_EMAIL (comma-separated for multiple
 * admins) — never hardcoded. An unset ADMIN_EMAIL means no one is admin
 * (fail closed), instead of falling back to a guessable placeholder list
 * that anyone could self-register as.
 */
export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True if `email` is reserved for an admin account, whether or not that
 * account has been created yet. Used by signup to stop anyone else from
 * registering it and inheriting admin access via the email match below.
 */
export function isReservedAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.trim().toLowerCase());
}

/**
 * Vérifie si l'utilisateur est admin
 */
export async function verifyAdmin(request: NextRequest) {
  try {
    const session = await auth();
    const adminEmails = getAdminEmails();

    if (
      !session?.user?.email ||
      adminEmails.length === 0 ||
      !adminEmails.includes(session.user.email.trim().toLowerCase())
    ) {
      return {
        isAdmin: false,
        error: NextResponse.json(
          { error: 'Access denied - Admin only' },
          { status: 403 }
        ),
      };
    }

    return {
      isAdmin: true,
      error: null,
    };
  } catch (error) {
    return {
      isAdmin: false,
      error: NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      ),
    };
  }
}

/**
 * Wrapper pour les routes admin
 */
export async function adminRoute<T>(
  request: NextRequest,
  handler: () => Promise<T>
) {
  const { isAdmin, error } = await verifyAdmin(request);

  if (!isAdmin) {
    return error;
  }

  return await handler();
}
