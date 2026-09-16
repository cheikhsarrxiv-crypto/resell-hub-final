'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/hooks';
import {
  DashboardCard,
  DashboardCardContent,
  DashboardCardHeader,
  DashboardCardTitle,
} from '@/components/dashboard/DashboardCard';
import { DashboardButton } from '@/components/dashboard/DashboardButton';

// Import steps
import WelcomeStep from './steps/WelcomeStep';
import MarketplacesStep from './steps/MarketplacesStep';
import VolumeStep from './steps/VolumeStep';
import ShippingStep from './steps/ShippingStep';
import ImportStep from './steps/ImportStep';
import ConnectionsStep from './steps/ConnectionsStep';
import FinishStep from './steps/FinishStep';

interface OnboardingData {
  currentStep: number;
  isCompleted: boolean;
  data: any;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { workspaceId, isReady } = useWorkspace();
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    fetchOnboarding();
  }, [isReady, workspaceId]);

  const fetchOnboarding = async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/onboarding?workspaceId=${workspaceId}`);
      const data = await response.json();
      if (data.success) {
        setOnboarding(data);
        // Si onboarding complété, rediriger vers dashboard
        if (data.isCompleted) {
          router.push('/dashboard');
        }
      }
    } catch (error) {
      console.error('Failed to fetch onboarding:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveStep = async (step: number, stepData: any) => {
    if (!workspaceId) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/onboarding?workspaceId=${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...stepData,
          step,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setOnboarding(data.onboarding);
      }
    } catch (error) {
      console.error('Failed to save step:', error);
    } finally {
      setSaving(false);
    }
  };

  const completeOnboarding = async () => {
    if (!workspaceId) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/onboarding?workspaceId=${workspaceId}`, {
        method: 'PUT',
      });

      if (response.ok) {
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] text-gray-400 text-sm">Loading...</div>
    );
  }

  if (!onboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] text-gray-400 text-sm">
        Error loading onboarding
      </div>
    );
  }

  const steps = [
    { number: 1, title: 'Welcome', component: WelcomeStep },
    { number: 2, title: 'Marketplaces', component: MarketplacesStep },
    { number: 3, title: 'Volume', component: VolumeStep },
    { number: 4, title: 'Shipping', component: ShippingStep },
    { number: 5, title: 'Import', component: ImportStep },
    { number: 6, title: 'Connections', component: ConnectionsStep },
    { number: 7, title: 'Finish', component: FinishStep },
  ];

  const currentStep = onboarding.currentStep;
  const CurrentStepComponent = steps[currentStep - 1]?.component;

  const goToNextStep = async (stepData: any) => {
    const nextStep = Math.min(currentStep + 1, 7);
    await saveStep(nextStep, stepData);
    if (currentStep < 7) {
      // Le step est désormais avancé côté serveur
      // On recharge pour rafraîchir l'UI
      await fetchOnboarding();
    } else {
      // Dernier step - terminer l'onboarding
      await completeOnboarding();
    }
  };

  const goToPreviousStep = () => {
    if (currentStep > 1) {
      setOnboarding({
        ...onboarding,
        currentStep: currentStep - 1,
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] py-10">
      <div className="max-w-2xl mx-auto px-4">
        {/* Wordmark */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 18 L12 5 L20 18 M7.5 13.5 H16.5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </span>
          <span className="text-sm font-semibold text-white tracking-tight">ADKSY</span>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            {steps.map((step, index) => (
              <div key={step.number} className="flex items-center">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center font-semibold text-sm ${
                    step.number <= currentStep
                      ? 'bg-[#FF5A1F] text-white'
                      : 'bg-white/[0.06] text-gray-500'
                  }`}
                >
                  {step.number}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`h-px w-10 mx-2 ${
                      step.number < currentStep ? 'bg-[#FF5A1F]' : 'bg-white/[0.08]'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-gray-500 text-sm">
            Step {currentStep} of {steps.length}: {steps[currentStep - 1].title}
          </p>
        </div>

        {/* Step Card */}
        <DashboardCard>
          <DashboardCardHeader>
            <DashboardCardTitle>{steps[currentStep - 1].title}</DashboardCardTitle>
          </DashboardCardHeader>
          <DashboardCardContent>
            {CurrentStepComponent && (
              <CurrentStepComponent
                data={onboarding.data}
                onNext={goToNextStep}
                onPrevious={goToPreviousStep}
                saving={saving}
                isLastStep={currentStep === 7}
              />
            )}
          </DashboardCardContent>
        </DashboardCard>

        {/* Navigation — each step's own form carries its primary action;
            this bar only ever needs to offer "back" and, on the final
            step, the completion action. */}
        <div className="flex justify-between items-center mt-6">
          <DashboardButton
            variant="outline"
            onClick={goToPreviousStep}
            disabled={currentStep === 1 || saving}
          >
            Previous
          </DashboardButton>
          {currentStep === 7 && (
            <DashboardButton
              variant="primary"
              onClick={() => completeOnboarding()}
              disabled={saving}
            >
              {saving ? 'Finishing...' : 'Complete Setup'}
            </DashboardButton>
          )}
        </div>
      </div>
    </div>
  );
}
