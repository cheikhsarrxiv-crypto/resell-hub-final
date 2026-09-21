import { NextRequest, NextResponse } from 'next/server';
import { ProductService, PRODUCT_SKU_CONFLICT_MESSAGE } from '@/services/ProductService';
import { createProductSchema } from '@/lib/validations';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const page = parseInt(request.nextUrl.searchParams.get('page') || '1');
    const limit = 50;
    const offset = (page - 1) * limit;

    const { products, total } = await ProductService.getProducts(workspaceId, limit, offset);

    return NextResponse.json({
      success: true,
      products,
      pagination: {
        total,
        page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('GET products error:', error);
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const data = await request.json();

    // Validate
    const result = createProductSchema.safeParse(data);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.errors },
        { status: 400 }
      );
    }

    const product = await ProductService.createProduct(workspaceId, result.data);

    return NextResponse.json(
      {
        success: true,
        message: 'Product created successfully',
        product,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST product error:', error);

    // SKU-conflict fix: a clean, business-level 409 for the one specific
    // conflict ProductService.createProduct now throws for a
    // (workspaceId, sku) collision — mirrors the existing
    // "already has an active subscription" -> 409 pattern in
    // /api/stripe/checkout/route.ts. errorResponse() itself is
    // deliberately left unchanged.
    if (error instanceof Error && error.message === PRODUCT_SKU_CONFLICT_MESSAGE) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return errorResponse(error);
  }
}
