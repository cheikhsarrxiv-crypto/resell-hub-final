import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { StorageService } from '@/services/StorageService';

/**
 * PUT /api/products/[id]/images/[imageId]/main
 * Set image as main product image
 * SECURITY: Validates workspace + product ownership
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; imageId: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const imageId = params.imageId;

    await StorageService.setMainImage(workspaceId, imageId);

    return NextResponse.json({
      success: true,
      message: 'Image set as main successfully',
    });
  } catch (error) {
    console.error('[Set Main] Error:', error);
    return errorResponse(error);
  }
}
