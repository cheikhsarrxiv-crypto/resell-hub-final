'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/UI/Card';
import { Button } from '@/components/UI/Button';

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
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!onboarding) {
    return <div className="min-h-screen flex items-center justify-center">Error loading onboarding</div>;
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12">
      <div className="max-w-2xl mx-auto px-4">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            {steps.map((step, index) => (
              <div key={step.number} className="flex items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                    step.number <= currentStep
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {step.number}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`h-1 w-12 mx-2 ${
                      step.number < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-gray-600 text-sm">
            Step {currentStep} of {steps.length}: {steps[currentStep - 1].title}
          </p>
        </div>

        {/* Step Card */}
        <Card className="bg-white shadow-lg">
          <CardHeader>
            <CardTitle>{steps[currentStep - 1].title}</CardTitle>
          </CardHeader>
          <CardContent>
            {CurrentStepComponent && (
              <CurrentStepComponent
                data={onboarding.data}
                onNext={goToNextStep}
                onPrevious={goToPreviousStep}
                saving={saving}
                isLastStep={currentStep === 7}
              />
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex justify-between mt-8">
          <Button
            variant="outline"
            onClick={goToPreviousStep}
            disabled={currentStep === 1 || saving}
          >
            Previous
          </Button>
          <div className="text-sm text-gray-600">
            {currentStep} / {steps.length}
          </div>
          {currentStep === 7 ? (
            <Button
              variant="primary"
              onClick={() => completeOnboarding()}
              disabled={saving}
            >
              {saving ? 'Finishing...' : 'Complete Setup'}
            </Button>
          ) : (
            <Button variant="primary" disabled>
              (Click Next in form)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
