import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import prisma from '@/lib/prisma';

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

    const data = await request.json();

    // Only allow these fields to be updated
    const allowedFields = ['name', 'description', 'country'];
    const updateData: any = {};

    allowedFields.forEach((field) => {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    });

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
