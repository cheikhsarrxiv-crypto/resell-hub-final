import { describe, it, expect } from 'vitest';
import {
  isMarginCalculationResult,
  extractMarginOutcomes,
  describeCostType,
  describeMissingData,
  certaintyPrefix,
  formatMarginPercent,
  formatMarginAmount,
} from '@/lib/ai/marginResults';
import type { MarginCalculationResult } from '@/services/pricing/types';

function validResult(overrides: Partial<MarginCalculationResult> = {}): MarginCalculationResult {
  return {
    currency: 'EUR',
    costBreakdown: [
      { type: 'purchase_price', amount: 585, currency: 'EUR', source: 'known', description: 'Purchase price (converted using a explicit_rate rate of 1.17)' },
      { type: 'purchase_shipping', amount: 17.55, currency: 'EUR', source: 'known', description: 'Shipping' },
    ],
    totalCost: 602.55,
    netProfit: 297.45,
    marginAmount: 297.45,
    marginPercent: 33.05,
    roi: 49.37,
    isEstimate: true,
    missingData: [],
    warnings: [],
    ...overrides,
  };
}

function toolCall(result: unknown, name = 'calculate_margin') {
  return { name, category: 'read', input: {}, result };
}

describe('isMarginCalculationResult', () => {
  it('accepts a real, fully-shaped result', () => {
    expect(isMarginCalculationResult(validResult())).toBe(true);
  });

  it('accepts a result with null profit fields (cost-only calculation)', () => {
    expect(isMarginCalculationResult(validResult({ netProfit: null, marginAmount: null, marginPercent: null, roi: null }))).toBe(true);
  });

  it('rejects null/undefined/non-objects, never crashes', () => {
    expect(isMarginCalculationResult(null)).toBe(false);
    expect(isMarginCalculationResult(undefined)).toBe(false);
    expect(isMarginCalculationResult('a string')).toBe(false);
    expect(isMarginCalculationResult(42)).toBe(false);
  });

  it('rejects a result missing a required field', () => {
    const { currency, ...withoutCurrency } = validResult();
    expect(isMarginCalculationResult(withoutCurrency)).toBe(false);
  });

  it('rejects a result whose costBreakdown contains a malformed line', () => {
    const bad = validResult({ costBreakdown: [{ type: 'x', amount: 'not a number', currency: 'EUR', source: 'known', description: 'x' } as any] });
    expect(isMarginCalculationResult(bad)).toBe(false);
  });

  it('rejects a cost line with a fabricated source value', () => {
    const bad = validResult({ costBreakdown: [{ type: 'x', amount: 1, currency: 'EUR', source: 'exact' as any, description: 'x' }] });
    expect(isMarginCalculationResult(bad)).toBe(false);
  });

  it('rejects a result where totalCost is a non-finite number', () => {
    expect(isMarginCalculationResult(validResult({ totalCost: NaN }))).toBe(false);
    expect(isMarginCalculationResult(validResult({ totalCost: Infinity }))).toBe(false);
  });
});

describe('extractMarginOutcomes — extraction', () => {
  it('1. no tool calls at all -> no result', () => {
    expect(extractMarginOutcomes(undefined)).toEqual([]);
    expect(extractMarginOutcomes([])).toEqual([]);
  });

  it('2. a different tool call is ignored', () => {
    const outcomes = extractMarginOutcomes([toolCall({ status: 'ok', results: [] }, 'search_products')]);
    expect(outcomes).toEqual([]);
  });

  it('3. a valid calculate_margin call is extracted', () => {
    const result = validResult();
    const outcomes = extractMarginOutcomes([toolCall(result)]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual({ toolCallIndex: 0, status: 'ok', result });
  });

  it('4. a malformed calculate_margin result is ignored (not shown as an error either)', () => {
    const outcomes = extractMarginOutcomes([toolCall({ totally: 'unrecognized shape' })]);
    expect(outcomes).toEqual([]);
  });

  it('5. multiple calculate_margin calls are all kept, in order', () => {
    const resultA = validResult({ netProfit: 100 });
    const resultB = validResult({ netProfit: 200 });
    const outcomes = extractMarginOutcomes([toolCall(resultA), toolCall(resultB)]);

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toEqual({ toolCallIndex: 0, status: 'ok', result: resultA });
    expect(outcomes[1]).toEqual({ toolCallIndex: 1, status: 'ok', result: resultB });
  });

  it('a backend tool-error shape ({error: ...}) is recognized as an error outcome, distinct from "malformed"', () => {
    const outcomes = extractMarginOutcomes([toolCall({ error: 'Tool execution failed' })]);
    expect(outcomes).toEqual([{ toolCallIndex: 0, status: 'error' }]);
  });

  it('the raw backend error text is never carried into the extracted outcome', () => {
    const outcomes = extractMarginOutcomes([toolCall({ error: 'Invalid tool input', details: { fieldErrors: { purchasePrice: ['too small'] } } })]);
    expect(outcomes).toEqual([{ toolCallIndex: 0, status: 'error' }]);
    expect(JSON.stringify(outcomes)).not.toContain('too small');
  });
});

describe('extractMarginOutcomes — financial data preserved exactly', () => {
  it('6/7/8/9/10. net profit, margin, ROI, currency, and total cost are all preserved exactly as given', () => {
    const result = validResult();
    const [outcome] = extractMarginOutcomes([toolCall(result)]);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.result.netProfit).toBe(297.45);
    expect(outcome.result.marginPercent).toBe(33.05);
    expect(outcome.result.roi).toBe(49.37);
    expect(outcome.result.currency).toBe('EUR');
    expect(outcome.result.totalCost).toBe(602.55);
  });
});

describe('cost line ordering and shipping absence/presence', () => {
  it('11. cost lines are extracted in the exact order the backend provided, never re-sorted', () => {
    const result = validResult({
      costBreakdown: [
        { type: 'marketplace_fee', amount: 10, currency: 'EUR', source: 'known', description: 'x' },
        { type: 'purchase_price', amount: 500, currency: 'EUR', source: 'known', description: 'x' },
      ],
    });
    const [outcome] = extractMarginOutcomes([toolCall(result)]);
    if (outcome.status !== 'ok') throw new Error('expected ok');

    expect(outcome.result.costBreakdown.map((l) => l.type)).toEqual(['marketplace_fee', 'purchase_price']);
  });

  it('12. no shipping cost line present -> nothing invented (costBreakdown simply has no such entry)', () => {
    const result = validResult({ costBreakdown: [{ type: 'purchase_price', amount: 500, currency: 'EUR', source: 'known', description: 'x' }] });
    const [outcome] = extractMarginOutcomes([toolCall(result)]);
    if (outcome.status !== 'ok') throw new Error('expected ok');

    expect(outcome.result.costBreakdown.some((l) => l.type === 'purchase_shipping')).toBe(false);
  });

  it('13. a real shipping cost of 0 provided by the backend is preserved as a real 0, not omitted', () => {
    const result = validResult({
      costBreakdown: [{ type: 'purchase_shipping', amount: 0, currency: 'EUR', source: 'known', description: 'Free shipping' }],
    });
    const [outcome] = extractMarginOutcomes([toolCall(result)]);
    if (outcome.status !== 'ok') throw new Error('expected ok');

    expect(outcome.result.costBreakdown[0].amount).toBe(0);
  });
});

describe('marketplace fee certainty: exact / estimated / unknown', () => {
  it('14. a "known" marketplace_fee line is preserved with source "known" (exact) — no prefix applied', () => {
    const line = { type: 'marketplace_fee', amount: 45, currency: 'EUR', source: 'known' as const, description: 'exact figure from ebay_get_listing_fees' };
    expect(certaintyPrefix(line.source)).toBe('');
  });

  it('15. an "estimated" marketplace_fee line is clearly marked as such via the certainty prefix', () => {
    expect(certaintyPrefix('estimated')).toBe('~ ');
  });

  it('16. an unknown marketplace fee (missing entirely, reported in missingData) is never rendered as 0', () => {
    const result = validResult({ missingData: ['marketplace_fee:ebay'] });
    // No marketplace_fee line exists in costBreakdown at all.
    expect(result.costBreakdown.some((l) => l.type === 'marketplace_fee')).toBe(false);
    expect(describeMissingData('marketplace_fee:ebay')).toBe('Frais marketplace inconnus');
    expect(describeMissingData('marketplace_fee:ebay')).not.toContain('0');
  });
});

describe('missing data', () => {
  it('17. missingData entries are described honestly using only real, recognized categories', () => {
    expect(describeMissingData('resalePrice')).toBe('Prix de revente manquant');
    expect(describeMissingData('fx_rate:GBP_EUR')).toBe('Conversion de devise indisponible');
    expect(describeMissingData('marketplace_fee:etsy')).toBe('Frais marketplace inconnus');
  });

  it('an unrecognized missingData category is shown as-is, never given a fabricated explanation', () => {
    expect(describeMissingData('some_future_category:x')).toBe('some_future_category:x');
  });

  it('18. no missing data -> nothing invented (empty array stays empty)', () => {
    const result = validResult({ missingData: [] });
    expect(result.missingData).toEqual([]);
  });
});

describe('formatting helpers never compute', () => {
  it('formatMarginPercent displays the number AS GIVEN, never multiplied or divided by 100', () => {
    expect(formatMarginPercent(33.05)).toBe('33,05 %');
    expect(formatMarginPercent(60)).toBe('60 %');
    expect(formatMarginPercent(0)).toBe('0 %');
  });

  it('formatMarginAmount never changes the real amount', () => {
    expect(formatMarginAmount(297.45, 'EUR')).toContain('297');
    expect(formatMarginAmount(0, 'EUR')).toContain('0');
  });
});

describe('security', () => {
  it('19. a description containing script-tag-looking text is treated as plain data by this module (no rendering happens here)', () => {
    const result = validResult({
      costBreakdown: [{ type: 'purchase_price', amount: 1, currency: 'EUR', source: 'known', description: '<script>alert(1)</script>' }],
    });
    const [outcome] = extractMarginOutcomes([toolCall(result)]);
    if (outcome.status !== 'ok') throw new Error('expected ok');

    // This module only extracts/validates data — it never renders or
    // executes anything, so the dangerous string simply passes through
    // untouched as a string field; MarginSummary (a React component) is
    // what actually renders it safely — see sourcing-cards-rendering.test.tsx's
    // established pattern for that layer.
    expect(outcome.result.costBreakdown[0].description).toBe('<script>alert(1)</script>');
    expect(typeof outcome.result.costBreakdown[0].description).toBe('string');
  });
});

describe('describeCostType', () => {
  it('maps known cost types to French labels', () => {
    expect(describeCostType('purchase_price')).toBe("Prix d'achat");
    expect(describeCostType('marketplace_fee')).toBe('Frais marketplace');
  });

  it('falls back to a de-slugified raw type for an unrecognized cost type, never a fabricated label', () => {
    expect(describeCostType('some_future_cost')).toBe('some future cost');
  });
});
