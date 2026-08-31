import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, verifyListingAccess, errorResponse } from '@/lib/security';
import { ListingService } from '@/services/ListingService';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

/**
 * GET /api/listings/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    // Ownership check first (throws if the listing doesn't belong to this workspace)
    await verifyListingAccess(params.id, workspaceId);
    // Then fetch with the full relations the detail page needs
    // (product + images, marketplace connection) — same helper already
    // used elsewhere in this service, not duplicated logic.
    const listing = await ListingService.getListing(params.id, workspaceId);

    return NextResponse.json({
      success: true,
      listing,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * PATCH /api/listings/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    await verifyListingAccess(params.id, workspaceId);

    const data = await request.json();

    const listing = await ListingService.updateListing(params.id, workspaceId, data);

    return NextResponse.json({
      success: true,
      message: 'Listing updated successfully',
      listing,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/listings/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    await verifyListingAccess(params.id, workspaceId);

    await ListingService.deleteListing(params.id, workspaceId);

    return NextResponse.json({
      success: true,
      message: 'Listing deleted successfully',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
