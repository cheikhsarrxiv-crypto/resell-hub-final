import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { StorageService } from '@/services/StorageService';

/**
 * PUT /api/products/[id]/images/reorder
 * Reorder product images
 * SECURITY: Validates workspace + product ownership
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const productId = params.id;
    const { images } = await request.json();

    if (!Array.isArray(images)) {
      return NextResponse.json(
        { error: 'Images must be an array' },
        { status: 400 }
      );
    }

    // Validate image objects
    for (const img of images) {
      if (!img.id || typeof img.order !== 'number') {
        return NextResponse.json(
          { error: 'Each image must have id and order' },
          { status: 400 }
        );
      }
    }

    await StorageService.updateImageOrder(workspaceId, productId, images);

    return NextResponse.json({
      success: true,
      message: 'Images reordered successfully',
    });
  } catch (error) {
    console.error('[Reorder] Error:', error);
    return errorResponse(error);
  }
}
