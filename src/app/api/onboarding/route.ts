import { NextRequest, NextResponse } from 'next/server';
import { getVerifiedWorkspaceId, errorResponse } from '@/lib/security';
import { OnboardingService } from '@/services/OnboardingService';
import { onboardingStepSchema } from '@/lib/validations';

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
    const body = await request.json().catch(() => null);

    // Validate step and every field (R6): whole step 1..7, bounded strings, typed flags
    const parsed = onboardingStepSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid step data. Step must be a whole number between 1 and 7' },
        { status: 400 }
      );
    }
    const data = parsed.data;

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
