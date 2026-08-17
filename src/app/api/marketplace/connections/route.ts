import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/marketplace/connections
 * List marketplace connections for the current workspace
 * (used by the listing creation form to know which marketplaces
 * are actually connected and can be published to)
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const connections = await prisma.marketplaceConnection.findMany({
      where: { workspaceId },
      include: { marketplace: true },
    });

    return NextResponse.json({
      success: true,
      connections,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
