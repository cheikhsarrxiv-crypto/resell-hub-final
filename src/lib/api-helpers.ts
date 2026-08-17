import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

/**
 * Verify user session and workspace ownership
 * To be used at the start of each protected API endpoint
 */
export async function verifyAuthAndWorkspace(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();

    if (!session?.user?.id) {
      return {
        error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        userId: null,
        workspaceId: null,
      };
    }

    const userId = session.user.id;

    // Get workspace ID from query params
    const workspaceId = request.nextUrl.searchParams.get('workspaceId');

    if (!workspaceId) {
      return {
        error: NextResponse.json(
          { error: 'Workspace ID is required' },
          { status: 400 }
        ),
        userId,
        workspaceId: null,
      };
    }

    // Verify workspace ownership
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        userId, // Ensure user owns this workspace
      },
    });

    if (!workspace) {
      return {
        error: NextResponse.json(
          { error: 'Workspace not found or access denied' },
          { status: 403 }
        ),
        userId,
        workspaceId,
      };
    }

    // Success
    return {
      error: null,
      userId,
      workspaceId,
    };
  } catch (error) {
    console.error('API auth error:', error);
    return {
      error: NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      ),
      userId: null,
      workspaceId: null,
    };
  }
}

/**
 * Wrapper pour les endpoints API protégés
 * Usage:
 *   export async function GET(request: NextRequest) {
 *     return withAuth(request, async (userId, workspaceId) => {
 *       // Your logic here
 *     });
 *   }
 */
export async function withAuth(
  request: NextRequest,
  handler: (userId: string, workspaceId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  const { error, userId, workspaceId } = await verifyAuthAndWorkspace(request);

  if (error) {
    return error;
  }

  return handler(userId!, workspaceId!);
}
