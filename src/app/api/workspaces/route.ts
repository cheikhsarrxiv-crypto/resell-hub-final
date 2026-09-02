import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { requireVerifiedEmail } from '@/lib/security';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Was enforced in middleware.ts before it was split to be
    // Edge-Runtime-safe (see middleware.ts) — moved here since this
    // route doesn't go through verifyWorkspaceAccess()/requireAuth().
    try {
      await requireVerifiedEmail(session.user.id);
    } catch {
      return NextResponse.json(
        { error: 'Email verification required' },
        { status: 403 }
      );
    }

    const workspaces = await prisma.workspace.findMany({
      where: { userId: session.user.id },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      workspaces,
    });
  } catch (error) {
    console.error('Error fetching workspaces:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
