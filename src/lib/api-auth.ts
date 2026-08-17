import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';

/**
 * Vérifie que l'utilisateur est authentifié et retourne la session
 */
export async function getAuthSession(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return {
      error: NextResponse.json(
        { error: 'Unauthorized - Not authenticated' },
        { status: 401 }
      ),
      session: null,
    };
  }

  return { error: null, session };
}

/**
 * Vérifie l'authentification ET l'accès au workspace
 */
export async function getAuthenticatedWorkspace(
  request: NextRequest,
  workspaceId?: string
) {
  const session = await auth();

  if (!session?.user?.id) {
    return {
      error: NextResponse.json(
        { error: 'Unauthorized - Not authenticated' },
        { status: 401 }
      ),
      workspace: null,
      session: null,
    };
  }

  // Récupérer le workspaceId depuis les query params s'il n'est pas fourni
  const wsId = workspaceId || request.nextUrl.searchParams.get('workspaceId');

  if (!wsId) {
    return {
      error: NextResponse.json(
        { error: 'Bad Request - Workspace ID required' },
        { status: 400 }
      ),
      workspace: null,
      session,
    };
  }

  try {
    // Vérifier que le workspace existe ET que l'utilisateur y a accès
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: wsId,
        userId: session.user.id, // ✅ CRITIQUE: Vérifier l'ownership
      },
    });

    if (!workspace) {
      return {
        error: NextResponse.json(
          { error: 'Forbidden - No access to this workspace' },
          { status: 403 }
        ),
        workspace: null,
        session,
      };
    }

    return {
      error: null,
      workspace,
      session,
    };
  } catch (error) {
    console.error('[API Auth Error]', error);
    return {
      error: NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      ),
      workspace: null,
      session,
    };
  }
}

/**
 * Wrapper pour les API routes qui nécessitent auth + workspace
 * Usage:
 * export async function GET(request: NextRequest) {
 *   const result = await protectedRoute(request, async (workspace, session) => {
 *     // Logique protégée
 *   });
 *   return result;
 * }
 */
export async function protectedRoute<T>(
  request: NextRequest,
  handler: (workspace: any, session: any) => Promise<T>,
  workspaceId?: string
) {
  try {
    const { error, workspace, session } = await getAuthenticatedWorkspace(
      request,
      workspaceId
    );

    if (error) {
      return error;
    }

    return await handler(workspace, session);
  } catch (error) {
    console.error('[Protected Route Error]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
