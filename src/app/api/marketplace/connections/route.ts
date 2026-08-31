import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { prisma } from '@/lib/prisma';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

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
