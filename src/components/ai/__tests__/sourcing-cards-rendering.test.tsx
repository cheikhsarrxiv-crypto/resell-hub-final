/**
 * Static-markup rendering tests for the Phase 11B sourcing result cards —
 * see agent-ui-rendering.test.tsx's own header comment for why
 * renderToStaticMarkup (no new test dependency) is used here.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourcingResultCard } from '@/components/ai/SourcingResultCard';
import { SourcingResultsGrid } from '@/components/ai/SourcingResultsGrid';
import type { NormalizedSourcingResult } from '@/services/sourcing/types';

const baseResult: NormalizedSourcingResult = {
  source: 'ebay',
  sourceId: 'v1|111|0',
  sourceUrl: 'https://www.ebay.co.uk/itm/111',
  title: 'Prada Sneakers Size 42',
  price: 450,
  currency: 'GBP',
  marketplace: 'EBAY_GB',
  images: ['https://img.ebay.com/main.jpg'],
  seller: { name: 'shoe_reseller_uk', feedbackScore: 4213, feedbackPercentage: 99.4 },
  authenticityStatus: 'claimed',
};

describe('SourcingResultCard', () => {
  it('renders title, price+currency, marketplace, and seller from real data', () => {
    const html = renderToStaticMarkup(<SourcingResultCard result={baseResult} />);

    expect(html).toContain('Prada Sneakers Size 42');
    expect(html).toContain('450');
    expect(html).toContain('eBay · GB');
    expect(html).toContain('shoe_reseller_uk');
  });

  it('links to the real sourceUrl, opened in a new tab with noopener/noreferrer', () => {
    const html = renderToStaticMarkup(<SourcingResultCard result={baseResult} />);

    expect(html).toContain('href="https://www.ebay.co.uk/itm/111"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('shipping cost is shown when present, including a real zero as "free shipping"', () => {
    const withShipping = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, shippingCost: 15, shippingCostCurrency: 'GBP' }} />);
    expect(withShipping).toContain('Livraison');
    expect(withShipping).toContain('15');

    const freeShipping = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, shippingCost: 0, shippingCostCurrency: 'GBP' }} />);
    expect(freeShipping).toContain('Livraison gratuite');
  });

  it('Phase 6: shows "Livraison : inconnue" (never fabricated as free/0) when shippingCost is absent', () => {
    const html = renderToStaticMarkup(<SourcingResultCard result={baseResult} />);
    expect(html).toContain('Livraison : inconnue');
    expect(html).not.toContain('Livraison gratuite');
  });

  it('"claimed" is shown as a seller declaration, never as "authentic"', () => {
    const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, authenticityStatus: 'claimed' }} />);

    expect(html).toContain('déclarée par le vendeur');
    expect(html.toLowerCase()).not.toContain('authentique</span>');
  });

  it('"verified" is shown distinctly from "claimed", naming the real mechanism via authenticitySource (never hardcoded — a real result always sets both together, see EbayBrowseSourcingProvider.determineAuthenticity)', () => {
    const html = renderToStaticMarkup(
      <SourcingResultCard
        result={{
          ...baseResult,
          authenticityStatus: 'verified',
          authenticitySource: 'eBay Authenticity Guarantee — eBay physically inspects/authenticates this item after purchase, before shipping it to the buyer',
        }}
      />
    );

    expect(html).toContain('vérifiée');
    expect(html).toContain('eBay Authenticity Guarantee');
  });

  it('"unverified" never implies either verified or claimed', () => {
    const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, authenticityStatus: 'unverified', seller: undefined }} />);

    expect(html).toContain('non renseignée');
    expect(html).not.toContain('vérifiée (programme');
    expect(html).not.toContain('déclarée par le vendeur');
  });

  it('shows a placeholder, never a fabricated image URL, when images is empty', () => {
    const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, images: [] }} />);

    expect(html).not.toContain('<img');
    expect(html).toContain('Aucune image');
  });

  it('omits the seller line entirely when no seller name is present, never shows a fabricated "Unknown seller"', () => {
    const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, seller: undefined }} />);

    expect(html).not.toContain('shoe_reseller_uk');
    expect(html.toLowerCase()).not.toContain('unknown seller');
  });

  it('renders a seller-provided title as plain text even if it contains markup-looking characters', () => {
    const dangerousTitle = '<img src=x onerror=alert(1)>';
    const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, title: dangerousTitle }} />);

    // Only one real <img> could ever appear (the product photo) — the
    // seller-controlled title must never inject a second one.
    const imgTagCount = (html.match(/<img/g) || []).length;
    expect(imgTagCount).toBeLessThanOrEqual(1);
    expect(html).toContain('&lt;img');
  });

  describe('Phase 4 — Global Sourcing Engine UI', () => {
    const fullResult: NormalizedSourcingResult = {
      ...baseResult,
      brand: 'Prada',
      condition: 'USED_EXCELLENT',
      itemLocationCountry: 'GB',
      normalizedPriceEur: 520.5,
      currency: 'GBP', // != EUR, so normalizedPriceEur should render
      estimatedKnownCostEur: 540,
      unknownCostFactors: ['import_tax_unknown'],
      estimatedMargin: 60,
      estimatedMarginPercent: 11.1,
      matchReasons: ['Within the requested price range (~€520.50)'],
      warnings: ["Authenticity is only the seller's own claim — not independently verified."],
    };

    it('A. a result with complete data renders every real field', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={fullResult} />);

      expect(html).toContain('Prada'); // brand
      expect(html).toContain('USED_EXCELLENT'); // condition
      expect(html).toContain('GB'); // location
      expect(html).toContain('520'); // normalized EUR (formatted)
      expect(html).toContain('540'); // known cost
      expect(html).toContain('Taxes d&#x27;importation'); // unknown cost factor label (React-escaped apostrophe)
      expect(html).toContain('60'); // margin amount
      expect(html).toContain('11.1'); // margin percent
      expect(html).toContain('Within the requested price range'); // matchReason
      expect(html).toContain('only the seller&#x27;s own claim'); // warning (React-escaped apostrophe)
    });

    it('B. a result with only required fields shows none of the optional Phase 3/4 blocks — never a fabricated fallback', () => {
      const minimal: NormalizedSourcingResult = {
        source: 'ebay',
        sourceUrl: 'https://x',
        title: 'Bare Item',
        price: 10,
        currency: 'EUR',
        marketplace: 'EBAY_FR',
        images: [],
        authenticityStatus: 'unverified',
      };
      const html = renderToStaticMarkup(<SourcingResultCard result={minimal} />);

      expect(html).not.toContain('Coût connu estimé');
      expect(html).not.toContain('Marge estimée');
      expect(html).not.toContain('✓');
      expect(html).not.toContain('⚠');
      expect(html).not.toContain('≈');
    });

    it('C/D. shows the normalized EUR price alongside — never instead of — the original currency', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, currency: 'JPY', price: 48000, normalizedPriceEur: 290 }} />);

      expect(html).toContain('48'); // original JPY amount still shown
      expect(html).toContain('JPY');
      expect(html).toContain('≈');
      expect(html).toContain('290'); // normalized EUR shown too
    });

    it('does not show a redundant "≈" EUR price when the original currency is already EUR', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, currency: 'EUR', price: 300, normalizedPriceEur: 300 }} />);
      expect(html).not.toContain('≈');
    });

    it('E. shows "Coût connu estimé" with the real EUR amount when estimatedKnownCostEur is present', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, estimatedKnownCostEur: 327 }} />);
      expect(html).toContain('Coût connu estimé');
      expect(html).toContain('327');
      expect(html).not.toContain('Coût total');
    });

    it('F. lists unknownCostFactors with real French labels, never the raw backend code alone when a label exists', () => {
      const html = renderToStaticMarkup(
        <SourcingResultCard result={{ ...baseResult, estimatedKnownCostEur: 327, unknownCostFactors: ['import_tax_unknown', 'customs_unknown'] }} />
      );
      expect(html).toContain('Taxes d&#x27;importation');
      expect(html).toContain('Frais de douane');
      expect(html).not.toContain('import_tax_unknown');
    });

    it('I. "unknown" authenticity is shown distinctly, never as verified or claimed', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, authenticityStatus: 'unknown' }} />);
      expect(html).toContain("Aucune information");
      expect(html).not.toContain('vérifiée');
      expect(html).not.toContain('déclarée par le vendeur');
    });

    it('J. warnings are rendered, each as its own line', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, warnings: ['Shipping cost unavailable', 'Import taxes unknown'] }} />);
      expect(html).toContain('Shipping cost unavailable');
      expect(html).toContain('Import taxes unknown');
    });

    it('never invents a warning when the result has none', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, warnings: [] }} />);
      expect(html).not.toContain('⚠');
    });

    it('K. matchReasons are rendered exactly as returned, never invented in the UI', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, matchReasons: ['Requested brand "Prada" found in the listing title'] }} />);
      expect(html).toContain('Requested brand &quot;Prada&quot; found in the listing title');
    });

    it('L. margin is shown only when BOTH estimatedMargin and estimatedMarginPercent are present', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, estimatedMargin: 60, estimatedMarginPercent: 12.5 }} />);
      expect(html).toContain('Marge estimée');
      expect(html).toContain('12.5');
    });

    it('M. never shows a margin block when no targetResalePrice-derived margin exists — never invented', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={baseResult} />);
      expect(html).not.toContain('Marge estimée');
    });

    it('Phase 6: shows "Revente cible" only when targetResalePrice is present alongside a real margin', () => {
      const withTarget = renderToStaticMarkup(
        <SourcingResultCard result={{ ...baseResult, estimatedMargin: 170, estimatedMarginPercent: 37.8, targetResalePrice: 450 }} />
      );
      expect(withTarget).toContain('Revente cible');
      expect(withTarget).toContain('450');

      const withoutTarget = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, estimatedMargin: 170, estimatedMarginPercent: 37.8 }} />);
      expect(withoutTarget).not.toContain('Revente cible');
    });

    it('Phase 6: margin amount and percent are each shown as their own "Marge estimée :" line', () => {
      const html = renderToStaticMarkup(
        <SourcingResultCard result={{ ...baseResult, estimatedMargin: 170, estimatedMarginPercent: 37.8, targetResalePrice: 450 }} />
      );
      const occurrences = html.match(/Marge estimée/g) ?? [];
      expect(occurrences.length).toBe(2);
      expect(html).toContain('170');
      expect(html).toContain('37.8');
    });

    it('Phase 6: the margin block always includes a caveat that marketplace fees/import taxes are excluded from the estimate', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, estimatedMargin: 60, estimatedMarginPercent: 12.5 }} />);
      expect(html).toContain('hors frais de vente marketplace');
      expect(html).toContain("taxes d");
      expect(html).toContain('import');
    });

    it('Phase 6: never labels the margin as a guaranteed "profit" — always an estimate', () => {
      const html = renderToStaticMarkup(
        <SourcingResultCard result={{ ...baseResult, estimatedMargin: 60, estimatedMarginPercent: 12.5 }} />
      );
      expect(html.toLowerCase()).not.toContain('profit');
      expect(html.toLowerCase()).not.toContain('bénéfice garanti');
    });

    it('O. shows the real itemLocationCountry when present, omits it when absent', () => {
      const withLocation = renderToStaticMarkup(<SourcingResultCard result={{ ...baseResult, itemLocationCountry: 'JP' }} />);
      expect(withLocation).toContain('JP');

      const withoutLocation = renderToStaticMarkup(<SourcingResultCard result={baseResult} />);
      expect(withoutLocation).not.toMatch(/>JP</);
    });

    it('Q. renders "Créer un produit" only when onCreateProduct is provided, and it is a real button (not a link)', () => {
      const withCallback = renderToStaticMarkup(<SourcingResultCard result={baseResult} onCreateProduct={() => {}} />);
      expect(withCallback).toContain('Créer un produit');
      expect(withCallback).toContain('<button');

      const withoutCallback = renderToStaticMarkup(<SourcingResultCard result={baseResult} />);
      expect(withoutCallback).not.toContain('Créer un produit');
    });

    it('X. accessible labels disambiguate multiple identical-looking action links/buttons by title', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={baseResult} onCreateProduct={() => {}} />);
      expect(html).toContain(`aria-label="Voir l’annonce : ${baseResult.title}"`);
      expect(html).toContain(`aria-label="Créer un produit à partir de : ${baseResult.title}"`);
    });

    it('X. the product image always has real alt text (the title), never empty/decorative', () => {
      const html = renderToStaticMarkup(<SourcingResultCard result={baseResult} />);
      expect(html).toContain(`alt="${baseResult.title}"`);
    });
  });
});

describe('SourcingResultsGrid', () => {
  it('renders nothing when the turn had no search_products call', () => {
    const html = renderToStaticMarkup(<SourcingResultsGrid toolCalls={[{ name: 'calculate_margin', result: {} }]} />);
    expect(html).toBe('');
  });

  it('renders nothing when toolCalls is undefined (a plain conversational reply)', () => {
    const html = renderToStaticMarkup(<SourcingResultsGrid toolCalls={undefined} />);
    expect(html).toBe('');
  });

  it('renders a card for each real result returned', () => {
    const secondResult = { ...baseResult, sourceId: 'v1|222|0', title: 'Prada Loafers' };
    const html = renderToStaticMarkup(
      <SourcingResultsGrid
        toolCalls={[{ name: 'search_products', result: { status: 'ok', results: [baseResult, secondResult] } }]}
      />
    );

    expect(html).toContain('Prada Sneakers Size 42');
    expect(html).toContain('Prada Loafers');
  });

  it('an honest "no results" message when the search ran but found nothing — never a fabricated card', () => {
    const html = renderToStaticMarkup(
      <SourcingResultsGrid toolCalls={[{ name: 'search_products', result: { status: 'ok', results: [] } }]} />
    );

    expect(html).toContain('Aucun résultat trouvé');
  });

  it('an honest "unavailable" message when the provider errored, never a fabricated result', () => {
    const html = renderToStaticMarkup(
      <SourcingResultsGrid
        toolCalls={[
          {
            name: 'search_products',
            result: { status: 'ok', results: [], providerErrors: [{ provider: 'ebay', message: 'eBay search failed with status 500', kind: 'upstream_error' }] },
          },
        ]}
      />
    );

    expect(html).toContain('indisponible');
    expect(html).not.toContain('eBay search failed with status 500'); // never the raw backend error text
  });

  it('SOURCE_NOT_CONFIGURED is explained plainly, never silently empty', () => {
    const html = renderToStaticMarkup(
      <SourcingResultsGrid toolCalls={[{ name: 'search_products', result: { status: 'SOURCE_NOT_CONFIGURED', results: [] } }]} />
    );

    expect(html).toContain('indisponible');
  });

  describe('Phase 4 — partial results, provider provenance, worldwide, filtering', () => {
    it('S. partial results: eBay succeeded, Etsy failed — says so explicitly, never silently shows only eBay as if that were everything', () => {
      const html = renderToStaticMarkup(
        <SourcingResultsGrid
          toolCalls={[
            {
              name: 'search_products',
              result: {
                status: 'ok',
                results: [baseResult],
                providerErrors: [{ provider: 'etsy', message: 'Etsy search failed', kind: 'upstream_error' }],
                providersSearched: ['ebay', 'etsy'],
                providersFailed: ['etsy'],
                providersUnavailable: [],
                providersSkipped: [],
                totalResults: 1,
              },
            },
          ]}
        />
      );

      expect(html).toContain('Résultats partiels');
      expect(html).toContain('Etsy');
      expect(html).toContain('Prada Sneakers Size 42');
    });

    it('T. a provider that is simply unavailable (never even queried) is distinguished, still surfaced when results exist from another provider', () => {
      const html = renderToStaticMarkup(
        <SourcingResultsGrid
          toolCalls={[
            {
              name: 'search_products',
              result: {
                status: 'ok',
                results: [baseResult],
                providersSearched: ['ebay'],
                providersFailed: [],
                providersUnavailable: ['etsy'],
                providersSkipped: [],
                totalResults: 1,
              },
            },
          ]}
        />
      );

      expect(html).toContain('Résultats partiels');
      expect(html).toContain('Etsy');
    });

    it('no partial-results banner at all when every searched provider succeeded', () => {
      const html = renderToStaticMarkup(
        <SourcingResultsGrid
          toolCalls={[
            {
              name: 'search_products',
              result: { status: 'ok', results: [baseResult], providersSearched: ['ebay'], providersFailed: [], providersUnavailable: [], providersSkipped: [], totalResults: 1 },
            },
          ]}
        />
      );

      expect(html).not.toContain('Résultats partiels');
    });

    it('U. a worldwide search is labeled as such, and clarifies it means "available ADKSY sources", never "the whole Internet"', () => {
      const html = renderToStaticMarkup(
        <SourcingResultsGrid
          toolCalls={[
            {
              name: 'search_products',
              input: { query: 'x', worldwide: true },
              result: { status: 'ok', results: [baseResult], providersSearched: ['ebay'], providersFailed: [], providersUnavailable: [], providersSkipped: [], totalResults: 1 },
            },
          ]}
        />
      );

      expect(html).toContain('mondiale');
      // Explicitly clarifies this means "available ADKSY sources", not the whole Internet.
      expect(html.toLowerCase()).toContain('internet');
      expect(html).toContain('ensemble');
    });

    it('no "recherche mondiale" mention when worldwide was not requested', () => {
      const html = renderToStaticMarkup(
        <SourcingResultsGrid
          toolCalls={[
            {
              name: 'search_products',
              input: { query: 'x' },
              result: { status: 'ok', results: [baseResult], providersSearched: ['ebay'], providersFailed: [], providersUnavailable: [], providersSkipped: [], totalResults: 1 },
            },
          ]}
        />
      );

      expect(html).not.toContain('mondiale');
    });

    it('V. provider filtering: a provider explicitly excluded via `providers` is shown as skipped, distinct from a failure', () => {
      const html = renderToStaticMarkup(
        <SourcingResultsGrid
          toolCalls={[
            {
              name: 'search_products',
              result: { status: 'ok', results: [baseResult], providersSearched: ['ebay'], providersFailed: [], providersUnavailable: [], providersSkipped: ['etsy'], totalResults: 1 },
            },
          ]}
        />
      );

      expect(html).toContain('exclu');
      expect(html).toContain('Etsy');
      expect(html).not.toContain('Résultats partiels'); // skipped is not a failure
    });

    it('shows the real result count and searched provider names in a summary line', () => {
      const html = renderToStaticMarkup(
        <SourcingResultsGrid
          toolCalls={[
            {
              name: 'search_products',
              result: { status: 'ok', results: [baseResult], providersSearched: ['ebay', 'etsy'], providersFailed: [], providersUnavailable: [], providersSkipped: [], totalResults: 1 },
            },
          ]}
        />
      );

      expect(html).toContain('1 résultat');
      expect(html).toContain('eBay');
      expect(html).toContain('Etsy');
    });

    it('Q. wires each card\'s "Créer un produit" only when onSend is provided', () => {
      const withSend = renderToStaticMarkup(
        <SourcingResultsGrid toolCalls={[{ name: 'search_products', result: { status: 'ok', results: [baseResult] } }]} onSend={() => {}} />
      );
      expect(withSend).toContain('Créer un produit');

      const withoutSend = renderToStaticMarkup(
        <SourcingResultsGrid toolCalls={[{ name: 'search_products', result: { status: 'ok', results: [baseResult] } }]} />
      );
      expect(withoutSend).not.toContain('Créer un produit');
    });

    it('W. mobile-first layout: the results grid defaults to a single column, expanding only at sm/lg breakpoints', () => {
      const html = renderToStaticMarkup(
        <SourcingResultsGrid toolCalls={[{ name: 'search_products', result: { status: 'ok', results: [baseResult] } }]} />
      );
      expect(html).toContain('grid-cols-1');
      expect(html).toContain('sm:grid-cols-2');
      expect(html).toContain('lg:grid-cols-3');
    });
  });
});
