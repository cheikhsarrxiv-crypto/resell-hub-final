import { describe, it, expect, afterEach, vi } from 'vitest';
import { PricingService } from '@/services/pricing/PricingService';
import { ExactFeeQuery, ExactMarketplaceFeeProvider } from '@/services/pricing/providers/ExactMarketplaceFeeProvider';

describe('PricingService.calculateMargin — simple cases', () => {
  it('simple calculation: purchase price only, same currency, no resale price -> cost known, margin/ROI null with a clear reason', async () => {
    const result = await PricingService.calculateMargin({ purchasePrice: 100, purchaseCurrency: 'EUR', targetCurrency: 'EUR' });

    expect(result.totalCost).toBe(100);
    expect(result.costBreakdown).toEqual([
      { type: 'purchase_price', amount: 100, currency: 'EUR', source: 'known', description: 'Purchase price (already in the target currency)' },
    ]);
    expect(result.netProfit).toBeNull();
    expect(result.marginPercent).toBeNull();
    expect(result.roi).toBeNull();
    expect(result.missingData).toContain('resalePrice');
    expect(result.isEstimate).toBe(false);
  });

  it('purchase price is preserved exactly when currencies match', async () => {
    const result = await PricingService.calculateMargin({ purchasePrice: 249.99, purchaseCurrency: 'USD', targetCurrency: 'USD' });
    expect(result.costBreakdown[0].amount).toBe(249.99);
  });

  it('full calculation: purchase + resale, no extra costs -> net profit, margin %, and ROI all computed', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 500,
      purchaseCurrency: 'EUR',
      targetCurrency: 'EUR',
      resalePrice: 800,
    });

    expect(result.totalCost).toBe(500);
    expect(result.netProfit).toBe(300);
    expect(result.marginAmount).toBe(300); // marge en €
    expect(result.marginPercent).toBe(37.5); // 300 / 800 * 100
    expect(result.roi).toBe(60); // 300 / 500 * 100
    expect(result.missingData).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe('PricingService.calculateMargin — currency conversion', () => {
  it('converts the purchase price via an explicit rate and marks the result as an estimate (non-live rate)', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 100,
      purchaseCurrency: 'GBP',
      targetCurrency: 'EUR',
      explicitRates: { GBP_EUR: 1.17 },
    });

    expect(result.totalCost).toBe(117);
    expect(result.isEstimate).toBe(true);
    expect(result.costBreakdown[0].currency).toBe('EUR');
  });

  it('an unknown/unconfigured currency pair -> totalCost null, missing data names the exact pair, never a guessed number', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 100,
      purchaseCurrency: 'GBP',
      targetCurrency: 'JPY',
    });

    expect(result.totalCost).toBeNull();
    expect(result.missingData).toContain('fx_rate:GBP_JPY');
    expect(result.warnings.some((w) => w.includes('GBP') && w.includes('JPY'))).toBe(true);
  });

  it('resale price in a different currency is converted before computing margin', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 100,
      purchaseCurrency: 'EUR',
      targetCurrency: 'EUR',
      resalePrice: 100,
      resaleCurrency: 'GBP',
      explicitRates: { GBP_EUR: 1.2 },
    });

    // resale 100 GBP -> 120 EUR
    expect(result.netProfit).toBe(20);
  });

  describe('Frankfurter/ECB reference rate tier', () => {
    afterEach(() => {
      delete process.env.FRANKFURTER_FX_ENABLED;
      vi.unstubAllGlobals();
    });

    it('a rate resolved via Frankfurter is used, tagged as an estimate, and the description says it is an ECB reference rate (not live market)', async () => {
      process.env.FRANKFURTER_FX_ENABLED = 'true';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ date: '2026-09-17', rates: { EUR: 1.18 } }) }));

      const result = await PricingService.calculateMargin({ purchasePrice: 100, purchaseCurrency: 'GBP', targetCurrency: 'EUR' });

      expect(result.totalCost).toBe(118);
      expect(result.isEstimate).toBe(true);
      const description = result.costBreakdown[0].description;
      expect(description).toContain('ECB');
      expect(description).toContain('not a live market rate');
      expect(description).toContain('2026-09-17');
    });

    it('Frankfurter unavailable (HTTP error) -> falls through to unavailable, never a guessed rate', async () => {
      process.env.FRANKFURTER_FX_ENABLED = 'true';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

      const result = await PricingService.calculateMargin({ purchasePrice: 100, purchaseCurrency: 'GBP', targetCurrency: 'EUR' });

      expect(result.totalCost).toBeNull();
      expect(result.missingData).toContain('fx_rate:GBP_EUR');
    });
  });
});

describe('PricingService.calculateMargin — additional/multiple costs', () => {
  it('multiple fees: shipping + customs + fulfillment all added to the total, each in the breakdown', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 500,
      purchaseCurrency: 'EUR',
      targetCurrency: 'EUR',
      resalePrice: 800,
      additionalCosts: [
        { type: 'purchase_shipping', amount: 15, currency: 'EUR' },
        { type: 'customs_duty', amount: 25, currency: 'EUR' },
        { type: 'fulfillment_cost', amount: 10, currency: 'EUR' },
      ],
    });

    expect(result.totalCost).toBe(550); // 500 + 15 + 25 + 10
    expect(result.costBreakdown).toHaveLength(4);
    expect(result.netProfit).toBe(250);
  });

  it('an additionalCosts line explicitly marked "estimated" sets isEstimate on the whole result', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 500,
      purchaseCurrency: 'EUR',
      targetCurrency: 'EUR',
      additionalCosts: [{ type: 'customs_duty', amount: 20, currency: 'EUR', source: 'estimated', description: 'Typical EU import duty for this category' }],
    });

    expect(result.isEstimate).toBe(true);
    expect(result.costBreakdown.find((c) => c.type === 'customs_duty')?.source).toBe('estimated');
  });

  it('an additionalCosts line in an unconvertible currency blocks the total, without dropping the other known costs silently', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 500,
      purchaseCurrency: 'EUR',
      targetCurrency: 'EUR',
      additionalCosts: [{ type: 'customs_duty', amount: 20, currency: 'ZZZ' }],
    });

    expect(result.totalCost).toBeNull();
    expect(result.missingData).toContain('fx_rate:ZZZ_EUR');
    expect(result.costBreakdown.find((c) => c.type === 'customs_duty')).toMatchObject({ amount: 20, currency: 'ZZZ' });
  });
});

describe('PricingService.calculateMargin — marketplace fee (flat, Étape 3 shape)', () => {
  afterEach(() => {
    delete process.env.MARKETPLACE_FEE_CONFIG;
  });

  it('no configured fee for the given marketplace -> reported as missing, never fabricated', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 500,
      purchaseCurrency: 'EUR',
      targetCurrency: 'EUR',
      resalePrice: 800,
      marketplace: 'ebay',
    });

    expect(result.missingData).toContain('marketplace_fee:ebay');
    expect(result.costBreakdown.find((c) => c.type === 'marketplace_fee')).toBeUndefined();
    expect(result.totalCost).toBe(500);
  });

  it('a configured flat fee is applied against the resale price and included in the total', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({ ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'test' } });

    const result = await PricingService.calculateMargin({
      purchasePrice: 500,
      purchaseCurrency: 'EUR',
      targetCurrency: 'EUR',
      resalePrice: 800,
      marketplace: 'ebay',
    });

    const feeLine = result.costBreakdown.find((c) => c.type === 'marketplace_fee');
    expect(feeLine?.amount).toBe(80); // 10% of 800
    expect(result.totalCost).toBe(580);
    expect(result.netProfit).toBe(220);
  });

  it('several marketplaces produce different, independently correct totals from the same purchase', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'test' },
      etsy: { marketplace: 'etsy', percentageFee: 0.065, source: 'test' },
    });

    const base = { purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800 };
    const ebayResult = await PricingService.calculateMargin({ ...base, marketplace: 'ebay' });
    const etsyResult = await PricingService.calculateMargin({ ...base, marketplace: 'etsy' });
    const vintedResult = await PricingService.calculateMargin({ ...base, marketplace: 'vinted' }); // not configured

    expect(ebayResult.totalCost).toBe(580);
    expect(etsyResult.totalCost).toBe(552); // 500 + 6.5% of 800 = 52
    expect(vintedResult.missingData).toContain('marketplace_fee:vinted');
    expect(vintedResult.totalCost).toBe(500);
  });

  it('a country-specific eBay marketplace id (EBAY_GB) resolves to the generic "ebay" fee entry', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({ ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'test' } });
    const result = await PricingService.calculateMargin({
      purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800, marketplace: 'EBAY_GB',
    });
    expect(result.costBreakdown.find((c) => c.type === 'marketplace_fee')?.amount).toBe(80);
  });
});

describe('PricingService.calculateMargin — marketplace fee (tiered, Étape 4 shape)', () => {
  afterEach(() => {
    delete process.env.MARKETPLACE_FEE_CONFIG;
  });

  it('an amount under the first tier boundary uses only the first tier rate', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: { marketplace: 'ebay', tiers: [{ upTo: 7500, percentageFee: 0.136 }, { percentageFee: 0.0235 }], source: 'test' },
    });

    const result = await PricingService.calculateMargin({
      purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800, marketplace: 'ebay',
    });

    const feeLine = result.costBreakdown.find((c) => c.type === 'marketplace_fee');
    expect(feeLine?.amount).toBe(108.8); // 800 * 0.136
  });

  it('exactly at the tier boundary -> the boundary amount is charged at the FIRST tier rate (inclusive)', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: { marketplace: 'ebay', tiers: [{ upTo: 7500, percentageFee: 0.136 }, { percentageFee: 0.0235 }], source: 'test' },
    });

    const result = await PricingService.calculateMargin({
      purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 7500, marketplace: 'ebay',
    });

    const feeLine = result.costBreakdown.find((c) => c.type === 'marketplace_fee');
    expect(feeLine?.amount).toBe(1020); // 7500 * 0.136, none of it falls in the second tier
  });

  it('an amount above the first tier boundary is charged progressively across both tiers (marginal/bracket, not a cliff)', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: { marketplace: 'ebay', tiers: [{ upTo: 7500, percentageFee: 0.136 }, { percentageFee: 0.0235 }], source: 'test' },
    });

    const result = await PricingService.calculateMargin({
      purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 8000, marketplace: 'ebay',
    });

    // 7500 * 0.136 + 500 * 0.0235 = 1020 + 11.75 = 1031.75
    const feeLine = result.costBreakdown.find((c) => c.type === 'marketplace_fee');
    expect(feeLine?.amount).toBe(1031.75);
  });

  it('three or more tiers are all applied correctly for an amount spanning all of them', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: {
        marketplace: 'ebay',
        tiers: [{ upTo: 1000, percentageFee: 0.15 }, { upTo: 5000, percentageFee: 0.1 }, { percentageFee: 0.05 }],
        source: 'test',
      },
    });

    const result = await PricingService.calculateMargin({
      purchasePrice: 100, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 6000, marketplace: 'ebay',
    });

    // 1000*0.15 + 4000*0.10 + 1000*0.05 = 150 + 400 + 50 = 600
    const feeLine = result.costBreakdown.find((c) => c.type === 'marketplace_fee');
    expect(feeLine?.amount).toBe(600);
  });

  it('tiers take precedence over a flat percentageFee if both are somehow present', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: { marketplace: 'ebay', percentageFee: 0.5, tiers: [{ percentageFee: 0.1 }], source: 'test' },
    });

    const result = await PricingService.calculateMargin({
      purchasePrice: 100, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 1000, marketplace: 'ebay',
    });

    expect(result.costBreakdown.find((c) => c.type === 'marketplace_fee')?.amount).toBe(100); // 10%, not 50%
  });

  it('fee source/asOf/conditions are surfaced in the cost line description for traceability', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'ebay.com/help (test)', asOf: '2026-09-17', conditions: 'Most categories', },
    });

    const result = await PricingService.calculateMargin({
      purchasePrice: 100, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 1000, marketplace: 'ebay',
    });

    const description = result.costBreakdown.find((c) => c.type === 'marketplace_fee')?.description;
    expect(description).toContain('ebay.com/help (test)');
    expect(description).toContain('2026-09-17');
    expect(description).toContain('Most categories');
  });
});

describe('PricingService.calculateMargin — marketplace fee certainty (Phase 7: exact / estimated / unknown)', () => {
  afterEach(() => {
    delete process.env.MARKETPLACE_FEE_CONFIG;
  });

  /** Test-only fixture — not a real eBay integration, see ExactMarketplaceFeeProvider's own comment on why none exists. */
  function fixedExactFeeProvider(workspaceId: string, marketplace: string, amount: number, currency: string): ExactMarketplaceFeeProvider {
    return {
      name: 'fixture-exact-fee',
      marketplace,
      isConfigured: (wsId: string) => wsId === workspaceId,
      getExactFee: async (_query: ExactFeeQuery) => ({ amount, currency, source: 'fixture_get_listing_fees', asOf: '2026-09-17' }),
    };
  }

  it('a configured (estimated) fee is tagged source="estimated" and isEstimate=true — never presented as certain', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({ ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'test' } });

    const result = await PricingService.calculateMargin({
      purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800, marketplace: 'ebay',
    });

    const feeLine = result.costBreakdown.find((c) => c.type === 'marketplace_fee');
    expect(feeLine?.source).toBe('estimated');
    expect(feeLine?.description).toContain('estimated from a configured fee schedule');
    expect(result.isEstimate).toBe(true);
  });

  it('no exact provider and no configured schedule -> "unknown", reported in missingData, never fabricated as 0', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800, marketplace: 'ebay',
    });

    expect(result.missingData).toContain('marketplace_fee:ebay');
    expect(result.costBreakdown.some((c) => c.type === 'marketplace_fee')).toBe(false);
  });

  it('an exact fee provider registered for this workspace is used, tagged source="known", and does not flip isEstimate on its own', async () => {
    const provider = fixedExactFeeProvider('ws-real', 'ebay', 108.8, 'EUR'); // 13.6% of 800, a realistic eBay-shaped figure — never claimed as ADKSY's own hardcoded rate

    const result = await PricingService.calculateMargin(
      { purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800, marketplace: 'ebay', workspaceId: 'ws-real' },
      [provider]
    );

    const feeLine = result.costBreakdown.find((c) => c.type === 'marketplace_fee');
    expect(feeLine?.amount).toBe(108.8);
    expect(feeLine?.source).toBe('known');
    expect(feeLine?.description).toContain('exact figure from fixture_get_listing_fees');
    expect(result.isEstimate).toBe(false);
    expect(result.totalCost).toBe(608.8); // 500 + 108.8
  });

  it('an exact fee in a different currency is converted exactly once before being added to the total', async () => {
    const provider = fixedExactFeeProvider('ws-real', 'ebay', 100, 'GBP');

    const result = await PricingService.calculateMargin(
      {
        purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800, marketplace: 'ebay',
        workspaceId: 'ws-real', explicitRates: { GBP_EUR: 1.2 },
      },
      [provider]
    );

    const feeLine = result.costBreakdown.find((c) => c.type === 'marketplace_fee');
    expect(feeLine?.amount).toBe(120); // 100 * 1.2, not 100*1.2*1.2
    expect(feeLine?.currency).toBe('EUR');
  });

  it('workspace isolation end-to-end: an exact provider registered for workspace A never applies to workspace B\'s calculation', async () => {
    const providerForA = fixedExactFeeProvider('ws-a', 'ebay', 999, 'EUR');

    const resultForB = await PricingService.calculateMargin(
      { purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800, marketplace: 'ebay', workspaceId: 'ws-b' },
      [providerForA]
    );

    // Falls through to "unknown" (no config, no matching provider) — never workspace A's fee.
    expect(resultForB.missingData).toContain('marketplace_fee:ebay');
    expect(resultForB.costBreakdown.some((c) => c.type === 'marketplace_fee' && c.amount === 999)).toBe(false);
  });

  it('production call shape (no workspaceId, no exactFeeProviders argument) behaves exactly as before Phase 7 — a configured schedule is still applied', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({ ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'test' } });

    // No second argument at all — this is pricingTools.ts's real call shape.
    const result = await PricingService.calculateMargin({
      purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800, marketplace: 'ebay',
    });

    expect(result.costBreakdown.find((c) => c.type === 'marketplace_fee')?.amount).toBe(80); // 10% of 800, unchanged from Phase 3/4/5/6 behavior
  });

  it('a provider that never returns true for isConfigured(workspaceId) — including an empty-string workspaceId — is correctly treated as not applicable, never matched by accident', async () => {
    // A well-behaved provider must never treat "" as a valid workspace to
    // match — this fixture demonstrates the correct (safe) behavior: it
    // only answers for a real, non-empty workspace id it was actually
    // built for.
    const provider: ExactMarketplaceFeeProvider = {
      name: 'fixture-strict',
      marketplace: 'ebay',
      isConfigured: (wsId: string) => wsId.length > 0 && wsId === 'ws-real',
      getExactFee: async () => ({ amount: 999, currency: 'EUR', source: 'should-never-be-used' }),
    };
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({ ebay: { marketplace: 'ebay', percentageFee: 0.1, source: 'test' } });

    const result = await PricingService.calculateMargin(
      { purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800, marketplace: 'ebay' }, // no workspaceId
      [provider]
    );

    expect(result.costBreakdown.find((c) => c.type === 'marketplace_fee')?.amount).toBe(80); // falls to the estimated tier, not the fixture's 999
  });
});

describe('PricingService.calculateMargin — zero and edge values', () => {
  it('all additional costs at zero is valid and distinct from "missing" — total is exactly the purchase price', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 500,
      purchaseCurrency: 'EUR',
      targetCurrency: 'EUR',
      resalePrice: 800,
      additionalCosts: [{ type: 'purchase_shipping', amount: 0, currency: 'EUR' }],
    });

    expect(result.totalCost).toBe(500);
    expect(result.missingData).toEqual([]);
  });

  it('purchase price of 0 is valid (e.g. a free item)', async () => {
    const result = await PricingService.calculateMargin({ purchasePrice: 0, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 50 });
    expect(result.totalCost).toBe(0);
    expect(result.netProfit).toBe(50);
    expect(result.warnings.some((w) => w.includes('Total cost is 0'))).toBe(true);
    expect(result.roi).toBeNull();
  });

  it('resale price of 0 avoids a division-by-zero margin percent (null, not NaN/Infinity)', async () => {
    const result = await PricingService.calculateMargin({ purchasePrice: 10, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 0 });
    expect(result.marginPercent).toBeNull();
    expect(Number.isNaN(result.marginPercent)).toBe(false);
  });
});

describe('PricingService.calculateMargin — invalid input', () => {
  it('negative purchasePrice throws rather than producing a nonsensical result', async () => {
    await expect(PricingService.calculateMargin({ purchasePrice: -10, purchaseCurrency: 'EUR', targetCurrency: 'EUR' })).rejects.toThrow(
      /non-negative/
    );
  });

  it('negative resalePrice throws', async () => {
    await expect(
      PricingService.calculateMargin({ purchasePrice: 10, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: -5 })
    ).rejects.toThrow(/non-negative/);
  });

  it('a negative additionalCosts amount throws', async () => {
    await expect(
      PricingService.calculateMargin({
        purchasePrice: 10,
        purchaseCurrency: 'EUR',
        targetCurrency: 'EUR',
        additionalCosts: [{ type: 'shipping', amount: -1, currency: 'EUR' }],
      })
    ).rejects.toThrow(/non-negative/);
  });

  it('NaN/Infinity purchasePrice throws', async () => {
    await expect(PricingService.calculateMargin({ purchasePrice: NaN, purchaseCurrency: 'EUR', targetCurrency: 'EUR' })).rejects.toThrow();
    await expect(PricingService.calculateMargin({ purchasePrice: Infinity, purchaseCurrency: 'EUR', targetCurrency: 'EUR' })).rejects.toThrow();
  });
});

describe('PricingService.calculateMargin — precision/rounding', () => {
  it('rounds monetary results to 2 decimals, avoiding floating-point artifacts', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 10.1,
      purchaseCurrency: 'EUR',
      targetCurrency: 'EUR',
      resalePrice: 10.2,
    });
    expect(result.netProfit).toBe(0.1);
  });

  it('marginPercent and roi are rounded to 2 decimals', async () => {
    const result = await PricingService.calculateMargin({ purchasePrice: 33, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 100 });
    expect(result.roi).toBe(203.03);
  });

  it('tiered fee amounts are rounded to 2 decimals too', async () => {
    process.env.MARKETPLACE_FEE_CONFIG = JSON.stringify({
      ebay: { marketplace: 'ebay', tiers: [{ percentageFee: 0.129 }], source: 'test' },
    });
    const result = await PricingService.calculateMargin({
      purchasePrice: 10, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 33.33, marketplace: 'ebay',
    });
    delete process.env.MARKETPLACE_FEE_CONFIG;
    // 33.33 * 0.129 = 4.29957
    expect(result.costBreakdown.find((c) => c.type === 'marketplace_fee')?.amount).toBe(4.3);
  });
});

describe('PricingService.calculateMargin — no fabricated numbers (integration of the core rule)', () => {
  it('every field that cannot be resolved is null, never a plausible-looking substitute', async () => {
    const result = await PricingService.calculateMargin({ purchasePrice: 100, purchaseCurrency: 'XYZ', targetCurrency: 'EUR' });

    expect(result.totalCost).toBeNull();
    expect(result.netProfit).toBeNull();
    expect(result.marginPercent).toBeNull();
    expect(result.roi).toBeNull();
    expect(result.missingData.length).toBeGreaterThan(0);
  });

  it('never includes a marketplace fee it has no source for, even implicitly at 0', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 100, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 150, marketplace: 'depop',
    });
    expect(result.costBreakdown.some((c) => c.type === 'marketplace_fee')).toBe(false);
  });
});

describe('PricingService.calculateMargin — no double conversion (Étape 4 Phase 5 audit)', () => {
  it('a single explicit rate is applied exactly once, never compounded', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 100,
      purchaseCurrency: 'GBP',
      targetCurrency: 'EUR',
      explicitRates: { GBP_EUR: 1.2 },
      additionalCosts: [{ type: 'purchase_shipping', amount: 10, currency: 'GBP' }],
    });

    // If either line were converted twice: 100*1.2*1.2=144 or 10*1.2*1.2=14.4.
    // Exactly-once conversion gives 120 and 12.
    expect(result.costBreakdown.find((c) => c.type === 'purchase_price')?.amount).toBe(120);
    expect(result.costBreakdown.find((c) => c.type === 'purchase_shipping')?.amount).toBe(12);
    expect(result.totalCost).toBe(132);
  });

  it('a sourcing result already reported in the target currency (simulating an eBay-converted amount) triggers the identical_currency path, never a second FX lookup', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const input = PricingService.fromSourcingResult(
      {
        source: 'ebay', sourceUrl: 'https://x', title: 'Item', price: 450, currency: 'EUR',
        marketplace: 'EBAY_GB', images: [], authenticityStatus: 'claimed' as const,
        shippingCost: 12.5, shippingCostCurrency: 'EUR',
      },
      { targetCurrency: 'EUR' }
    );
    const result = await PricingService.calculateMargin(input);

    expect(result.totalCost).toBe(462.5); // 450 + 12.5, no rate applied to either
    expect(result.isEstimate).toBe(false); // identical_currency is never tagged as an estimate
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('purchase price and shipping cost in different source currencies are each converted independently, exactly once', async () => {
    const result = await PricingService.calculateMargin({
      purchasePrice: 100,
      purchaseCurrency: 'GBP',
      targetCurrency: 'EUR',
      explicitRates: { GBP_EUR: 1.2, USD_EUR: 0.9 },
      additionalCosts: [{ type: 'purchase_shipping', amount: 10, currency: 'USD' }],
    });

    expect(result.costBreakdown.find((c) => c.type === 'purchase_price')?.amount).toBe(120);
    expect(result.costBreakdown.find((c) => c.type === 'purchase_shipping')?.amount).toBe(9);
    expect(result.totalCost).toBe(129);
  });
});

describe('PricingService.fromSourcingResult — shipping provenance labeling (Étape 4 Phase 5 audit)', () => {
  it('never describes the shipping cost as "cheapest" — only as the first option eBay reported', () => {
    const sourcingResult = {
      source: 'ebay', sourceUrl: 'https://x', title: 'Item', price: 450, currency: 'GBP',
      marketplace: 'EBAY_GB', images: [], authenticityStatus: 'claimed' as const,
      shippingCost: 12.5, shippingCostCurrency: 'GBP',
    };

    const input = PricingService.fromSourcingResult(sourcingResult, { targetCurrency: 'EUR' });
    const description = input.additionalCosts?.[0]?.description ?? '';

    // "cheapest" may appear only inside the explicit disclaimer below — it
    // must never be asserted as a positive fact about the shipping cost.
    expect(description).toContain('First shipping option reported by ebay');
    expect(description).toContain('not confirmed to be the cheapest or buyer-selected option');
  });
});

describe('PricingService.fromSourcingResult', () => {
  it('maps a real sourcing result into a valid MarginCalculationInput without inventing a resale price', () => {
    const sourcingResult = {
      source: 'ebay', sourceUrl: 'https://x', title: 'Prada Sneakers', price: 450, currency: 'GBP',
      marketplace: 'EBAY_GB', images: [], authenticityStatus: 'claimed' as const,
    };

    const input = PricingService.fromSourcingResult(sourcingResult, { targetCurrency: 'EUR' });

    expect(input.purchasePrice).toBe(450);
    expect(input.purchaseCurrency).toBe('GBP');
    expect(input.marketplace).toBe('EBAY_GB');
    expect(input.purchasePriceSource).toBe('known');
    expect(input.resalePrice).toBeUndefined();
  });

  it('folds a real shipping cost from the sourcing result into additionalCosts as a known cost', () => {
    const sourcingResult = {
      source: 'ebay', sourceUrl: 'https://x', title: 'Prada Sneakers', price: 450, currency: 'GBP',
      marketplace: 'EBAY_GB', images: [], authenticityStatus: 'claimed' as const,
      shippingCost: 12.5, shippingCostCurrency: 'GBP',
    };

    const input = PricingService.fromSourcingResult(sourcingResult, { targetCurrency: 'EUR' });

    expect(input.additionalCosts).toEqual([
      {
        type: 'purchase_shipping',
        amount: 12.5,
        currency: 'GBP',
        source: 'known',
        description: 'First shipping option reported by ebay (eBay Browse API shippingOptions[0]) — not confirmed to be the cheapest or buyer-selected option.',
      },
    ]);
  });

  it('never invents a shipping cost when the sourcing result has none', () => {
    const sourcingResult = {
      source: 'ebay', sourceUrl: 'https://x', title: 'Prada Sneakers', price: 450, currency: 'GBP',
      marketplace: 'EBAY_GB', images: [], authenticityStatus: 'claimed' as const,
    };

    const input = PricingService.fromSourcingResult(sourcingResult, { targetCurrency: 'EUR' });

    expect(input.additionalCosts ?? []).toEqual([]);
  });
});
