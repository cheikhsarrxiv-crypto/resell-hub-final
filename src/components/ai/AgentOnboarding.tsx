'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
 *
 * UI/UX note (V2 visual refresh): renders as an immersive, one-
 * question-at-a-time questionnaire — progress bar, previous-question
 * nav, a welcome line shown only on the very first step, a small
 * category eyebrow per question, staggered reveal, direction-aware
 * slide between questions, and single-choice answers that auto-advance
 * (no "Continuer" click needed — only multi-select keeps that button).
 * All purely presentational. The question flow, conditional steps,
 * skip/finish/edit/save behavior are all unchanged from the original
 * implementation; only how each step is displayed and transitioned is
 * new. No animation library is used — CSS keyframes in globals.css
 * (agent-onb-*), same convention as dash-reveal/agent-example-fade,
 * respecting prefers-reduced-motion (instant, no stagger, no pause).
 * The surrounding Agent page header and the mobile bottom nav are also
 * hidden while this is showing — CSS-only, via globals.css (see the
 * "onboarding dedicated flow chrome" rules there); neither is touched
 * from this file.
 */

interface AgentOnboardingProps {
  onComplete: () => void;
  /** Set when reopened from Settings to edit an existing profile —
   * pre-fills every answer and starts past the usageType step. Omitted
   * (first-time onboarding): starts from scratch. */
  initialAnswers?: AgentProfileInput | null;
}

const optionButtonClass =
  'group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4 text-left transition-all motion-safe:duration-150 hover:border-[#FF5A1F]/40 hover:bg-[#FF5A1F]/[0.06] motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60 w-full';
const optionButtonSelectedClass = '!border-[#FF5A1F]/60 !bg-[#FF5A1F]/[0.1]';

/** Small "category" eyebrow shown above each question — purely a visual
 * label, keyed off the step's field (never sent to the API, never part
 * of AgentProfileInput). Falls back to a generic label for any step
 * this map doesn't know about so a future added step never renders
 * blank. */
const STEP_CATEGORY_LABELS: Partial<Record<keyof AgentProfileInput, string>> = {
  budgetRange: 'BUDGET',
  sellingPlatforms: 'TES CANAUX DE VENTE',
  preferredCategories: 'TES PRODUITS',
  monthlyGoal: 'TON OBJECTIF',
  priority: 'TA PRIORITÉ',
  qualityVsPrice: 'TA PRÉFÉRENCE',
};
const USAGE_TYPE_CATEGORY_LABEL = 'TON PROFIL';
const DEFAULT_CATEGORY_LABEL = 'TES PRÉFÉRENCES';

/** How long the outgoing question's exit animation runs before the next
 * one is actually mounted — see navigateTo. Skipped entirely under
 * prefers-reduced-motion (the step change is then instant). */
const STEP_EXIT_MS = 120;

/** For a single-choice answer only: how long the card stays visibly
 * selected (Signal orange) before auto-advancing — single-select never
 * needs a "Continuer" click, the selection itself is the confirmation.
 * Skipped entirely under prefers-reduced-motion (advances immediately,
 * no artificial delay). Multi-select is unaffected — it still advances
 * only via its own explicit "Continuer" button. */
const SELECT_PAUSE_MS = 350;

export function AgentOnboarding({ onComplete, initialAnswers = null }: AgentOnboardingProps) {
  const [answers, setAnswers] = useState<AgentProfileInput>(
    initialAnswers ?? ({ usageType: undefined as unknown as AgentUsageType })
  );
  // Always starts at the usageType step, even when editing an existing
  // profile — usageType itself must stay editable, like every other
  // field (a reseller who pivots to dropshipping must be able to change
  // it, not just the fields conditional on it).
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [transitioning, setTransitioning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reducedMotion, setReducedMotion] = useState(false);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handleChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    return () => {
      if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current);
    };
  }, []);

  const conditionalSteps = useMemo<AgentOnboardingStep[]>(
    () => (answers.usageType ? getOnboardingStepsForUsageType(answers.usageType) : []),
    [answers.usageType]
  );

  const totalSteps = 1 + conditionalSteps.length;
  const currentStepNumber = stepIndex + 1;

  /** Moves to a new step with a short direction-aware slide: the current
   * question animates out first, then the next one mounts and animates
   * in (never an instant content swap). Under prefers-reduced-motion the
   * step changes immediately, no delay, no animation. */
  const navigateTo = (nextIndex: number, dir: 'forward' | 'backward') => {
    setDirection(dir);
    if (reducedMotion) {
      setStepIndex(nextIndex);
      return;
    }
    setTransitioning(true);
    navTimeoutRef.current = setTimeout(() => {
      setStepIndex(nextIndex);
      setTransitioning(false);
    }, STEP_EXIT_MS);
  };

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

  /** Single-choice selection path: sets the answer (so the card shows its
   * selected state right away), then after a short pause either moves on
   * or saves — never requires a "Continuer" click. Multi-select keeps
   * its own explicit button (see handleMultiContinue/advanceOrFinish)
   * since several choices may still be pending. */
  const advanceOrFinishAfterSelect = (nextAnswers: AgentProfileInput, nextIndex: number, isLast: boolean) => {
    setAnswers(nextAnswers);
    const run = () => {
      if (isLast) {
        save(nextAnswers);
      } else {
        navigateTo(nextIndex, 'forward');
      }
    };
    if (reducedMotion) {
      run();
    } else {
      navTimeoutRef.current = setTimeout(run, SELECT_PAUSE_MS);
    }
  };

  const handleUsageTypeSelect = (usageType: AgentUsageType) => {
    if (transitioning || saving) return;
    // Genuinely changing usage type (e.g. resell -> personal) starts a
    // clean slate — the previous conditional answers (platforms, monthly
    // goal, a margin-flavored priority...) don't apply to the new path
    // and must never be silently carried over/saved under it. Re-
    // confirming the SAME usage type (editing an existing profile,
    // clicking straight through) preserves every already-loaded answer
    // instead of wiping it.
    const nextAnswers = answers.usageType && answers.usageType !== usageType ? { usageType } : { ...answers, usageType };
    // Picking a usage type always lands on step 1 next — every usageType
    // has at least one conditional step (see getOnboardingStepsForUsageType),
    // so this is never the final step.
    advanceOrFinishAfterSelect(nextAnswers, 1, false);
  };

  const advanceOrFinish = (nextAnswers: AgentProfileInput) => {
    setAnswers(nextAnswers);
    if (stepIndex + 1 >= totalSteps) {
      save(nextAnswers);
    } else {
      navigateTo(stepIndex + 1, 'forward');
    }
  };

  const handleSingleSelect = (step: AgentOnboardingStep, value: string) => {
    if (transitioning || saving) return;
    const nextAnswers = { ...answers, [step.field]: value } as AgentProfileInput;
    advanceOrFinishAfterSelect(nextAnswers, stepIndex + 1, stepIndex + 1 >= totalSteps);
  };

  const handleMultiContinue = (step: AgentOnboardingStep) => {
    if (transitioning || saving) return;
    advanceOrFinish(answers);
  };

  const handleSkip = () => {
    if (transitioning || saving) return;
    if (stepIndex + 1 >= totalSteps) {
      save(answers);
    } else {
      navigateTo(stepIndex + 1, 'forward');
    }
  };

  const handleFinishNow = () => {
    if (saving) return;
    save(answers);
  };

  const handleBack = () => {
    if (stepIndex === 0 || transitioning || saving) return;
    navigateTo(stepIndex - 1, 'backward');
  };

  const toggleMultiValue = (step: AgentOnboardingStep, value: string) => {
    const current = (answers[step.field] as string[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setAnswers({ ...answers, [step.field]: next } as AgentProfileInput);
  };

  const currentConditionalStep = stepIndex >= 1 ? conditionalSteps[stepIndex - 1] : undefined;

  const stepClass = transitioning
    ? direction === 'forward'
      ? 'agent-onb-exit-forward'
      : 'agent-onb-exit-backward'
    : direction === 'forward'
      ? 'agent-onb-enter-forward'
      : 'agent-onb-enter-backward';

  const interactionDisabled = saving || transitioning;

  return (
    <div className="agent-onboarding-root flex-1 flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
      <div className="max-w-md w-full">
        <div className="mb-5">
          <div
            className="h-1 w-full rounded-full bg-white/[0.08] overflow-hidden"
            role="progressbar"
            aria-valuenow={currentStepNumber}
            aria-valuemin={1}
            aria-valuemax={totalSteps}
            aria-label="Progression du questionnaire"
          >
            <div
              className="h-full rounded-full bg-[#FF5A1F] agent-onb-progress-fill"
              style={{ width: `${Math.round((currentStepNumber / totalSteps) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-right text-[11px] text-gray-600">
            {currentStepNumber} / {totalSteps}
          </p>
        </div>

        {stepIndex > 0 && (
          <button
            type="button"
            onClick={handleBack}
            disabled={interactionDisabled}
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60 rounded-md"
          >
            <span aria-hidden="true">←</span> Question précédente
          </button>
        )}

        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-300 px-4 py-3 rounded-lg text-sm" role="alert">
            {error}
          </div>
        )}

        <div key={stepIndex} className={stepClass}>
          {stepIndex === 0 ? (
            <div className="space-y-3">
              <div className="agent-onb-category mb-1">
                <p className="text-sm font-semibold text-white">Bienvenue dans ton Agent IA 👋</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Pour mieux t&apos;aider, j&apos;ai quelques petites questions. Tu peux en passer autant que tu veux.
                </p>
              </div>
              <p
                className="agent-onb-category text-[11px] font-semibold uppercase tracking-wider text-[#FF5A1F]"
                style={{ animationDelay: '0.06s' }}
              >
                {USAGE_TYPE_CATEGORY_LABEL}
              </p>
              <p
                className="agent-onb-question text-base sm:text-lg font-semibold text-white"
                style={{ fontFamily: 'var(--font-display)', animationDelay: '0.11s' }}
              >
                {getUsageTypeStep().question}
              </p>
              <div className="space-y-2 pt-1">
                {getUsageTypeStep().options.map((option, i) => {
                  const selected = answers.usageType === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={interactionDisabled}
                      onClick={() => handleUsageTypeSelect(option.value as AgentUsageType)}
                      className={`${optionButtonClass} agent-onb-card ${selected ? optionButtonSelectedClass : ''}`}
                      style={{ animationDelay: `${0.16 + i * 0.04}s` }}
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
              <p className="agent-onb-category text-[11px] font-semibold uppercase tracking-wider text-[#FF5A1F]">
                {STEP_CATEGORY_LABELS[currentConditionalStep.field] ?? DEFAULT_CATEGORY_LABEL}
              </p>
              <p
                className="agent-onb-question text-base sm:text-lg font-semibold text-white"
                style={{ fontFamily: 'var(--font-display)', animationDelay: '0.05s' }}
              >
                {currentConditionalStep.question}
              </p>

              {currentConditionalStep.type === 'single' ? (
                <div className="space-y-2 pt-1">
                  {currentConditionalStep.options.map((option, i) => {
                    const selected = answers[currentConditionalStep.field] === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={interactionDisabled}
                        onClick={() => handleSingleSelect(currentConditionalStep, option.value)}
                        className={`${optionButtonClass} agent-onb-card ${selected ? optionButtonSelectedClass : ''}`}
                        style={{ animationDelay: `${0.1 + i * 0.04}s` }}
                        aria-pressed={selected}
                      >
                        <span className="text-sm text-gray-200 group-hover:text-white">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {currentConditionalStep.options.map((option, i) => {
                      const selected = ((answers[currentConditionalStep.field] as string[] | undefined) ?? []).includes(
                        option.value
                      );
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={interactionDisabled}
                          onClick={() => toggleMultiValue(currentConditionalStep, option.value)}
                          className={`${optionButtonClass} agent-onb-card ${selected ? optionButtonSelectedClass : ''}`}
                          style={{ animationDelay: `${0.1 + i * 0.04}s` }}
                          aria-pressed={selected}
                        >
                          <span className="text-sm text-gray-200 group-hover:text-white">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={interactionDisabled}
                    onClick={() => handleMultiContinue(currentConditionalStep)}
                    className="agent-onb-card w-full rounded-xl bg-[#FF5A1F] text-white text-sm font-medium py-3 hover:bg-[#e64f18] motion-safe:transition-all motion-safe:duration-150 motion-safe:active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60"
                    style={{ animationDelay: `${0.1 + currentConditionalStep.options.length * 0.04 + 0.04}s` }}
                  >
                    Continuer
                  </button>
                </>
              )}

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  disabled={interactionDisabled}
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
        </div>
      </div>
    </div>
  );
}

export default AgentOnboarding;
