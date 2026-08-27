import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { getAuthSession } from '@/lib/api-auth';
import { StripeService } from '@/services/StripeService';
import { rateLimiter } from '@/lib/ratelimit';

/**
 * POST /api/stripe/portal
 * Create customer portal session
 */
export async function POST(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const { error: authError, session } = await getAuthSession(request);

    if (authError) {
      return authError;
    }

    const rateLimitResult = await rateLimiter.checkStripe(session!.user.id);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: 'Too many portal requests. Please try again later.',
          retryAfter: Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil(
              (rateLimitResult.resetAt.getTime() - Date.now()) / 1000
            ).toString(),
          },
        }
      );
    }

    const origin = request.headers.get('origin') || 'http://localhost:3000';

    const portalSession = await StripeService.createPortalSession(
      workspaceId,
      `${origin}/subscription`
    );

    return NextResponse.json({
      success: true,
      url: portalSession.url,
    });
  } catch (error) {
    console.error('[Portal] Error:', error);
    return errorResponse(error);
  }
}
