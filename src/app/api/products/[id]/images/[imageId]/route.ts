import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { StorageService } from '@/services/StorageService';

/**
 * DELETE /api/products/[id]/images/[imageId]
 * Delete product image
 * SECURITY: Validates workspace + product ownership
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; imageId: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const imageId = params.imageId;

    await StorageService.deleteImage(workspaceId, imageId);

    return NextResponse.json({
      success: true,
      message: 'Image deleted successfully',
    });
  } catch (error) {
    console.error('[Delete Image] Error:', error);
    return errorResponse(error);
  }
}

/**
 * PUT /api/products/[id]/images/[imageId]
 * Update image (alt text, main status)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; imageId: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const { altText, isMain } = await request.json();
    const imageId = params.imageId;

    if (isMain) {
      // Setting main image has dedicated exclusivity logic (unsets other images)
      await StorageService.setMainImage(workspaceId, imageId);
    }

    const image = await StorageService.updateImage(workspaceId, imageId, altText);

    return NextResponse.json({
      success: true,
      message: 'Image updated',
      image,
    });
  } catch (error) {
    console.error('[Update Image] Error:', error);
    return errorResponse(error);
  }
}
