import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { SubscriptionService } from '@/services/SubscriptionService';

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

/**
 * POST /api/subscriptions/change-plan
 * Change to a different plan
 */
export async function POST(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const { planId } = await request.json();

    if (!planId) {
      return NextResponse.json(
        { error: 'Plan ID required' },
        { status: 400 }
      );
    }

    const subscription = await SubscriptionService.changePlan(workspaceId, planId);

    return NextResponse.json({
      success: true,
      message: 'Plan changed successfully',
      subscription,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
