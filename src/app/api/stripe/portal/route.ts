import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { StripeService } from '@/services/StripeService';

/**
 * POST /api/stripe/portal
 * Create customer portal session
 */
export async function POST(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const origin = request.headers.get('origin') || 'http://localhost:3000';

    const session = await StripeService.createPortalSession(
      workspaceId,
      `${origin}/subscription`
    );

    return NextResponse.json({
      success: true,
      url: session.url,
    });
  } catch (error) {
    console.error('[Portal] Error:', error);
    return errorResponse(error);
  }
}
