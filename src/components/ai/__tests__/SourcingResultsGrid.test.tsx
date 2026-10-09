/**
 * UI diagnostic fix — tests the empty-outcome classification that
 * distinguishes "no provider could run a search" from "a provider ran
 * fine but found nothing exploitable", so the two cases never collapse
 * into the same misleading "fournisseur indisponible" sentence just
 * because some OTHER, unrelated provider happened to fail (the real
 * production bug: eBay auth error + Tavily running fine but filtering
 * out every candidate).
 *
 * Static-markup rendering for the component-level assertions (A-D), same
 * approach as listing-draft-rendering.test.tsx — no new test dependency.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourcingResultsGrid, classifyEmptySourcingOutcome } from '@/components/ai/SourcingResultsGrid';
import type { NormalizedSourcingResult } from '@/services/sourcing/types';

function validResult(overrides: Partial<NormalizedSourcingResult> = {}): NormalizedSourcingResult {
  return {
    source: 'web',
    sourceUrl: 'https://vinted.fr/items/123',
    title: 'Nike Air Max 90',
    price: 60,
    currency: 'EUR',
    marketplace: 'vinted',
    images: [],
    authenticityStatus: 'unverified',
    ...overrides,
  } as NormalizedSourcingResult;
}

function toolCallsFor(result: Record<string, unknown>): unknown[] {
  return [{ name: 'search_products', input: {}, result }];
}

describe('classifyEmptySourcingOutcome', () => {
  it('Case A — every searched provider failed: classified as all_unavailable', () => {
    expect(
      classifyEmptySourcingOutcome({
        providersSearched: ['ebay'],
        providersFailed: ['ebay'],
        providerErrors: [{ provider: 'ebay', message: 'eBay authentication failed', kind: 'auth' }],
      })
    ).toBe('all_unavailable');
  });

  it('Case B — a provider searched and succeeded, no failures at all: classified as no_exploitable_results', () => {
    expect(
      classifyEmptySourcingOutcome({
        providersSearched: ['web'],
        providersFailed: [],
        providerErrors: [],
      })
    ).toBe('no_exploitable_results');
  });

  it('Case C — one provider failed but another succeeded: still no_exploitable_results (never all_unavailable just because one provider failed)', () => {
    expect(
      classifyEmptySourcingOutcome({
        providersSearched: ['ebay', 'web'],
        providersFailed: ['ebay'],
        providerErrors: [{ provider: 'ebay', message: 'eBay authentication failed', kind: 'auth' }],
      })
    ).toBe('no_exploitable_results');
  });

  it('never asserts a provider succeeded purely from its absence in providerErrors — providersSearched/providersFailed alone decide it', () => {
    // providerErrors is empty here, but providersFailed still names 'ebay'
    // as failed (e.g. a provider that threw and was recorded without a
    // structured providerErrors entry) — the classification must still
    // follow providersSearched/providersFailed, not providerErrors.
    expect(
      classifyEmptySourcingOutcome({
        providersSearched: ['ebay'],
        providersFailed: ['ebay'],
        providerErrors: [],
      })
    ).toBe('all_unavailable');
  });

  it('falls back to the conservative pre-existing signal when providersSearched is empty (insufficient data to classify)', () => {
    expect(classifyEmptySourcingOutcome({ providersSearched: [], providersFailed: [], providerErrors: [] })).toBe(
      'no_exploitable_results'
    );
    expect(
      classifyEmptySourcingOutcome({
        providersSearched: [],
        providersFailed: [],
        providerErrors: [{ provider: 'ebay', message: 'eBay authentication failed', kind: 'auth' }],
      })
    ).toBe('all_unavailable');
  });
});

describe('SourcingResultsGrid — zero-result messaging (A, B, C) and partial-results messaging (D)', () => {
  it('Case A — eBay failed and is the only provider searched: shows the unavailability message, naming eBay', () => {
    const toolCalls = toolCallsFor({
      status: 'ok',
      results: [],
      providerErrors: [{ provider: 'ebay', message: 'eBay authentication failed', kind: 'auth' }],
      providersSearched: ['ebay'],
      providersFailed: ['ebay'],
      providersUnavailable: [],
      providersSkipped: [],
      totalResults: 0,
    });
    const html = renderToStaticMarkup(<SourcingResultsGrid toolCalls={toolCalls} />);
    expect(html).toContain('Recherche temporairement indisponible auprès du fournisseur.');
    expect(html).toContain('Indisponible pour le moment');
    expect(html).toContain('eBay');
    expect(html).not.toContain('Aucun résultat exploitable trouvé');
  });

  it('Case B — Tavily (web) searched and succeeded but kept nothing exploitable: shows "aucun résultat exploitable", no unavailability claim', () => {
    const toolCalls = toolCallsFor({
      status: 'ok',
      results: [],
      providerErrors: [],
      providersSearched: ['web'],
      providersFailed: [],
      providersUnavailable: [],
      providersSkipped: [],
      totalResults: 0,
    });
    const html = renderToStaticMarkup(<SourcingResultsGrid toolCalls={toolCalls} />);
    expect(html).toContain('Aucun résultat exploitable trouvé pour cette recherche.');
    expect(html).not.toContain('Recherche temporairement indisponible');
    expect(html).not.toContain('Indisponible pour le moment');
  });

  it('Case C — eBay failed (auth error) but web (Tavily) searched and found nothing exploitable: shows BOTH pieces of information', () => {
    const toolCalls = toolCallsFor({
      status: 'ok',
      results: [],
      providerErrors: [{ provider: 'ebay', message: 'eBay authentication failed', kind: 'auth' }],
      providersSearched: ['ebay', 'web'],
      providersFailed: ['ebay'],
      providersUnavailable: [],
      providersSkipped: [],
      totalResults: 0,
    });
    const html = renderToStaticMarkup(<SourcingResultsGrid toolCalls={toolCalls} />);
    // Never claims the whole search is unavailable merely because eBay failed...
    expect(html).toContain('Aucun résultat exploitable trouvé pour cette recherche.');
    expect(html).not.toContain('Recherche temporairement indisponible');
    // ...but still names eBay as down, since web did find nothing exploitable while eBay is the real failure.
    expect(html).toContain('Indisponible pour le moment');
    expect(html).toContain('eBay');
  });

  it('Case D — real results exist and eBay failed: preserves the existing partial-results behavior unchanged', () => {
    const toolCalls = toolCallsFor({
      status: 'ok',
      results: [validResult()],
      providerErrors: [{ provider: 'ebay', message: 'eBay authentication failed', kind: 'auth' }],
      providersSearched: ['ebay', 'web'],
      providersFailed: ['ebay'],
      providersUnavailable: [],
      providersSkipped: [],
      totalResults: 1,
    });
    const html = renderToStaticMarkup(<SourcingResultsGrid toolCalls={toolCalls} />);
    expect(html).toContain('Résultats partiels');
    expect(html).toContain('eBay');
    expect(html).not.toContain('Aucun résultat exploitable trouvé');
    expect(html).not.toContain('Recherche temporairement indisponible');
  });

  it('no provider configured at all (SOURCE_NOT_CONFIGURED) keeps its own distinct, unchanged message', () => {
    const toolCalls = toolCallsFor({
      status: 'SOURCE_NOT_CONFIGURED',
      results: [],
      providersUnavailable: ['ebay', 'web'],
    });
    const html = renderToStaticMarkup(<SourcingResultsGrid toolCalls={toolCalls} />);
    expect(html).toContain('aucune source configurée');
  });
});
