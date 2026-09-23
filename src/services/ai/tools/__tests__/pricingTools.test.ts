/**
 * Real behavioral tests for the calculate_margin tool definition:
 * registration/category, input validation, and — critically — that it
 * delegates to the REAL PricingService (no mock here; PricingService is
 * pure, deterministic, and already covered exhaustively in
 * PricingService.test.ts) rather than letting the model compute anything
 * itself. Also proves it stays workspace-safe like search_products.
 */
import { describe, it, expect } from 'vitest';
import { calculateMarginTool } from '@/services/ai/tools/pricingTools';
import { AiToolRegistry } from '@/services/ai/AiToolRegistry';

describe('calculate_margin tool definition', () => {
  it('is registered in AiToolRegistry as a read tool', () => {
    const tool = AiToolRegistry.get('calculate_margin');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
  });

  describe('inputSchema', () => {
    it('accepts a minimal valid input', () => {
      const result = calculateMarginTool.inputSchema.safeParse({ purchasePrice: 100, purchaseCurrency: 'EUR', targetCurrency: 'EUR' });
      expect(result.success).toBe(true);
    });

    it('rejects a negative purchasePrice at the schema level, before the service even runs', () => {
      const result = calculateMarginTool.inputSchema.safeParse({ purchasePrice: -1, purchaseCurrency: 'EUR', targetCurrency: 'EUR' });
      expect(result.success).toBe(false);
    });

    it('rejects a currency code that is not 3 letters', () => {
      const result = calculateMarginTool.inputSchema.safeParse({ purchasePrice: 100, purchaseCurrency: 'EURO', targetCurrency: 'EUR' });
      expect(result.success).toBe(false);
    });

    it('rejects an invalid additionalCosts source value', () => {
      const result = calculateMarginTool.inputSchema.safeParse({
        purchasePrice: 100, purchaseCurrency: 'EUR', targetCurrency: 'EUR',
        additionalCosts: [{ type: 'shipping', amount: 5, currency: 'EUR', source: 'guessed' }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('handler', () => {
    it('is workspace-safe: computation is identical regardless of workspaceId (pure function of its input)', async () => {
      const input = { purchasePrice: 100, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 150 };
      const resultA: any = await calculateMarginTool.handler('workspace-a', input);
      const resultB: any = await calculateMarginTool.handler('workspace-b', input);
      expect(resultA).toEqual(resultB);
    });

    it('delegates to the real PricingService — result matches a hand-computed expectation', async () => {
      const result: any = await calculateMarginTool.handler('ws-1', {
        purchasePrice: 500, purchaseCurrency: 'EUR', targetCurrency: 'EUR', resalePrice: 800,
      });

      expect(result.totalCost).toBe(500);
      expect(result.netProfit).toBe(300);
      expect(result.marginPercent).toBe(37.5);
      expect(result.roi).toBe(60);
    });

    it('never invents a number: an unconvertible currency comes back with totalCost null and missingData populated', async () => {
      const result: any = await calculateMarginTool.handler('ws-1', {
        purchasePrice: 100, purchaseCurrency: 'GBP', targetCurrency: 'JPY',
      });

      expect(result.totalCost).toBeNull();
      expect(result.missingData.length).toBeGreaterThan(0);
    });
  });
});
