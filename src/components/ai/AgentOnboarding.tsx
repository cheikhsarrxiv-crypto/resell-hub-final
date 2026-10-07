'use client';

import { useMemo, useState } from 'react';
import {
  getUsageTypeStep,
  getOnboardingStepsForUsageType,
  type AgentUsageType,
  type AgentProfileInput,
  type AgentOnboardingStep,
} from '@/lib/ai/agentProfile';

/**
 * AI Agent Personalization V1 — short, conditional onboarding shown
 * inside the Agent page itself (never a separate app/route — see the
 * audit's own UX section) when no AgentProfile exists yet, or when
 * reopened from Settings to edit an existing one.
 *
 * Every step after the first (usageType, never skippable) can be
 * skipped individually ("Passer"), and "Terminer maintenant" lets the
 * reseller finish with only usageType set — the profile is a context,
 * never a mandatory form.
 */

interface AgentOnboardingProps {
  onComplete: () => void;
  /** Set when reopened from Settings to edit an existing profile —
   * pre-fills every answer and starts past the usageType step. Omitted
   * (first-time onboarding): starts from scratch. */
  initialAnswers?: AgentProfileInput | null;
}

const optionButtonClass =
  'group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-left transition-colors hover:border-[#FF5A1F]/40 hover:bg-[#FF5A1F]/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60 w-full';
const optionButtonSelectedClass = 'border-[#FF5A1F]/60 bg-[#FF5A1F]/[0.1]';

export function AgentOnboarding({ onComplete, initialAnswers = null }: AgentOnboardingProps) {
  const [answers, setAnswers] = useState<AgentProfileInput>(
    initialAnswers ?? ({ usageType: undefined as unknown as AgentUsageType })
  );
  // Always starts at the usageType step, even when editing an existing
  // profile — usageType itself must stay editable, like every other
  // field (a reseller who pivots to dropshipping must be able to change
  // it, not just the fields conditional on it).
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conditionalSteps = useMemo<AgentOnboardingStep[]>(
    () => (answers.usageType ? getOnboardingStepsForUsageType(answers.usageType) : []),
    [answers.usageType]
  );

  const totalSteps = 1 + conditionalSteps.length;
  const currentStepNumber = stepIndex + 1;

  const save = async (finalAnswers: AgentProfileInput) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/ai/agent/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalAnswers),
      });
      if (!response.ok) {
        setError("Impossible d'enregistrer tes préférences pour le moment. Réessaie dans quelques instants.");
        setSaving(false);
        return;
      }
      onComplete();
    } catch {
      setError('Connexion impossible. Réessaie.');
      setSaving(false);
    }
  };

  const handleUsageTypeSelect = (usageType: AgentUsageType) => {
    // Genuinely changing usage type (e.g. resell -> personal) starts a
    // clean slate — the previous conditional answers (platforms, monthly
    // goal, a margin-flavored priority...) don't apply to the new path
    // and must never be silently carried over/saved under it. Re-
    // confirming the SAME usage type (editing an existing profile,
    // clicking straight through) preserves every already-loaded answer
    // instead of wiping it.
    if (answers.usageType && answers.usageType !== usageType) {
      setAnswers({ usageType });
    } else {
      setAnswers({ ...answers, usageType });
    }
    setStepIndex(1);
  };

  const advanceOrFinish = (nextAnswers: AgentProfileInput) => {
    setAnswers(nextAnswers);
    if (stepIndex + 1 >= totalSteps) {
      save(nextAnswers);
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const handleSingleSelect = (step: AgentOnboardingStep, value: string) => {
    advanceOrFinish({ ...answers, [step.field]: value } as AgentProfileInput);
  };

  const handleMultiContinue = (step: AgentOnboardingStep) => {
    advanceOrFinish(answers);
  };

  const handleSkip = () => {
    if (stepIndex + 1 >= totalSteps) {
      save(answers);
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const handleFinishNow = () => {
    save(answers);
  };

  const toggleMultiValue = (step: AgentOnboardingStep, value: string) => {
    const current = (answers[step.field] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setAnswers({ ...answers, [step.field]: next } as AgentProfileInput);
  };

  const currentConditionalStep = stepIndex >= 1 ? conditionalSteps[stepIndex - 1] : undefined;

  return (
    <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-10">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <h2 className="text-lg font-semibold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            Bienvenue dans ton Agent IA 👋
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Pour mieux t&apos;aider, j&apos;ai quelques petites questions — tu peux en passer autant que tu veux.
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-300 px-4 py-3 rounded-lg text-sm" role="alert">
            {error}
          </div>
        )}

        {stepIndex === 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-300">{getUsageTypeStep().question}</p>
            <div className="space-y-2">
              {getUsageTypeStep().options.map((option) => {
                const selected = answers.usageType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={saving}
                    onClick={() => handleUsageTypeSelect(option.value as AgentUsageType)}
                    className={`${optionButtonClass} ${selected ? optionButtonSelectedClass : ''}`}
                    aria-pressed={selected}
                  >
                    <span className="text-sm text-gray-200 group-hover:text-white">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : currentConditionalStep ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-300">{currentConditionalStep.question}</p>

            {currentConditionalStep.type === 'single' ? (
              <div className="space-y-2">
                {currentConditionalStep.options.map((option) => {
                  const selected = answers[currentConditionalStep.field] === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={saving}
                      onClick={() => handleSingleSelect(currentConditionalStep, option.value)}
                      className={`${optionButtonClass} ${selected ? optionButtonSelectedClass : ''}`}
                      aria-pressed={selected}
                    >
                      <span className="text-sm text-gray-200 group-hover:text-white">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {currentConditionalStep.options.map((option) => {
                    const selected = ((answers[currentConditionalStep.field] as string[] | undefined) ?? []).includes(
                      option.value
                    );
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={saving}
                        onClick={() => toggleMultiValue(currentConditionalStep, option.value)}
                        className={`${optionButtonClass} ${selected ? optionButtonSelectedClass : ''}`}
                        aria-pressed={selected}
                      >
                        <span className="text-sm text-gray-200 group-hover:text-white">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleMultiContinue(currentConditionalStep)}
                  className="w-full rounded-xl bg-[#FF5A1F] text-white text-sm font-medium py-2.5 hover:bg-[#e64f18] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continuer
                </button>
              </>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={handleSkip}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
              >
                Passer
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleFinishNow}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
              >
                Terminer maintenant
              </button>
            </div>
          </div>
        ) : null}

        <p className="mt-6 text-center text-xs text-gray-600">
          {currentStepNumber} / {totalSteps}
        </p>
      </div>
    </div>
  );
}

export default AgentOnboarding;
