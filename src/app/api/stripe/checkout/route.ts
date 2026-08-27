import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { getAuthSession } from '@/lib/api-auth';
import { StripeService } from '@/services/StripeService';
import { rateLimiter } from '@/lib/ratelimit';

/**
 * POST /api/stripe/checkout
 * Create checkout session for plan upgrade
 * SECURITY: Verifies workspace + user auth
 */
export async function POST(request: NextRequest) {
  try {
    // Verify both workspace and auth session
    const workspaceId = await getVerifiedWorkspaceId(request);
    const { error: authError, session } = await getAuthSession(request);

    if (authError) {
      return authError;
    }

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'User not authenticated or email missing' },
        { status: 401 }
      );
    }

    const rateLimitResult = await rateLimiter.checkStripe(session.user.id);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: 'Too many checkout attempts. Please try again later.',
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

    const { planId } = await request.json();

    if (!planId) {
      return NextResponse.json(
        { error: 'Plan ID is required' },
        { status: 400 }
      );
    }

    // Get origin for URLs
    const origin = request.headers.get('origin') || 'http://localhost:3000';

    const checkoutSession = await StripeService.createCheckoutSession({
      planId,
      workspaceId,
      email: session.user.email, // SECURITY: From auth session, not placeholder
      successUrl: `${origin}/subscription?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/subscription`,
    });

    return NextResponse.json({
      success: true,
      sessionId: checkoutSession.id,
      url: checkoutSession.url,
    });
  } catch (error) {
    console.error('[Checkout] Error:', error);

    // Already subscribed: point the client at the billing portal instead
    // of a generic 500.
    if (error instanceof Error && error.message.includes('already has an active subscription')) {
      return NextResponse.json(
        {
          error: error.message,
          alreadySubscribed: true,
          portalUrl: '/api/stripe/portal',
        },
        { status: 409 }
      );
    }

    return errorResponse(error);
  }
}
