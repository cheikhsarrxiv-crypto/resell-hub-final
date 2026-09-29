import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse } from '@/lib/security';

// Reads the authenticated session — never statically rendered/cached (same
// rule as every other per-user API route, see products/route.ts).
export const dynamic = 'force-dynamic';

const LIST_LIMIT = 30;

/**
 * AI-first listing workflow — the first real UI surface for the
 * Notification table/NotificationService (which previously had no reader
 * anywhere in the app at all). User-scoped, not workspace-scoped:
 * Notification.userId is the real, existing ownership column
 * (NotificationService.createNotification resolves workspaceId -> its
 * owning user's id before ever writing one) — requireAuth() returns
 * exactly that same session user id, so this can never read another
 * user's notifications.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await requireAuth();

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
    });
    const unreadCount = await prisma.notification.count({ where: { userId, isRead: false } });

    return NextResponse.json({ success: true, notifications, unreadCount });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Marks one notification (by id) or every notification (id omitted) as
 * read, for the authenticated user only — the same ownership check as
 * GET, applied to the update's own `where` clause so a foreign
 * notification id is simply never matched, never a 500/leak.
 */
export async function PATCH(request: NextRequest) {
  try {
    const userId = await requireAuth();
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id : undefined;

    const result = await prisma.notification.updateMany({
      where: id ? { id, userId } : { userId },
      data: { isRead: true },
    });

    return NextResponse.json({ success: true, updated: result.count });
  } catch (error) {
    return errorResponse(error);
  }
}
