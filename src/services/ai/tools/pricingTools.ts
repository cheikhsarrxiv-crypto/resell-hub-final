import { z } from 'zod';
import { PricingService } from '@/services/pricing/PricingService';
import { AgentToolDefinition } from './types';

const additionalCostSchema = z.object({
  type: z.string().min(1).max(50),
  amount: z.number().min(0),
  currency: z.string().length(3),
  source: z.enum(['known', 'estimated']).optional(),
  description: z.string().max(200).optional(),
});

const calculateMarginInputSchema = z.object({
  purchasePrice: z.number().min(0),
  purchaseCurrency: z.string().length(3),
  purchasePriceSource: z.enum(['known', 'estimated']).optional(),
  targetCurrency: z.string().length(3),
  resalePrice: z.number().min(0).optional(),
  resaleCurrency: z.string().length(3).optional(),
  marketplace: z.string().max(50).optional(),
  additionalCosts: z.array(additionalCostSchema).max(20).optional(),
});

export const calculateMarginTool: AgentToolDefinition<z.infer<typeof calculateMarginInputSchema>> = {
  name: 'calculate_margin',
  description:
    'Deterministically calculates cost, net profit, margin (amount and %), and ROI from real inputs — NEVER computed by the model itself. ' +
    'Every cost line is tagged "known" or "estimated" and currency-converted only when a real rate is available; anything that cannot be resolved ' +
    '(unknown currency pair, unconfigured marketplace fee, missing resale price) is reported in missingData/warnings, never silently treated as zero. ' +
    'A marketplace fee is either an exact figure from the marketplace\'s own API (rare, only when configured for this workspace), an estimate from a ' +
    'configured fee schedule (tagged "estimated", not a live per-transaction figure), or entirely unknown (present in missingData) — if it is unknown, ' +
    'say explicitly that marketplace fees are not included and the shown total/margin is before that fee, never state or imply a marketplace fee of 0. ' +
    'If missingData is non-empty, say so plainly and ask for what is missing instead of presenting the numbers as complete. ' +
    'If isEstimate is true, tell the user the result relies on an estimate or a non-live exchange rate, never present it as an exact fact.',
  category: 'read',
  inputSchema: calculateMarginInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      purchasePrice: { type: 'number', description: 'The purchase price, in purchaseCurrency.' },
      purchaseCurrency: { type: 'string', description: 'ISO 4217 code of the purchase price, e.g. "GBP".' },
      purchasePriceSource: { type: 'string', enum: ['known', 'estimated'], description: 'Whether purchasePrice is a real known figure or your own estimate. Defaults to "known".' },
      targetCurrency: { type: 'string', description: 'ISO 4217 code to compute and report everything in, e.g. "EUR".' },
      resalePrice: { type: 'number', description: 'Expected resale price, if known. Without it, only the cost side is calculated.' },
      resaleCurrency: { type: 'string', description: 'ISO 4217 code of resalePrice. Defaults to targetCurrency if omitted.' },
      marketplace: { type: 'string', description: 'Marketplace the item would be resold on, e.g. "ebay" — used to look up a configured marketplace fee, if one exists.' },
      additionalCosts: {
        type: 'array',
        description: 'Other known or estimated costs: purchase shipping, customs/duty, payment processing, fulfillment cost, etc.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'e.g. "purchase_shipping", "customs_duty", "payment_fee", "fulfillment_cost".' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            source: { type: 'string', enum: ['known', 'estimated'] },
            description: { type: 'string' },
          },
        },
      },
    },
    required: ['purchasePrice', 'purchaseCurrency', 'targetCurrency'],
  },
  async handler(workspaceId, input) {
    // Pure deterministic math over its input, plus (Phase 7) the
    // session-derived workspaceId — NEVER accepted from `input` itself
    // (calculateMarginInputSchema has no workspaceId field the model
    // could set). Used only to look up a per-workspace exact marketplace
    // fee provider if one is ever registered; today none is, so this has
    // no effect on the result (see PricingService.calculateMargin's own
    // comment and the "workspace-safe" test in pricingTools.test.ts,
    // which still holds). Awaited: Étape 4 made calculateMargin async (a
    // real FX provider can make a network call).
    return await PricingService.calculateMargin({ ...input, workspaceId });
  },
};
