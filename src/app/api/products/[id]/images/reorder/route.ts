import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { StorageService } from '@/services/StorageService';

const MAX_REORDER_IMAGES = 100;
const MAX_IMAGE_ID_LENGTH = 128;
const MIN_ORDER = 0;
const MAX_ORDER = 10000;

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

    // Parse the body defensively: a syntactically invalid body, a JSON
    // `null`, or a root that is not an object must be a clean 400 — never a
    // 500 carrying the raw parser / destructuring error message.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON' },
        { status: 400 }
      );
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }

    const images = (body as { images?: unknown }).images;

    if (!Array.isArray(images)) {
      return NextResponse.json(
        { error: 'Images must be an array' },
        { status: 400 }
      );
    }

    if (images.length > MAX_REORDER_IMAGES) {
      return NextResponse.json(
        { error: `Too many images (maximum ${MAX_REORDER_IMAGES})` },
        { status: 400 }
      );
    }

    // Validate image objects: a non-null object with a non-empty string id,
    // an integer order in a sane range, and (when provided) a boolean isMain.
    for (const img of images) {
      const valid =
        typeof img === 'object' &&
        img !== null &&
        typeof img.id === 'string' &&
        img.id.length > 0 &&
        img.id.length <= MAX_IMAGE_ID_LENGTH &&
        Number.isInteger(img.order) &&
        img.order >= MIN_ORDER &&
        img.order <= MAX_ORDER &&
        (img.isMain === undefined || typeof img.isMain === 'boolean');

      if (!valid) {
        return NextResponse.json(
          { error: 'Each image must have a string id, an integer order and, optionally, a boolean isMain' },
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
