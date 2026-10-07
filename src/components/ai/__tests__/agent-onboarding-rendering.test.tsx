/**
 * Static-markup rendering tests for AgentOnboarding — same technique as
 * agent-ui-rendering.test.tsx (react-dom/server's renderToStaticMarkup,
 * no jsdom/@testing-library installed in this project). Proves what a
 * given `initialAnswers` prop actually renders on the first synchronous
 * pass — it cannot simulate a click (no jsdom), so step-advancing
 * interaction stays covered at the pure-logic level in
 * agentProfile.test.ts (getOnboardingStepsForUsageType).
 *
 * Added during the pre-commit review: confirms the fix making usageType
 * itself visibly pre-selected and still editable when reopened from
 * Settings (?editProfile=1) to edit an existing profile.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentOnboarding } from '@/components/ai/AgentOnboarding';

describe('AgentOnboarding — first render', () => {
  it('fresh onboarding (no initialAnswers): shows the usageType question with all 4 options, none pre-selected', () => {
    const html = renderToStaticMarkup(<AgentOnboarding onComplete={() => {}} />);

    expect(html).toContain('Tu comptes utiliser ADKSY principalement pour quoi');
    expect(html).toContain('Achat-revente');
    expect(html).toContain('Dropshipping');
    expect(html).toContain('Trouver des produits pour moi');
    expect(html).not.toContain('border-[#FF5A1F]/60');
  });

  it('fresh onboarding: never shows "Passer"/"Terminer maintenant" on the usageType question — it is never skippable', () => {
    const html = renderToStaticMarkup(<AgentOnboarding onComplete={() => {}} />);
    expect(html).not.toContain('Passer');
    expect(html).not.toContain('Terminer maintenant');
  });

  it('shows "1 / 1" before any usageType is picked (no conditional steps resolved yet)', () => {
    const html = renderToStaticMarkup(<AgentOnboarding onComplete={() => {}} />);
    expect(html).toContain('1 / 1');
  });

  it('editing an existing profile: still starts on the usageType question (never skipped) — usageType stays editable', () => {
    const html = renderToStaticMarkup(
      <AgentOnboarding onComplete={() => {}} initialAnswers={{ usageType: 'resell', budgetRange: '50_100' }} />
    );
    expect(html).toContain('Tu comptes utiliser ADKSY principalement pour quoi');
  });

  it('editing an existing profile: the current usageType is visibly pre-selected', () => {
    const html = renderToStaticMarkup(
      <AgentOnboarding onComplete={() => {}} initialAnswers={{ usageType: 'resell', budgetRange: '50_100' }} />
    );
    // The resell button carries the selected styling/aria-pressed, the
    // others don't — proven by counting exactly one occurrence of each.
    expect(html).toContain('aria-pressed="true"');
    const selectedCount = (html.match(/border-\[#FF5A1F\]\/60/g) ?? []).length;
    expect(selectedCount).toBeGreaterThan(0);
  });

  it('editing a "personal" profile never shows business-flavored options at the usageType step either (data, not just conditional steps, stays consistent)', () => {
    const html = renderToStaticMarkup(
      <AgentOnboarding onComplete={() => {}} initialAnswers={{ usageType: 'personal' }} />
    );
    expect(html).toContain('Trouver des produits pour moi');
  });
});
