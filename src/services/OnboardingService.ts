import prisma from '@/lib/prisma';

export interface OnboardingStepData {
  step: number;
  businessName?: string;
  businessType?: string;
  marketplaces?: string[];
  productVolume?: string;
  shippingMode?: string;
  shippingPartner?: string;
  importMethod?: string;
  connectionsSetup?: boolean;
}

export class OnboardingService {
  /**
   * Get or create onboarding data
   */
  static async getOrCreateOnboarding(workspaceId: string) {
    try {
      let onboarding = await prisma.onboardingData.findUnique({
        where: { workspaceId },
      });

      if (!onboarding) {
        onboarding = await prisma.onboardingData.create({
          data: {
            workspaceId,
            currentStep: 1,
          },
        });
      }

      return onboarding;
    } catch (error) {
      console.error('[OnboardingService] Error:', error);
      throw error;
    }
  }

  /**
   * Update onboarding step
   */
  static async updateStep(workspaceId: string, data: OnboardingStepData) {
    try {
      // Ensure onboarding exists
      await this.getOrCreateOnboarding(workspaceId);

      const updateData: any = {
        currentStep: data.step,
      };

      // Add step-specific data
      if (data.businessName !== undefined) updateData.businessName = data.businessName;
      if (data.businessType !== undefined) updateData.businessType = data.businessType;
      if (data.marketplaces !== undefined) updateData.marketplaces = data.marketplaces;
      if (data.productVolume !== undefined) updateData.productVolume = data.productVolume;
      if (data.shippingMode !== undefined) updateData.shippingMode = data.shippingMode;
      if (data.shippingPartner !== undefined) updateData.shippingPartner = data.shippingPartner;
      if (data.importMethod !== undefined) updateData.importMethod = data.importMethod;
      if (data.connectionsSetup !== undefined) updateData.connectionsSetup = data.connectionsSetup;

      const onboarding = await prisma.onboardingData.update({
        where: { workspaceId },
        data: updateData,
      });

      return onboarding;
    } catch (error) {
      console.error('[OnboardingService] Update step error:', error);
      throw error;
    }
  }

  /**
   * Complete onboarding
   */
  static async completeOnboarding(workspaceId: string) {
    try {
      // Update onboarding data
      await prisma.onboardingData.update({
        where: { workspaceId },
        data: {
          currentStep: 7,
          completedAt: new Date(),
        },
      });

      // Mark workspace as onboarding completed
      const workspace = await prisma.workspace.update({
        where: { id: workspaceId },
        data: { onboardingCompleted: true },
      });

      return workspace;
    } catch (error) {
      console.error('[OnboardingService] Complete error:', error);
      throw error;
    }
  }

  /**
   * Check if onboarding is completed
   */
  static async isOnboardingCompleted(workspaceId: string): Promise<boolean> {
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
      });

      return workspace?.onboardingCompleted || false;
    } catch (error) {
      console.error('[OnboardingService] Check completed error:', error);
      return false;
    }
  }

  /**
   * Get onboarding progress
   */
  static async getProgress(workspaceId: string) {
    try {
      const onboarding = await this.getOrCreateOnboarding(workspaceId);
      const isCompleted = await this.isOnboardingCompleted(workspaceId);

      return {
        currentStep: onboarding.currentStep,
        isCompleted,
        data: {
          businessName: onboarding.businessName,
          businessType: onboarding.businessType,
          marketplaces: onboarding.marketplaces,
          productVolume: onboarding.productVolume,
          shippingMode: onboarding.shippingMode,
          importMethod: onboarding.importMethod,
          connectionsSetup: onboarding.connectionsSetup,
        },
      };
    } catch (error) {
      console.error('[OnboardingService] Get progress error:', error);
      throw error;
    }
  }
}
