import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * Liste des emails admins (à remplacer par une vraie DB)
 */
const ADMIN_EMAILS = [
  'admin@resellhub.local',
  'admin@reselling.local',
];

/**
 * Vérifie si l'utilisateur est admin
 */
export async function verifyAdmin(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.email || !ADMIN_EMAILS.includes(session.user.email)) {
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
