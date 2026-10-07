/**
 * AI Agent Personalization V1 — pure logic tests for
 * src/lib/ai/agentProfile.ts (Zod validation, <user_profile> prompt
 * formatting, conditional onboarding question flow). No jsdom/
 * @testing-library needed — same convention as agentConversation.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  agentProfileInputSchema,
  formatAgentProfileForPrompt,
  getOnboardingStepsForUsageType,
  getUsageTypeStep,
  recordToProfileInput,
  type AgentProfileRecord,
} from '@/lib/ai/agentProfile';

function makeRecord(overrides: Partial<AgentProfileRecord> = {}): AgentProfileRecord {
  return {
    usageType: 'resell',
    budgetRange: null,
    customBudgetEur: null,
    sellingPlatforms: [],
    preferredCategories: [],
    monthlyGoal: null,
    priority: null,
    qualityVsPrice: null,
    ...overrides,
  };
}

describe('agentProfileInputSchema', () => {
  it('accepts usageType alone — every other field stays optional', () => {
    const result = agentProfileInputSchema.safeParse({ usageType: 'resell' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing usageType', () => {
    const result = agentProfileInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects an unknown usageType value', () => {
    const result = agentProfileInputSchema.safeParse({ usageType: 'reseller' }); // typo, not a real enum value
    expect(result.success).toBe(false);
  });

  it('accepts a fully-filled resell profile', () => {
    const result = agentProfileInputSchema.safeParse({
      usageType: 'resell',
      budgetRange: '50_100',
      sellingPlatforms: ['vinted', 'ebay'],
      preferredCategories: ['sneakers'],
      monthlyGoal: '3000',
      priority: 'margin',
    });
    expect(result.success).toBe(true);
  });

  it('accepts budgetRange "custom" with customBudgetEur', () => {
    const result = agentProfileInputSchema.safeParse({ usageType: 'personal', budgetRange: 'custom', customBudgetEur: 75 });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown platform/category value (never silently accepted)', () => {
    expect(agentProfileInputSchema.safeParse({ usageType: 'resell', sellingPlatforms: ['depop'] }).success).toBe(false);
    expect(agentProfileInputSchema.safeParse({ usageType: 'resell', preferredCategories: ['furniture'] }).success).toBe(false);
  });

  it('rejects a negative customBudgetEur', () => {
    expect(agentProfileInputSchema.safeParse({ usageType: 'personal', customBudgetEur: -10 }).success).toBe(false);
  });
});

describe('formatAgentProfileForPrompt', () => {
  it('returns an empty string when there is no profile at all — prompt stays byte-for-byte unchanged', () => {
    expect(formatAgentProfileForPrompt(null)).toBe('');
    expect(formatAgentProfileForPrompt(undefined)).toBe('');
  });

  it('wraps the block in <user_profile> tags', () => {
    const block = formatAgentProfileForPrompt(makeRecord({ budgetRange: '50_100' }));
    expect(block).toContain('<user_profile>');
    expect(block).toContain('</user_profile>');
  });

  it('includes only the fields actually set, never a guessed value for an absent one', () => {
    const block = formatAgentProfileForPrompt(makeRecord({ usageType: 'resell', budgetRange: '50_100' }));
    expect(block).toContain('achat-revente');
    expect(block).toContain('50–100 €');
    expect(block).not.toContain('Plateformes habituelles');
    expect(block).not.toContain('Objectif mensuel');
    expect(block).not.toContain('Priorité');
  });

  it('includes sellingPlatforms and preferredCategories when set', () => {
    const block = formatAgentProfileForPrompt(
      makeRecord({ sellingPlatforms: ['vinted', 'ebay'], preferredCategories: ['sneakers', 'clothing'] })
    );
    expect(block).toContain('vinted, ebay');
    expect(block).toContain('sneakers, clothing');
  });

  it('never mentions a numeric minPrice/maxPrice and explicitly forbids deriving one — the core anti-invention guarantee', () => {
    const block = formatAgentProfileForPrompt(makeRecord({ budgetRange: '50_100' }));
    expect(block).not.toMatch(/maxPrice\s*[:=]\s*\d/);
    expect(block).not.toMatch(/minPrice\s*[:=]\s*\d/);
    expect(block.toLowerCase()).toContain('jamais');
  });

  it('explicitly states the current request always wins over the profile', () => {
    const block = formatAgentProfileForPrompt(makeRecord({ budgetRange: '50_100' }));
    expect(block.toLowerCase()).toContain('la demande actuelle');
    expect(block.toLowerCase()).toContain('priorité');
  });

  it('formats a "custom" budget with its real amount', () => {
    const block = formatAgentProfileForPrompt(makeRecord({ budgetRange: 'custom', customBudgetEur: 75 }));
    expect(block).toContain('75 € (personnalisé)');
  });

  it('a "custom" budgetRange with no customBudgetEur is simply omitted, never a fabricated amount', () => {
    const block = formatAgentProfileForPrompt(makeRecord({ budgetRange: 'custom', customBudgetEur: null }));
    expect(block).not.toContain('Budget habituel');
  });
});

describe('getOnboardingStepsForUsageType — conditional flow', () => {
  it('usageType is always the first, non-skippable question regardless of path', () => {
    const step = getUsageTypeStep();
    expect(step.options.map((o) => o.value)).toEqual(['resell', 'dropshipping', 'personal', 'other']);
  });

  it('resell: includes budget, platforms, categories, monthly goal, and a margin-flavored priority', () => {
    const steps = getOnboardingStepsForUsageType('resell');
    const fields = steps.map((s) => s.field);
    expect(fields).toEqual(['budgetRange', 'sellingPlatforms', 'preferredCategories', 'monthlyGoal', 'priority']);
    const priorityStep = steps.find((s) => s.field === 'priority')!;
    expect(priorityStep.options.map((o) => o.value)).toContain('margin');
  });

  it('dropshipping: platforms are Shopify/WooCommerce/other, never Vinted/eBay/Etsy', () => {
    const steps = getOnboardingStepsForUsageType('dropshipping');
    const platformsStep = steps.find((s) => s.field === 'sellingPlatforms')!;
    const values = platformsStep.options.map((o) => o.value);
    expect(values).toEqual(['shopify', 'woocommerce', 'other']);
    expect(values).not.toContain('vinted');
  });

  it('dropshipping priority includes shipping_ease', () => {
    const steps = getOnboardingStepsForUsageType('dropshipping');
    const priorityStep = steps.find((s) => s.field === 'priority')!;
    expect(priorityStep.options.map((o) => o.value)).toContain('shipping_ease');
  });

  it('personal: NEVER asks for sellingPlatforms, monthlyGoal, or a margin-flavored priority — core privacy/relevance rule', () => {
    const steps = getOnboardingStepsForUsageType('personal');
    const fields = steps.map((s) => s.field);
    expect(fields).not.toContain('sellingPlatforms');
    expect(fields).not.toContain('monthlyGoal');
    expect(fields).not.toContain('priority');
  });

  it('personal: asks only categories ("ce que tu recherches"), budget, and quality-vs-price', () => {
    const steps = getOnboardingStepsForUsageType('personal');
    expect(steps.map((s) => s.field)).toEqual(['preferredCategories', 'budgetRange', 'qualityVsPrice']);
  });

  it('"other": the shortest possible path — a single optional budget question', () => {
    const steps = getOnboardingStepsForUsageType('other');
    expect(steps).toHaveLength(1);
    expect(steps[0].field).toBe('budgetRange');
  });

  it('every conditional step is skippable', () => {
    for (const usageType of ['resell', 'dropshipping', 'personal', 'other'] as const) {
      for (const step of getOnboardingStepsForUsageType(usageType)) {
        expect(step.skippable).toBe(true);
      }
    }
  });
});

describe('recordToProfileInput', () => {
  it('maps nulls to undefined (the onboarding input shape), never a fabricated default', () => {
    const input = recordToProfileInput(makeRecord({ usageType: 'personal' }));
    expect(input.budgetRange).toBeUndefined();
    expect(input.sellingPlatforms).toBeUndefined();
    expect(input.usageType).toBe('personal');
  });

  it('preserves real values, including non-empty arrays', () => {
    const input = recordToProfileInput(makeRecord({ budgetRange: '50_100', preferredCategories: ['sneakers'] }));
    expect(input.budgetRange).toBe('50_100');
    expect(input.preferredCategories).toEqual(['sneakers']);
  });
});
