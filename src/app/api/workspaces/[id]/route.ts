import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import prisma from '@/lib/prisma';
import { workspaceUpdateSchema } from '@/lib/validations';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

/**
 * GET /api/workspaces/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    // Verify workspace ID matches param
    if (params.id !== workspaceId) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        subscription: { include: { plan: true } },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      workspace,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * PUT /api/workspaces/[id]
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    // Verify workspace ID matches param
    if (params.id !== workspaceId) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    const data = await request.json().catch(() => null);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Only allow these fields to be updated, with the type and size each column expects (R6)
    const parsed = workspaceUpdateSchema.safeParse(data);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.errors.map((e) => ({ path: e.path, message: e.message })) },
        { status: 400 }
      );
    }
    const updateData: Record<string, string | null> = {};
    for (const [field, value] of Object.entries(parsed.data)) {
      if (value !== undefined) updateData[field] = value;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: updateData,
      include: {
        subscription: { include: { plan: true } },
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Workspace updated successfully',
      workspace,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/workspaces/[id]
 * Permanently deletes the workspace and all related data (products,
 * listings, orders, fulfillment records, marketplace connections, etc.
 * via onDelete: Cascade on every relation in the Prisma schema).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    // Verify workspace ID matches param
    if (params.id !== workspaceId) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    await prisma.workspace.delete({
      where: { id: workspaceId },
    });

    return NextResponse.json({
      success: true,
      message: 'Workspace deleted successfully',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
