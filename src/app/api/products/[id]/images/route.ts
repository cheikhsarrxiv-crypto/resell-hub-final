import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { StorageService } from '@/services/StorageService';

/**
 * POST /api/products/[id]/images
 * Upload product image(s)
 * SECURITY: Validates workspace + product ownership
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const productId = params.id;

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      );
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large (max 10MB)' },
        { status: 400 }
      );
    }

    // Convert File to Buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload image
    const productImage = await StorageService.uploadImage({
      workspaceId,
      productId,
      file: buffer,
      fileName: file.name,
      mimeType: file.type,
    });

    return NextResponse.json({
      success: true,
      image: productImage,
    });
  } catch (error) {
    console.error('[Upload] Error:', error);
    return errorResponse(error);
  }
}

/**
 * GET /api/products/[id]/images
 * Get product images
 * SECURITY: Validates workspace + product ownership
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const productId = params.id;

    const images = await StorageService.getProductImages(workspaceId, productId);

    return NextResponse.json({
      success: true,
      images,
    });
  } catch (error) {
    console.error('[Get Images] Error:', error);
    return errorResponse(error);
  }
}
