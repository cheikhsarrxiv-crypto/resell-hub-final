import { CurrencyConversionService } from './CurrencyConversionService';
import { MarketplaceFeeProvider, MarketplaceFeeTier } from './MarketplaceFeeProvider';
import { ExactMarketplaceFeeProvider } from './providers/ExactMarketplaceFeeProvider';
import { CostLine, MarginCalculationInput, MarginCalculationResult } from './types';
import { NormalizedSourcingResult } from '@/services/sourcing/types';

/**
 * PricingService — the deterministic Margin Engine. No LLM involved: the
 * calculate_margin tool calls this directly, and AiAgentService's system
 * prompt tells the model these numbers are the source of truth it must
 * not recompute or override.
 *
 * The single rule everything here is built around: a cost that cannot be
 * resolved (unknown currency pair, no configured marketplace fee) is
 * NEVER treated as zero and never silently dropped from the total — it
 * blocks totalCost/netProfit/marginPercent/roi (they come back null) and
 * is named explicitly in missingData/warnings, so the agent can ask the
 * user for exactly what's missing instead of presenting a partial sum as
 * complete.
 *
 * Async since Étape 4: CurrencyConversionService.convert() can now make a
 * real network call (Frankfurter/ECB) — every conversion in this file is
 * awaited.
 */

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Progressive/marginal bracket calculation — e.g. eBay's real final value
 * fee applies one rate to the portion of the sale up to a threshold, and
 * a different rate to the portion above it (confirmed shape from the
 * Étape 4 audit, not an assumption). Each tier's `upTo` is treated as
 * inclusive; the last tier may omit `upTo` to mean "no upper bound".
 */
function computeTieredFee(amount: number, tiers: MarketplaceFeeTier[]): number {
  let fee = 0;
  let previousCeiling = 0;

  for (const tier of tiers) {
    const ceiling = tier.upTo ?? Infinity;
    const portionInTier = Math.max(0, Math.min(amount, ceiling) - previousCeiling);
    if (tier.percentageFee) {
      fee += portionInTier * tier.percentageFee;
    }
    previousCeiling = ceiling;
    if (amount <= ceiling) break;
  }

  return fee;
}

function validate(input: MarginCalculationInput): void {
  if (!Number.isFinite(input.purchasePrice) || input.purchasePrice < 0) {
    throw new Error('purchasePrice must be a non-negative finite number');
  }
  if (!input.purchaseCurrency) {
    throw new Error('purchaseCurrency is required');
  }
  if (!input.targetCurrency) {
    throw new Error('targetCurrency is required');
  }
  if (input.resalePrice !== undefined && (!Number.isFinite(input.resalePrice) || input.resalePrice < 0)) {
    throw new Error('resalePrice must be a non-negative finite number');
  }
  for (const extra of input.additionalCosts ?? []) {
    if (!Number.isFinite(extra.amount) || extra.amount < 0) {
      throw new Error(`additionalCosts["${extra.type}"].amount must be a non-negative finite number`);
    }
    if (!extra.currency) {
      throw new Error(`additionalCosts["${extra.type}"].currency is required`);
    }
  }
}

export class PricingService {
  /**
   * `exactFeeProviders` (Phase 7) is a TypeScript-only extension seam, NOT
   * part of MarginCalculationInput/calculateMarginInputSchema — the model
   * can never supply or influence it. Production's own call site
   * (pricingTools.ts) never passes it, so MarketplaceFeeProvider.resolveFee
   * always falls straight through to the estimated/unknown tiers today,
   * identical to pre-Phase-7 behavior. It exists so a real per-workspace
   * provider (once built and explicitly authorized) can be wired in here
   * later with zero change to this method's body, and so tests can
   * exercise the 'exact' tier and workspace isolation without any real
   * network/OAuth dependency.
   */
  static async calculateMargin(
    input: MarginCalculationInput,
    exactFeeProviders: ExactMarketplaceFeeProvider[] = []
  ): Promise<MarginCalculationResult> {
    validate(input);

    const costBreakdown: CostLine[] = [];
    const missingData: string[] = [];
    const warnings: string[] = [];
    let isEstimate = false;
    let totalCostFullyKnown = true;

    const addConversionMark = (source: 'identical_currency' | 'explicit_rate' | 'configured_static_rate' | 'ecb_reference_rate' | 'unavailable') => {
      if (source === 'explicit_rate' || source === 'configured_static_rate' || source === 'ecb_reference_rate') {
        // None of these is a live, guaranteed-exact rate — a non-live or
        // externally-reported rate makes the whole result non-
        // authoritative, not just that one line. ecb_reference_rate in
        // particular: a real ECB daily reference rate, but explicitly
        // not a live market/transactional rate (see
        // FrankfurterCurrencyProvider's own comment) — the agent must
        // say so, which is why this flows into the top-level flag.
        isEstimate = true;
      }
    };

    const describeConversion = (conversionSource: string, rate: number | null, asOf?: string, providerName?: string): string => {
      if (conversionSource === 'identical_currency') return '';
      if (conversionSource === 'ecb_reference_rate') {
        return ` (converted using ${providerName ?? 'an'} ECB daily reference rate of ${rate}${asOf ? ` as of ${asOf}` : ''} — not a live market rate)`;
      }
      return ` (converted using a ${conversionSource} rate of ${rate})`;
    };

    // --- Purchase price ---
    const purchaseSource = input.purchasePriceSource ?? 'known';
    if (purchaseSource === 'estimated') isEstimate = true;
    const purchaseConversion = await CurrencyConversionService.convert(input.purchasePrice, input.purchaseCurrency, input.targetCurrency, {
      explicitRates: input.explicitRates,
    });
    addConversionMark(purchaseConversion.source);

    if (purchaseConversion.amount === null) {
      totalCostFullyKnown = false;
      const key = `fx_rate:${input.purchaseCurrency.toUpperCase()}_${input.targetCurrency.toUpperCase()}`;
      missingData.push(key);
      warnings.push(`No exchange rate available to convert the purchase price from ${input.purchaseCurrency} to ${input.targetCurrency}.`);
      costBreakdown.push({
        type: 'purchase_price',
        amount: input.purchasePrice,
        currency: input.purchaseCurrency,
        source: purchaseSource,
        description: `Purchase price in its original currency (${input.purchaseCurrency}) — could not be converted to ${input.targetCurrency}, not counted in the total.`,
      });
    } else {
      costBreakdown.push({
        type: 'purchase_price',
        amount: round2(purchaseConversion.amount),
        currency: input.targetCurrency,
        source: purchaseSource,
        description: `Purchase price${describeConversion(purchaseConversion.source, purchaseConversion.rate, purchaseConversion.asOf, purchaseConversion.providerName) || ' (already in the target currency)'}`,
      });
    }

    // --- Additional known/estimated costs (shipping, customs, fulfillment, payment, ...) ---
    for (const extra of input.additionalCosts ?? []) {
      const source = extra.source ?? 'known';
      if (source === 'estimated') isEstimate = true;

      const conversion = await CurrencyConversionService.convert(extra.amount, extra.currency, input.targetCurrency, {
        explicitRates: input.explicitRates,
      });
      addConversionMark(conversion.source);

      if (conversion.amount === null) {
        totalCostFullyKnown = false;
        missingData.push(`fx_rate:${extra.currency.toUpperCase()}_${input.targetCurrency.toUpperCase()}`);
        warnings.push(`No exchange rate available to convert "${extra.type}" from ${extra.currency} to ${input.targetCurrency}.`);
        costBreakdown.push({
          type: extra.type,
          amount: extra.amount,
          currency: extra.currency,
          source,
          description: extra.description ?? `${extra.type} — could not be converted to ${input.targetCurrency}, not counted in the total.`,
        });
      } else {
        costBreakdown.push({
          type: extra.type,
          amount: round2(conversion.amount),
          currency: input.targetCurrency,
          source,
          description:
            extra.description ??
            `${extra.type}${describeConversion(conversion.source, conversion.rate, conversion.asOf, conversion.providerName)}`,
        });
      }
    }

    // --- Marketplace fee (only computable against a real resale price) ---
    if (input.marketplace) {
      if (input.resalePrice === undefined) {
        warnings.push(`Marketplace fee for "${input.marketplace}" requires a resale price, which was not provided — not included.`);
      } else {
        const resaleForFee = await CurrencyConversionService.convert(
          input.resalePrice,
          input.resaleCurrency ?? input.targetCurrency,
          input.targetCurrency,
          { explicitRates: input.explicitRates }
        );
        addConversionMark(resaleForFee.source);

        if (resaleForFee.amount === null) {
          totalCostFullyKnown = false;
          missingData.push(`fx_rate:${(input.resaleCurrency ?? input.targetCurrency).toUpperCase()}_${input.targetCurrency.toUpperCase()}`);
          warnings.push(`No exchange rate available to convert the resale price from ${input.resaleCurrency} to ${input.targetCurrency} — the marketplace fee for "${input.marketplace}" could not be computed.`);
        } else {
          // Phase 7: resolveFee distinguishes 'exact' (a real per-workspace
          // provider — none registered in production, see
          // ExactMarketplaceFeeProvider's own comment on exactly why),
          // 'estimated' (the pre-Phase-7 configured percentageFee/tiers
          // schedule — an estimate even when correctly sourced, since it
          // is not a live per-transaction calculation from the
          // marketplace's own API), or 'unknown' (neither — never
          // defaulted to 0).
          const resolution = await MarketplaceFeeProvider.resolveFee(
            {
              workspaceId: input.workspaceId ?? '',
              marketplace: input.marketplace,
              resaleAmount: resaleForFee.amount,
              resaleCurrency: input.targetCurrency,
            },
            exactFeeProviders
          );

          if (resolution.status === 'unknown') {
            missingData.push(`marketplace_fee:${input.marketplace}`);
            warnings.push(`No configured fee schedule for marketplace "${input.marketplace}" — its marketplace fee is not included in the total cost.`);
          } else if (resolution.status === 'exact') {
            const exact = resolution.exact!;
            const exactConversion = await CurrencyConversionService.convert(exact.amount, exact.currency, input.targetCurrency, {
              explicitRates: input.explicitRates,
            });
            addConversionMark(exactConversion.source);

            if (exactConversion.amount === null) {
              totalCostFullyKnown = false;
              missingData.push(`fx_rate:${exact.currency.toUpperCase()}_${input.targetCurrency.toUpperCase()}`);
              warnings.push(`No exchange rate available to convert the exact marketplace fee for "${input.marketplace}" from ${exact.currency} to ${input.targetCurrency}.`);
            } else {
              costBreakdown.push({
                type: 'marketplace_fee',
                amount: round2(exactConversion.amount),
                currency: input.targetCurrency,
                source: 'known',
                description: `Marketplace fee for "${input.marketplace}": exact figure from ${exact.source}${exact.asOf ? ` (as of ${exact.asOf})` : ''} — not a config-based estimate.`,
              });
            }
          } else {
            // 'estimated'
            const feeStructure = resolution.estimatedStructure!;
            let feeAmount = 0;
            let feeFullyKnown = true;

            if (feeStructure.tiers && feeStructure.tiers.length > 0) {
              feeAmount += computeTieredFee(resaleForFee.amount, feeStructure.tiers);
            } else if (feeStructure.percentageFee) {
              feeAmount += resaleForFee.amount * feeStructure.percentageFee;
            }

            if (feeStructure.fixedFee) {
              const fixedConversion = await CurrencyConversionService.convert(
                feeStructure.fixedFee,
                feeStructure.fixedFeeCurrency ?? input.targetCurrency,
                input.targetCurrency,
                { explicitRates: input.explicitRates }
              );
              addConversionMark(fixedConversion.source);
              if (fixedConversion.amount === null) {
                feeFullyKnown = false;
                totalCostFullyKnown = false;
                missingData.push(`fx_rate:${(feeStructure.fixedFeeCurrency ?? input.targetCurrency).toUpperCase()}_${input.targetCurrency.toUpperCase()}`);
              } else {
                feeAmount += fixedConversion.amount;
              }
            }

            if (feeFullyKnown) {
              // Always an estimate: a configured percentage/tier schedule,
              // however well-sourced, is not a live per-transaction fee
              // from the marketplace's own API (see the module comment on
              // ExactMarketplaceFeeProvider for exactly why none is wired
              // in yet) — consistent with how a configured_static_rate FX
              // rate is likewise always flagged as an estimate.
              isEstimate = true;
              costBreakdown.push({
                type: 'marketplace_fee',
                amount: round2(feeAmount),
                currency: input.targetCurrency,
                source: 'estimated',
                description: `Marketplace fee for "${input.marketplace}" (estimated from a configured fee schedule, not a live per-transaction figure from ${input.marketplace}'s own API): ${feeStructure.source}${feeStructure.asOf ? ` (as of ${feeStructure.asOf})` : ''}${feeStructure.conditions ? ` — ${feeStructure.conditions}` : ''}`,
              });
            }
          }
        }
      }
    }

    // --- Total ---
    const totalCost = totalCostFullyKnown ? round2(costBreakdown.reduce((sum, line) => sum + line.amount, 0)) : null;

    // --- Resale-dependent outputs ---
    let netProfit: number | null = null;
    let marginPercent: number | null = null;
    let roi: number | null = null;

    if (input.resalePrice === undefined) {
      missingData.push('resalePrice');
      warnings.push('No resale price provided — net profit, margin, and ROI cannot be calculated, only the cost side.');
    } else if (totalCost === null) {
      warnings.push('Total cost could not be fully determined — net profit, margin, and ROI cannot be calculated until the missing data above is resolved.');
    } else {
      const resaleConversion = await CurrencyConversionService.convert(
        input.resalePrice,
        input.resaleCurrency ?? input.targetCurrency,
        input.targetCurrency,
        { explicitRates: input.explicitRates }
      );
      addConversionMark(resaleConversion.source);

      if (resaleConversion.amount === null) {
        missingData.push(`fx_rate:${(input.resaleCurrency ?? input.targetCurrency).toUpperCase()}_${input.targetCurrency.toUpperCase()}`);
        warnings.push(`No exchange rate available to convert the resale price from ${input.resaleCurrency} to ${input.targetCurrency}.`);
      } else {
        const resaleAmount = resaleConversion.amount;
        netProfit = round2(resaleAmount - totalCost);
        marginPercent = resaleAmount !== 0 ? round2((netProfit / resaleAmount) * 100) : null;
        roi = totalCost !== 0 ? round2((netProfit / totalCost) * 100) : null;

        if (resaleAmount === 0) warnings.push('Resale price is 0 — margin percent is undefined (division by zero avoided).');
        if (totalCost === 0) warnings.push('Total cost is 0 — ROI is undefined (division by zero avoided).');
      }
    }

    return {
      currency: input.targetCurrency,
      costBreakdown,
      totalCost,
      netProfit,
      marginAmount: netProfit,
      marginPercent,
      roi,
      isEstimate,
      missingData: Array.from(new Set(missingData)),
      warnings,
    };
  }

  /**
   * Convenience mapping from the Sourcing layer (Étape 2) into this
   * engine's input shape — the "SourcingResult -> PricingService" arrow
   * in the requested architecture. Never invents a resale price; if the
   * sourcing result carries a real shipping cost (Étape 4 — see
   * EbayBrowseSourcingProvider), it's folded in as a known additional
   * cost, in its own original currency, never assumed to be 0 when
   * absent.
   */
  static fromSourcingResult(
    result: NormalizedSourcingResult,
    extra: Omit<MarginCalculationInput, 'purchasePrice' | 'purchaseCurrency' | 'marketplace'>
  ): MarginCalculationInput {
    const additionalCosts = [...(extra.additionalCosts ?? [])];

    if (result.shippingCost !== undefined && result.shippingCost !== null) {
      additionalCosts.push({
        type: 'purchase_shipping',
        amount: result.shippingCost,
        currency: result.shippingCostCurrency ?? result.currency,
        source: 'known',
        description: `First shipping option reported by ${result.source} (eBay Browse API shippingOptions[0]) — not confirmed to be the cheapest or buyer-selected option.`,
      });
    }

    return {
      purchasePrice: result.price,
      purchaseCurrency: result.currency,
      purchasePriceSource: 'known', // a real sourcing result's own listed price, not a guess
      marketplace: result.marketplace,
      ...extra,
      additionalCosts,
    };
  }
}

export default PricingService;
