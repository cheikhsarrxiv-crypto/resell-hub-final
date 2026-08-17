import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { FulfillmentService } from '@/services/FulfillmentService';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const partners = await FulfillmentService.getAvailablePartners();

    return NextResponse.json({
      success: true,
      partners,
    });
  } catch (error) {
    console.error('Error fetching partners:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
