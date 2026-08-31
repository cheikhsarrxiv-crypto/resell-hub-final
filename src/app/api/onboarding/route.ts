import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { OnboardingService } from '@/services/OnboardingService';

// This route reads the authenticated session (via headers()/cookies()
// under the hood), so it must never be statically rendered or cached —
// each response is specific to the requesting user.
export const dynamic = 'force-dynamic';

/**
 * GET /api/onboarding
 * Récupère la progression du onboarding
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const progress = await OnboardingService.getProgress(workspaceId);

    return NextResponse.json({
      success: true,
      ...progress,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/onboarding
 * Met à jour une étape du onboarding
 */
export async function POST(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);
    const data = await request.json();

    // Validate step
    if (!data.step || data.step < 1 || data.step > 7) {
      return NextResponse.json(
        { error: 'Invalid step. Must be between 1 and 7' },
        { status: 400 }
      );
    }

    const onboarding = await OnboardingService.updateStep(workspaceId, data);

    return NextResponse.json({
      success: true,
      message: `Onboarding step ${data.step} saved`,
      onboarding,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * PUT /api/onboarding/complete
 * Termine le onboarding
 */
export async function PUT(request: NextRequest) {
  try {
    const workspaceId = await getVerifiedWorkspaceId(request);

    const workspace = await OnboardingService.completeOnboarding(workspaceId);

    return NextResponse.json({
      success: true,
      message: 'Onboarding completed successfully',
      workspace,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
