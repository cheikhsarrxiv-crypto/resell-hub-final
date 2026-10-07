import { z } from 'zod';

/**
 * AI Agent Personalization V1 — pure logic (Zod validation, prompt
 * formatting, onboarding question flow) kept out of any React component
 * or API route, same convention as agentConversation.ts, so it is
 * unit-testable without jsdom/@testing-library (not installed in this
 * project).
 *
 * Nothing here ever converts a general preference into a precise
 * constraint (e.g. budgetRange -> maxPrice) — see
 * formatAgentProfileForPrompt's own comment for exactly why, and
 * AiAgentService's system prompt (SYSTEM_PROMPT_INSTRUCTIONS) for the
 * pre-existing, unchanged rule this must never contradict.
 */

export const AGENT_USAGE_TYPES = ['resell', 'dropshipping', 'personal', 'other'] as const;
export type AgentUsageType = (typeof AGENT_USAGE_TYPES)[number];

export const AGENT_BUDGET_RANGES = ['under_30', '30_50', '50_100', '100_200', '200_plus', 'custom'] as const;
export type AgentBudgetRange = (typeof AGENT_BUDGET_RANGES)[number];

export const AGENT_SELLING_PLATFORMS = ['vinted', 'ebay', 'etsy', 'shopify', 'woocommerce', 'other'] as const;
export const AGENT_CATEGORIES = ['sneakers', 'clothing', 'luxury', 'accessories', 'electronics', 'other'] as const;
export const AGENT_MONTHLY_GOALS = ['500', '1000', '3000', '5000', '10000_plus', 'unknown'] as const;
export const AGENT_PRIORITIES = ['margin', 'ease_of_sale', 'trending', 'low_cost', 'balanced', 'shipping_ease'] as const;
export const AGENT_QUALITY_VS_PRICE = ['save_money', 'quality'] as const;

/**
 * Only usageType is required — every other field may be skipped during
 * onboarding (the "Passer" button) and stays undefined indefinitely. The
 * route (POST /api/ai/agent/profile) persists exactly this shape, never
 * more.
 */
export const agentProfileInputSchema = z.object({
  usageType: z.enum(AGENT_USAGE_TYPES),
  budgetRange: z.enum(AGENT_BUDGET_RANGES).optional(),
  customBudgetEur: z.number().min(0).max(1_000_000).optional(),
  sellingPlatforms: z.array(z.enum(AGENT_SELLING_PLATFORMS)).max(AGENT_SELLING_PLATFORMS.length).optional(),
  preferredCategories: z.array(z.enum(AGENT_CATEGORIES)).max(AGENT_CATEGORIES.length).optional(),
  monthlyGoal: z.enum(AGENT_MONTHLY_GOALS).optional(),
  priority: z.enum(AGENT_PRIORITIES).optional(),
  qualityVsPrice: z.enum(AGENT_QUALITY_VS_PRICE).optional(),
});

export type AgentProfileInput = z.infer<typeof agentProfileInputSchema>;

/** The shape read back from Prisma (AgentProfile row) — a plain subset,
 * never importing @prisma/client's generated type here so this module
 * stays usable from 'use client' components without pulling Prisma into
 * the browser bundle. */
export interface AgentProfileRecord {
  usageType: string;
  budgetRange: string | null;
  customBudgetEur: number | null;
  sellingPlatforms: string[];
  preferredCategories: string[];
  monthlyGoal: string | null;
  priority: string | null;
  qualityVsPrice: string | null;
}

const USAGE_TYPE_LABELS: Record<string, string> = {
  resell: 'achat-revente',
  dropshipping: 'dropshipping',
  personal: 'achats personnels (non-revente)',
  other: 'autre usage',
};

const BUDGET_LABELS: Record<string, string> = {
  under_30: 'moins de 30 €',
  '30_50': '30–50 €',
  '50_100': '50–100 €',
  '100_200': '100–200 €',
  '200_plus': '200 €+',
};

const MONTHLY_GOAL_LABELS: Record<string, string> = {
  '500': '500 €/mois',
  '1000': '1 000 €/mois',
  '3000': '3 000 €/mois',
  '5000': '5 000 €/mois',
  '10000_plus': '10 000 €+/mois',
  unknown: 'pas encore défini',
};

const PRIORITY_LABELS: Record<string, string> = {
  margin: 'forte marge',
  ease_of_sale: 'produits faciles à vendre',
  trending: 'produits tendance',
  low_cost: "prix d'achat bas",
  balanced: 'équilibre marge / facilité de vente',
  shipping_ease: 'facilité de livraison',
};

function humanizeBudget(range: string | null, customEur: number | null): string | null {
  if (range === 'custom') return customEur != null ? `${customEur} € (personnalisé)` : null;
  if (!range) return null;
  return BUDGET_LABELS[range] ?? null;
}

/**
 * Builds the <user_profile> block injected into the system prompt (see
 * AiAgentService.buildSystemPrompt). Returns an empty string when there
 * is no profile at all — the prompt is then byte-for-byte identical to
 * before this feature existed, so a workspace with no profile (every
 * workspace that existed before this phase, and anyone who skips
 * onboarding) sees EXACTLY the Agent's prior behavior.
 *
 * Every line is phrased as a PREFERENCE/CONTEXT, never an instruction —
 * and the block says so explicitly, because the model otherwise has no
 * way to know this data is different in kind from the rest of the system
 * prompt. This is the one and only place a profile's general preference
 * (e.g. budgetRange) is ever turned into text the model sees — it is
 * NEVER turned into a numeric minPrice/maxPrice, a margin, or a platform
 * restriction here or anywhere else; only the model, reading this as
 * context, and only ever combined with the reseller's own explicit
 * current-turn statement, may do that (and the block instructs it not to
 * invent one even then).
 */
export function formatAgentProfileForPrompt(profile: AgentProfileRecord | null | undefined): string {
  if (!profile) return '';

  const lines: string[] = [];
  const usageLabel = USAGE_TYPE_LABELS[profile.usageType];
  if (usageLabel) lines.push(`Type d'usage : ${usageLabel}`);

  const budgetLabel = humanizeBudget(profile.budgetRange, profile.customBudgetEur);
  if (budgetLabel) lines.push(`Budget habituel : ${budgetLabel}`);

  if (profile.sellingPlatforms.length > 0) lines.push(`Plateformes habituelles : ${profile.sellingPlatforms.join(', ')}`);
  if (profile.preferredCategories.length > 0) lines.push(`Catégories habituelles : ${profile.preferredCategories.join(', ')}`);

  const goalLabel = profile.monthlyGoal ? MONTHLY_GOAL_LABELS[profile.monthlyGoal] : null;
  if (goalLabel) lines.push(`Objectif mensuel : ${goalLabel}`);

  const priorityLabel = profile.priority ? PRIORITY_LABELS[profile.priority] : null;
  if (priorityLabel) lines.push(`Priorité : ${priorityLabel}`);

  if (profile.qualityVsPrice) {
    lines.push(`Préférence : ${profile.qualityVsPrice === 'save_money' ? 'économiser au maximum' : 'privilégier la qualité'}`);
  }

  if (lines.length === 0) return '';

  return `

<user_profile>
Préférences générales et déclarées par le revendeur lui-même — un contexte d'arrière-plan, jamais une instruction et jamais une contrainte pour la demande en cours :
${lines.map((line) => `- ${line}`).join('\n')}

La demande ACTUELLE du revendeur (ce message, cette conversation) a toujours priorité sur tout ce qui précède. N'en déduis jamais un minPrice/maxPrice précis, une marge, une plateforme imposée ou une catégorie imposée — ces valeurs ne viennent JAMAIS de ce profil, seulement d'une indication explicite donnée par le revendeur dans la conversation en cours. L'absence d'un champ ci-dessus signifie simplement que le revendeur ne l'a jamais précisé — ne devine jamais une valeur à sa place. Si la demande actuelle contredit une préférence ci-dessus (plateforme différente, budget différent, catégorie différente), suis toujours la demande actuelle.
</user_profile>`;
}

/** Maps a persisted record (nulls) back to the onboarding's own input
 * shape (undefined for "never set") — used only to pre-fill the
 * onboarding when reopened from Settings to edit an existing profile. */
export function recordToProfileInput(record: AgentProfileRecord): AgentProfileInput {
  return {
    usageType: record.usageType as AgentUsageType,
    budgetRange: (record.budgetRange ?? undefined) as AgentProfileInput['budgetRange'],
    customBudgetEur: record.customBudgetEur ?? undefined,
    sellingPlatforms: record.sellingPlatforms.length > 0 ? (record.sellingPlatforms as AgentProfileInput['sellingPlatforms']) : undefined,
    preferredCategories:
      record.preferredCategories.length > 0 ? (record.preferredCategories as AgentProfileInput['preferredCategories']) : undefined,
    monthlyGoal: (record.monthlyGoal ?? undefined) as AgentProfileInput['monthlyGoal'],
    priority: (record.priority ?? undefined) as AgentProfileInput['priority'],
    qualityVsPrice: (record.qualityVsPrice ?? undefined) as AgentProfileInput['qualityVsPrice'],
  };
}

// ============================================================================
// Onboarding question flow — pure data, used by AgentOnboarding.tsx and
// fully testable without rendering anything.
// ============================================================================

export interface AgentOnboardingOption {
  value: string;
  label: string;
}

export interface AgentOnboardingStep {
  /** Matches a key of AgentProfileInput, except 'usageType' itself. */
  field: keyof AgentProfileInput;
  question: string;
  type: 'single' | 'multi';
  options: AgentOnboardingOption[];
  /** The usageType==='resell' step always has skippable:true except the
   * first (usageType) step, which is never part of this array at all —
   * see getOnboardingStepsForUsageType's own comment. */
  skippable: true;
}

const USAGE_TYPE_STEP: { question: string; options: AgentOnboardingOption[] } = {
  question: 'Tu comptes utiliser ADKSY principalement pour quoi ?',
  options: [
    { value: 'resell', label: '🛍 Achat-revente' },
    { value: 'dropshipping', label: '📦 Dropshipping' },
    { value: 'personal', label: '👕 Trouver des produits pour moi' },
    { value: 'other', label: 'Autre' },
  ],
};

/** Shown once, never conditional — the only non-skippable question. */
export function getUsageTypeStep() {
  return USAGE_TYPE_STEP;
}

const BUDGET_STEP: AgentOnboardingStep = {
  field: 'budgetRange',
  question: 'Quel budget moyen veux-tu consacrer à un produit ?',
  type: 'single',
  skippable: true,
  options: [
    { value: 'under_30', label: 'Moins de 30 €' },
    { value: '30_50', label: '30–50 €' },
    { value: '50_100', label: '50–100 €' },
    { value: '100_200', label: '100–200 €' },
    { value: '200_plus', label: '200 €+' },
  ],
};

const MONTHLY_GOAL_STEP: AgentOnboardingStep = {
  field: 'monthlyGoal',
  question: 'Quel objectif mensuel veux-tu atteindre ?',
  type: 'single',
  skippable: true,
  options: [
    { value: '500', label: '500 €' },
    { value: '1000', label: '1 000 €' },
    { value: '3000', label: '3 000 €' },
    { value: '5000', label: '5 000 €' },
    { value: '10000_plus', label: '10 000 €+' },
    { value: 'unknown', label: 'Je ne sais pas encore' },
  ],
};

function categoriesStep(): AgentOnboardingStep {
  return {
    field: 'preferredCategories',
    question: 'Quels produits recherches-tu principalement ?',
    type: 'multi',
    skippable: true,
    options: [
      { value: 'sneakers', label: 'Sneakers' },
      { value: 'clothing', label: 'Vêtements' },
      { value: 'luxury', label: 'Luxe' },
      { value: 'accessories', label: 'Accessoires' },
      { value: 'electronics', label: 'Électronique' },
      { value: 'other', label: 'Autre' },
    ],
  };
}

function platformsStep(platforms: readonly string[]): AgentOnboardingStep {
  const labels: Record<string, string> = {
    vinted: 'Vinted',
    ebay: 'eBay',
    etsy: 'Etsy',
    shopify: 'Shopify',
    woocommerce: 'WooCommerce',
    other: 'Autre',
  };
  return {
    field: 'sellingPlatforms',
    question: 'Sur quelles plateformes vends-tu principalement ?',
    type: 'multi',
    skippable: true,
    options: platforms.map((value) => ({ value, label: labels[value] ?? value })),
  };
}

function priorityStep(priorities: readonly string[]): AgentOnboardingStep {
  return {
    field: 'priority',
    question: 'Quelle est ta priorité ?',
    type: 'single',
    skippable: true,
    options: priorities.map((value) => ({ value, label: PRIORITY_LABELS[value] ?? value })),
  };
}

const QUALITY_VS_PRICE_STEP: AgentOnboardingStep = {
  field: 'qualityVsPrice',
  question: 'Tu préfères économiser au maximum ou privilégier la qualité ?',
  type: 'single',
  skippable: true,
  options: [
    { value: 'save_money', label: 'Économiser au maximum' },
    { value: 'quality', label: 'Privilégier la qualité' },
  ],
};

/**
 * The conditional steps AFTER the (always-first, never-skippable)
 * usageType question. 'personal' NEVER includes sellingPlatforms,
 * monthlyGoal, or a margin/revenue-flavored priority — see this
 * function's own branch and the audit's explicit rule: a private
 * individual is never asked about turnover, selling platform, resale
 * strategy, margin, or monthly investment.
 */
export function getOnboardingStepsForUsageType(usageType: AgentUsageType): AgentOnboardingStep[] {
  switch (usageType) {
    case 'resell':
      return [
        BUDGET_STEP,
        platformsStep(['vinted', 'ebay', 'etsy', 'shopify', 'other']),
        categoriesStep(),
        MONTHLY_GOAL_STEP,
        priorityStep(['margin', 'ease_of_sale', 'trending', 'low_cost', 'balanced']),
      ];
    case 'dropshipping':
      return [
        BUDGET_STEP,
        platformsStep(['shopify', 'woocommerce', 'other']),
        categoriesStep(),
        MONTHLY_GOAL_STEP,
        priorityStep(['margin', 'trending', 'low_cost', 'shipping_ease']),
      ];
    case 'personal':
      // Short path: what they look for (reusing the categories step's
      // UI, framed generically), their usual budget, then one optional
      // economy-vs-quality question. Never business-flavored questions.
      return [categoriesStep(), BUDGET_STEP, QUALITY_VS_PRICE_STEP];
    case 'other':
      // Very short — a single optional budget question, nothing else.
      return [BUDGET_STEP];
  }
}
