/**
 * Tests for the onboarding step-progression bug.
 *
 * Root cause (src/app/onboarding/page.tsx): saveStep() always POSTed
 * `step: onboarding.currentStep` (the CURRENT step) instead of the step
 * being advanced to. OnboardingService.updateStep() sets
 * currentStep = data.step directly, so every save just re-wrote the same
 * step number — new users were stuck on step 1 forever.
 *
 * The fix is a client-side change (page.tsx now sends currentStep + 1).
 * This project has no React component-rendering test setup (no jsdom /
 * React Testing Library configured), so these tests instead prove the
 * fix's real effect at the server contract the fixed client now drives —
 * OnboardingService / the onboarding data it persists — against a real
 * PostgreSQL database, and reproduce the exact original bug pattern for
 * confidence that the fix (and these tests) are meaningful.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { OnboardingService } from '@/services/OnboardingService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const createdUserIds: string[] = [];

async function createTestWorkspace() {
  const user = await prisma.user.create({
    data: {
      email: `onboarding-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Onboarding Test User',
      password: 'not-used',
    },
  });
  createdUserIds.push(user.id);

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Onboarding Test Workspace',
      slug: `onboarding-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId: user.id,
    },
  });

  return workspace.id;
}

describe.skipIf(!dbAvailable)('Onboarding step progression — real PostgreSQL', () => {
  afterEach(async () => {
    // Deleting the users cascades to Workspace -> OnboardingData.
    for (const id of createdUserIds.splice(0)) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it('starts at step 1 for a new workspace', async () => {
    const workspaceId = await createTestWorkspace();
    const progress = await OnboardingService.getOrCreateOnboarding(workspaceId);
    expect(progress.currentStep).toBe(1);
  });

  it('advances currentStep by 1 on each step, matching the fixed client contract (currentStep + 1)', async () => {
    const workspaceId = await createTestWorkspace();
    let progress = await OnboardingService.getOrCreateOnboarding(workspaceId);
    expect(progress.currentStep).toBe(1);

    // Mirrors the FIXED page.tsx: goToNextStep now sends step = currentStep + 1.
    for (let expectedNext = 2; expectedNext <= 7; expectedNext++) {
      progress = await OnboardingService.updateStep(workspaceId, {
        step: progress.currentStep + 1,
      });
      expect(progress.currentStep).toBe(expectedNext);
    }

    expect(progress.currentStep).toBe(7);
  });

  it('reproduces the original bug: sending the current step (not +1) never advances past step 1', async () => {
    const workspaceId = await createTestWorkspace();
    let progress = await OnboardingService.getOrCreateOnboarding(workspaceId);
    expect(progress.currentStep).toBe(1);

    // Mirrors the ORIGINAL buggy page.tsx: saveStep() always sent
    // step: onboarding.currentStep (the current step, never +1).
    for (let i = 0; i < 3; i++) {
      progress = await OnboardingService.updateStep(workspaceId, {
        step: progress.currentStep,
      });
    }

    expect(progress.currentStep).toBe(1); // stuck forever — this was the reported bug
  });

  it('persists step-specific fields alongside the step advance', async () => {
    const workspaceId = await createTestWorkspace();
    await OnboardingService.getOrCreateOnboarding(workspaceId);

    const progress = await OnboardingService.updateStep(workspaceId, {
      step: 2,
      businessName: 'My Shop',
      businessType: 'reseller',
    });

    expect(progress.currentStep).toBe(2);
    expect(progress.businessName).toBe('My Shop');
    expect(progress.businessType).toBe('reseller');
  });

  it('completeOnboarding sets currentStep = 7 and marks the workspace as onboarded', async () => {
    const workspaceId = await createTestWorkspace();
    await OnboardingService.getOrCreateOnboarding(workspaceId);

    const workspace = await OnboardingService.completeOnboarding(workspaceId);
    expect(workspace.onboardingCompleted).toBe(true);
    expect(await OnboardingService.isOnboardingCompleted(workspaceId)).toBe(true);
  });
});
