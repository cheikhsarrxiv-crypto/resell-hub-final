import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { ListingService } from '@/services/ListingService';
import { createListingSchema } from '@/lib/validations';

/**
 * GET /api/listings
 * Liste les listings du workspace
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const page = parseInt(request.nextUrl.searchParams.get('page') || '1');
    const marketplaceId = request.nextUrl.searchParams.get('marketplaceId');
    const status = request.nextUrl.searchParams.get('status');

    const limit = 50;
    const offset = (page - 1) * limit;

    const { listings, total } = await ListingService.getListings(
      workspaceId,
      limit,
      offset,
      status || undefined,
      marketplaceId || undefined
    );

    return NextResponse.json({
      success: true,
      listings,
      pagination: {
        total,
        page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/listings
 * Crée un listing depuis un produit
 */
export async function POST(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const data = await request.json();

    // Validate
    const result = createListingSchema.safeParse({
      productId: data.productId,
      marketplaceIds: data.marketplaceIds,
      title: data.title,
      description: data.description,
      price: data.price,
      quantity: data.quantity,
      fulfillmentType: data.fulfillmentType,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.errors },
        { status: 400 }
      );
    }

    const listing = await ListingService.createListing(workspaceId, result.data);

    return NextResponse.json(
      {
        success: true,
        message: 'Listing created successfully',
        listing,
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
