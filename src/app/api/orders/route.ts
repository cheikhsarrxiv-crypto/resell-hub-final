import { NextRequest, NextResponse } from 'next/server';
import { OrderService } from '@/services/OrderService';
import { createOrderSchema } from '@/lib/validations';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const page = parseInt(request.nextUrl.searchParams.get('page') || '1');
    const status = request.nextUrl.searchParams.get('status') || undefined;
    const limit = 50;
    const offset = (page - 1) * limit;

    const { orders, total } = await OrderService.getOrders(workspaceId, limit, offset, status);

    return NextResponse.json({
      success: true,
      orders,
      pagination: {
        total,
        page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('GET orders error:', error);
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const data = await request.json();

    // Validate
    const result = createOrderSchema.safeParse(data);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.errors },
        { status: 400 }
      );
    }

    const order = await OrderService.createOrder(workspaceId, result.data);

    return NextResponse.json(
      {
        success: true,
        message: 'Order created successfully',
        order,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST order error:', error);
    return errorResponse(error);
  }
}
