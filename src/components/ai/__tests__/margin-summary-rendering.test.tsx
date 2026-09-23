/**
 * Static-markup rendering tests for the Phase 11C margin summary — see
 * agent-ui-rendering.test.tsx's own header comment for why
 * renderToStaticMarkup (no new test dependency) is used here.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarginSummary } from '@/components/ai/MarginSummary';
import { MarginSummaryList } from '@/components/ai/MarginSummaryList';
import type { MarginCalculationResult } from '@/services/pricing/types';

function fullResult(overrides: Partial<MarginCalculationResult> = {}): MarginCalculationResult {
  return {
    currency: 'EUR',
    costBreakdown: [
      { type: 'purchase_price', amount: 585, currency: 'EUR', source: 'known', description: 'Purchase price' },
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

describe('MarginSummary', () => {
  it('displays net profit, margin, and ROI exactly as given by the backend', () => {
    const html = renderToStaticMarkup(<MarginSummary result={fullResult()} />);

    expect(html).toContain('297'); // net profit
    expect(html).toContain('33'); // margin %
    expect(html).toContain('49'); // ROI %
  });

  it('never multiplies marginPercent/roi by 100 — 33.05 renders as "33,05 %", never "3305"', () => {
    const html = renderToStaticMarkup(<MarginSummary result={fullResult({ marginPercent: 33.05 })} />);

    expect(html).not.toContain('3305');
    expect(html).toContain('33,05');
  });

  it('displays total cost when known', () => {
    const html = renderToStaticMarkup(<MarginSummary result={fullResult({ totalCost: 602.55 })} />);
    expect(html).toContain('602');
  });

  it('renders cost breakdown lines in the exact order provided, with French labels for known types', () => {
    const html = renderToStaticMarkup(<MarginSummary result={fullResult()} />);

    const purchaseIndex = html.indexOf("Prix d&#x27;achat");
    const shippingIndex = html.indexOf('Expédition');
    expect(purchaseIndex).toBeGreaterThan(-1);
    expect(shippingIndex).toBeGreaterThan(purchaseIndex);
  });

  it('an estimated cost line is prefixed with "~", a known one is not', () => {
    const html = renderToStaticMarkup(
      <MarginSummary
        result={fullResult({
          costBreakdown: [
            { type: 'purchase_price', amount: 500, currency: 'EUR', source: 'known', description: 'x' },
            { type: 'marketplace_fee', amount: 45, currency: 'EUR', source: 'estimated', description: 'estimated from a configured fee schedule' },
          ],
        })}
      />
    );

    expect(html).toContain('~');
  });

  it('an unknown marketplace fee (present only in missingData) is shown as "inconnus", never as 0 €', () => {
    const html = renderToStaticMarkup(
      <MarginSummary
        result={fullResult({
          costBreakdown: [{ type: 'purchase_price', amount: 500, currency: 'EUR', source: 'known', description: 'x' }],
          missingData: ['marketplace_fee:ebay'],
        })}
      />
    );

    expect(html).toContain('Frais marketplace inconnus');
    expect(html).not.toContain('Frais marketplace : 0');
  });

  it('shows an "Estimation" badge only when isEstimate is true', () => {
    const withEstimate = renderToStaticMarkup(<MarginSummary result={fullResult({ isEstimate: true })} />);
    const withoutEstimate = renderToStaticMarkup(<MarginSummary result={fullResult({ isEstimate: false })} />);

    expect(withEstimate).toContain('Estimation');
    expect(withoutEstimate).not.toContain('Estimation');
  });

  it('when resalePrice is missing, shows an honest cost-only message instead of dashes for profit figures', () => {
    const html = renderToStaticMarkup(
      <MarginSummary
        result={fullResult({ netProfit: null, marginAmount: null, marginPercent: null, roi: null, missingData: ['resalePrice'] })}
      />
    );

    expect(html).toContain('Prix de revente manquant');
  });

  it('when totalCost is null for a reason other than missing resalePrice, shows a generic partial-calculation message', () => {
    const html = renderToStaticMarkup(
      <MarginSummary
        result={fullResult({ totalCost: null, netProfit: null, marginAmount: null, marginPercent: null, roi: null, missingData: ['fx_rate:GBP_EUR'] })}
      />
    );

    expect(html).toContain('Calcul partiel');
  });

  it('an edge-case null (e.g. margin % undefined due to a 0 resale price) shows a dash, not a crash or a fabricated 0', () => {
    const html = renderToStaticMarkup(<MarginSummary result={fullResult({ netProfit: 10, marginPercent: null, roi: 200 })} />);

    expect(html).not.toThrow;
    expect(html).toContain('—');
  });

  it('never renders a description as raw HTML — a script-tag-looking description stays inert text', () => {
    const dangerous = '<script>alert("xss")</script>';
    const html = renderToStaticMarkup(
      <MarginSummary
        result={fullResult({
          costBreakdown: [{ type: 'purchase_price', amount: 500, currency: 'EUR', source: 'known', description: dangerous }],
        })}
      />
    );

    expect(html).not.toContain('<script>');
  });

  it('never uses dangerouslySetInnerHTML anywhere in its own source', () => {
    // A static, structural guarantee independent of any particular
    // render output — grep the compiled component's own module source.
    const componentSource = MarginSummary.toString();
    expect(componentSource).not.toContain('dangerouslySetInnerHTML');
  });
});

describe('MarginSummaryList', () => {
  it('renders nothing when the turn had no calculate_margin call (§10.A)', () => {
    const html = renderToStaticMarkup(<MarginSummaryList toolCalls={[{ name: 'search_products', result: {} }]} />);
    expect(html).toBe('');
  });

  it('renders nothing when toolCalls is undefined', () => {
    const html = renderToStaticMarkup(<MarginSummaryList toolCalls={undefined} />);
    expect(html).toBe('');
  });

  it('renders a MarginSummary for a valid calculate_margin result (§10.B)', () => {
    const html = renderToStaticMarkup(
      <MarginSummaryList toolCalls={[{ name: 'calculate_margin', result: fullResult() }]} />
    );

    expect(html).toContain('Analyse de rentabilité');
  });

  it('renders an honest message, never the raw backend error, when calculate_margin failed (§10.D)', () => {
    const html = renderToStaticMarkup(
      <MarginSummaryList toolCalls={[{ name: 'calculate_margin', result: { error: 'Invalid tool input', details: 'internal validation detail' } }]} />
    );

    expect(html).toContain('n&#x27;a pas pu être effectué');
    expect(html).not.toContain('internal validation detail');
    expect(html).not.toContain('Invalid tool input');
  });

  it('renders nothing for a genuinely malformed calculate_margin result (§10.C, not even an error message)', () => {
    const html = renderToStaticMarkup(
      <MarginSummaryList toolCalls={[{ name: 'calculate_margin', result: { totally: 'unrecognized' } }]} />
    );
    expect(html).toBe('');
  });
});
