import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, verifyProductAccess, errorResponse } from '@/lib/security';
import { ProductService } from '@/services/ProductService';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

/**
 * GET /api/products/[id]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const product = await verifyProductAccess(params.id, workspaceId);

    return NextResponse.json({
      success: true,
      product,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * PATCH /api/products/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    await verifyProductAccess(params.id, workspaceId);

    const data = await request.json();

    const product = await ProductService.updateProduct(params.id, workspaceId, data);

    return NextResponse.json({
      success: true,
      message: 'Product updated successfully',
      product,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/products/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    await verifyProductAccess(params.id, workspaceId);

    await ProductService.deleteProduct(params.id, workspaceId);

    return NextResponse.json({
      success: true,
      message: 'Product deleted successfully',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
