import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { SubscriptionService } from '@/services/SubscriptionService';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

/**
 * GET /api/subscriptions
 * Get current subscription and available plans
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const [subscription, plans] = await Promise.all([
      SubscriptionService.getSubscription(workspaceId),
      SubscriptionService.getPlans(),
    ]);

    const limits = await SubscriptionService.getPlanLimits(workspaceId);

    return NextResponse.json({
      success: true,
      subscription,
      plans,
      limits,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// There is intentionally no POST handler here. Plan changes are never a
// direct database write initiated by the client: upgrading to a paid plan
// goes through POST /api/stripe/checkout, downgrading/cancelling goes
// through POST /api/stripe/portal (Stripe customer portal), and the
// resulting plan/status changes are applied server-side by the
// customer.subscription.* webhooks in /api/stripe/webhooks. A prior
// version of this route let a client set any planId directly with no
// payment — removed as a real payment-bypass vulnerability. A request to
// this path with POST now gets Next.js's standard 405, matching a route
// file that doesn't export that method.
