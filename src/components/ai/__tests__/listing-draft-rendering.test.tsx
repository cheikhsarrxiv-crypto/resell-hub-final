/**
 * Static-markup rendering tests for the Phase 12B listing draft UI — see
 * agent-ui-rendering.test.tsx's own header comment for why
 * renderToStaticMarkup (no new test dependency) is used here. Editor
 * interaction (typing in a field, useState updates) is not exercised this
 * way — only the initial render for a given draft.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ListingDraftPreview } from '@/components/ai/ListingDraftPreview';
import { ListingDraftEditor } from '@/components/ai/ListingDraftEditor';
import { ListingDraftList } from '@/components/ai/ListingDraftList';
import type { ListingDraft, MarketplaceListingValidation } from '@/lib/listing/listingDraft';
import type { MarginCalculationResult } from '@/services/pricing/types';

const baseDraft: ListingDraft = {
  source: {
    sourceItemId: 'https://ebay.example/item/1',
    sourceMarketplace: 'EBAY_GB',
    sourceUrl: 'https://ebay.example/item/1',
    title: 'Prada Cut Out Sneakers',
    brand: 'Prada',
    images: ['https://img.example/1.jpg'],
    price: 380,
    currency: 'GBP',
    authenticityStatus: 'claimed',
  },
  fields: {
    title: 'Prada Cut Out Sneakers',
    description: 'État : Excellent\nAuthenticité : déclarée par le vendeur source.',
    price: 449,
    currency: 'EUR',
    quantity: 1,
    condition: 'USED_EXCELLENT',
  },
  generatedFieldKeys: ['title', 'description', 'currency', 'quantity'],
  editedFieldKeys: [],
  originalValues: {},
};

const readyValidation: MarketplaceListingValidation = { marketplace: 'ebay', ready: true, errors: [], warnings: ['Some warning'], missingFields: [] };
const notReadyEtsy: MarketplaceListingValidation = {
  marketplace: 'etsy',
  ready: false,
  errors: ['No Etsy category (taxonomyId) set'],
  warnings: [],
  missingFields: ['etsyTaxonomyId', 'etsyWhenMade'],
};

describe('ListingDraftPreview', () => {
  it('renders the proposed price distinctly from the source price', () => {
    const html = renderToStaticMarkup(
      <ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />
    );

    expect(html).toContain('449 EUR');
    expect(html).toContain('380 GBP');
    expect(html).toContain('proposition');
  });

  it('shows "Non proposé" instead of fabricating a price when none was proposed', () => {
    const draft: ListingDraft = { ...baseDraft, fields: { ...baseDraft.fields, price: undefined } };
    const html = renderToStaticMarkup(<ListingDraftPreview draft={draft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).toContain('Non proposé');
  });

  it('shows Etsy as "Non prêt" with its real errors when taxonomy/when_made are missing', () => {
    const html = renderToStaticMarkup(<ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).toContain('Non prêt');
    expect(html).toContain('No Etsy category');
  });

  it('shows "claimed" authenticity honestly, never as a verified/authentic claim', () => {
    const html = renderToStaticMarkup(<ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).toContain('Déclarée par le vendeur');
    expect(html.toLowerCase()).not.toContain('100% authentique');
  });

  it('renders a source-provided title as plain text even if it contains markup-looking characters', () => {
    const dangerous = '<img src=x onerror=alert(1)>';
    const draft: ListingDraft = { ...baseDraft, fields: { ...baseDraft.fields, title: dangerous } };
    const html = renderToStaticMarkup(<ListingDraftPreview draft={draft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);

    const imgTagCount = (html.match(/<img/g) || []).length;
    expect(imgTagCount).toBeLessThanOrEqual(1); // only the real product photo
    expect(html).toContain('&lt;img');
  });

  it('never renders dangerouslySetInnerHTML anywhere in its own source', () => {
    expect(ListingDraftPreview.toString()).not.toContain('dangerouslySetInnerHTML');
  });

  it('never claims a real publication happened', () => {
    const html = renderToStaticMarkup(<ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html.toLowerCase()).not.toContain('publié');
    expect(html).toContain('Aucune publication réelle');
  });

  it('12C-Prep: shows the real eBay category/marketplace fields when set — never hidden from the preview', () => {
    const draft: ListingDraft = { ...baseDraft, fields: { ...baseDraft.fields, ebayCategoryId: 15709, ebayMarketplaceId: 'EBAY_GB' } };
    const html = renderToStaticMarkup(<ListingDraftPreview draft={draft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).toContain('15709');
    expect(html).toContain('EBAY_GB');
  });

  it('12C-Prep: shows "non définie" rather than fabricating a category/marketplace when absent', () => {
    const html = renderToStaticMarkup(<ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).toContain('non définie');
  });

  it('AI-first listing workflow: labels the purchase price and proposed selling price explicitly and distinctly', () => {
    const html = renderToStaticMarkup(<ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).toContain("Prix d&#x27;achat");
    expect(html).toContain('Prix de vente proposé');
  });

  it('AI-first listing workflow: renders every source image (not just the first), each labeled as a real/source photo', () => {
    const draft: ListingDraft = { ...baseDraft, source: { ...baseDraft.source, images: ['https://img.example/1.jpg', 'https://img.example/2.jpg'] } };
    const html = renderToStaticMarkup(<ListingDraftPreview draft={draft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);

    const imgTagCount = (html.match(/<img/g) || []).length;
    expect(imgTagCount).toBe(2);
    expect(html).toContain('Réelle');
    expect(html).not.toContain('Générée');
  });

  it('AI-first listing workflow: shows color/material as "non renseignée" rather than inventing a value when absent', () => {
    const html = renderToStaticMarkup(<ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).toContain('Couleur : non renseignée');
    expect(html).toContain('Matière : non renseignée');
  });

  it('AI-first listing workflow: shows the real color/material once set, never overwritten with "non renseignée"', () => {
    const draft: ListingDraft = { ...baseDraft, fields: { ...baseDraft.fields, color: 'Noir', material: 'Cuir' } };
    const html = renderToStaticMarkup(<ListingDraftPreview draft={draft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).toContain('Couleur : Noir');
    expect(html).toContain('Matière : Cuir');
  });

  it('AI-first listing workflow: renders no generated-images section when none exist', () => {
    const html = renderToStaticMarkup(<ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).not.toContain('Générée');
    expect(html).not.toContain('générées par IA');
  });

  it('AI-first listing workflow: renders a generated image with its own "Générée" badge, distinct from real source photos', () => {
    const draft: ListingDraft = {
      ...baseDraft,
      generatedImages: [{ url: 'https://oaidalleapi.example/img1.png', provider: 'openai', model: 'dall-e-3', prompt: 'a black leather jacket', generatedAt: '2026-01-01T00:00:00.000Z' }],
    };
    const html = renderToStaticMarkup(<ListingDraftPreview draft={draft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);

    expect(html).toContain('Générée');
    expect(html).toContain('Réelle'); // the real source photo is still shown, never replaced
    const imgTagCount = (html.match(/<img/g) || []).length;
    expect(imgTagCount).toBe(2); // 1 real + 1 generated
  });

  it('AI-first listing workflow: shows SKU/model as "non défini(e)" rather than inventing a value when absent', () => {
    const html = renderToStaticMarkup(<ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).toContain('SKU : non défini');
    expect(html).toContain('Modèle : non renseigné');
  });

  it('AI-first listing workflow: shows the real SKU/model once set', () => {
    const draft: ListingDraft = { ...baseDraft, fields: { ...baseDraft.fields, sku: 'SKU-PRADA-1', model: 'Cut Out' } };
    const html = renderToStaticMarkup(<ListingDraftPreview draft={draft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).toContain('SKU : SKU-PRADA-1');
    expect(html).toContain('Modèle : Cut Out');
  });

  it('AI-first listing workflow: renders no margin section when marginPreview is absent', () => {
    const html = renderToStaticMarkup(<ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).not.toContain('Marge estimée');
  });

  const completeMargin: MarginCalculationResult = {
    currency: 'EUR',
    costBreakdown: [],
    totalCost: 300,
    netProfit: 149,
    marginAmount: 149,
    marginPercent: 33.2,
    roi: 49.7,
    isEstimate: false,
    missingData: [],
    warnings: [],
  };

  it('AI-first listing workflow: renders a complete marginPreview honestly, using PricingService\'s own numbers verbatim', () => {
    const html = renderToStaticMarkup(
      <ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} marginPreview={completeMargin} />
    );
    expect(html).toContain('Marge estimée');
    expect(html).toContain('149.00 EUR');
    expect(html).toContain('33.2%');
  });

  it('AI-first listing workflow: an incomplete marginPreview (totalCost null) is shown as incomplete, never as a fabricated number', () => {
    const incompleteMargin: MarginCalculationResult = {
      ...completeMargin,
      totalCost: null,
      netProfit: null,
      marginAmount: null,
      marginPercent: null,
      roi: null,
      missingData: ['marketplace_fee:ebay'],
      warnings: ['No configured marketplace fee for ebay.'],
    };
    const html = renderToStaticMarkup(
      <ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} marginPreview={incompleteMargin} />
    );
    expect(html).toContain('Incomplète');
    expect(html).toContain('No configured marketplace fee for ebay.');
    expect(html).not.toContain('null');
  });

  it('AI-first listing workflow: renders no per-image exclude/restore buttons when onToggleImageExclusion is not provided', () => {
    const html = renderToStaticMarkup(<ListingDraftPreview draft={baseDraft} marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }} />);
    expect(html).not.toContain('Retirer');
  });

  it('AI-first listing workflow: renders a "Retirer" button per image when onToggleImageExclusion is provided, and "Remettre" for an already-excluded one', () => {
    const draft: ListingDraft = { ...baseDraft, excludedImageUrls: ['https://img.example/1.jpg'] };
    const html = renderToStaticMarkup(
      <ListingDraftPreview
        draft={draft}
        marketplaceValidation={{ ebay: readyValidation, etsy: notReadyEtsy }}
        onToggleImageExclusion={() => {}}
      />
    );
    expect(html).toContain('Remettre');
    expect(html).toContain('non utilisée');
  });
});

describe('ListingDraftEditor', () => {
  it('renders without crashing and shows the editable fields', () => {
    const html = renderToStaticMarkup(<ListingDraftEditor draft={baseDraft} />);
    expect(html).toContain('Titre');
    expect(html).toContain('Prix proposé');
    expect(html).toContain('Description');
  });

  it('embeds the read-only preview below the editable fields', () => {
    const html = renderToStaticMarkup(<ListingDraftEditor draft={baseDraft} />);
    expect(html).toContain('Brouillon d&#x27;annonce');
  });

  it('AI-first listing workflow: exposes color/material/model as editable local fields', () => {
    const html = renderToStaticMarkup(<ListingDraftEditor draft={baseDraft} />);
    expect(html).toContain('id="draft-color"');
    expect(html).toContain('id="draft-material"');
    expect(html).toContain('id="draft-model"');
  });

  it('AI-first listing workflow: forwards marginPreview through to the embedded preview', () => {
    const margin: MarginCalculationResult = {
      currency: 'EUR',
      costBreakdown: [],
      totalCost: 300,
      netProfit: 149,
      marginAmount: 149,
      marginPercent: 33.2,
      roi: 49.7,
      isEstimate: false,
      missingData: [],
      warnings: [],
    };
    const html = renderToStaticMarkup(<ListingDraftEditor draft={baseDraft} marginPreview={margin} />);
    expect(html).toContain('Marge estimée');
    expect(html).toContain('149.00 EUR');
  });

  it('AI-first listing workflow: only renders per-image exclude/restore buttons when onSend is provided (they need it to record the change for real)', () => {
    const withSend = renderToStaticMarkup(<ListingDraftEditor draft={baseDraft} onSend={() => {}} />);
    expect(withSend).toContain('Retirer');

    const withoutSend = renderToStaticMarkup(<ListingDraftEditor draft={baseDraft} />);
    expect(withoutSend).not.toContain('Retirer');
  });

  it('AI-first listing workflow: renders "Valider ce brouillon"/"Générer une image IA"/"Annuler" only when onSend is provided', () => {
    const withSend = renderToStaticMarkup(<ListingDraftEditor draft={baseDraft} onSend={() => {}} />);
    expect(withSend).toContain('Valider ce brouillon');
    expect(withSend).toContain('Générer une image IA');
    expect(withSend).toContain('Annuler');

    const withoutSend = renderToStaticMarkup(<ListingDraftEditor draft={baseDraft} />);
    expect(withoutSend).not.toContain('Valider ce brouillon');
    expect(withoutSend).not.toContain('Générer une image IA');
  });
});

describe('ListingDraftList', () => {
  it('renders nothing when toolCalls has no draft tool call', () => {
    const html = renderToStaticMarkup(<ListingDraftList toolCalls={[{ name: 'search_products', result: {} }]} />);
    expect(html).toBe('');
  });

  it('renders nothing when toolCalls is undefined', () => {
    const html = renderToStaticMarkup(<ListingDraftList toolCalls={undefined} />);
    expect(html).toBe('');
  });

  it('renders an editor for a real generate_listing_draft outcome', () => {
    const html = renderToStaticMarkup(
      <ListingDraftList
        toolCalls={[{ name: 'generate_listing_draft', result: { draft: baseDraft, marketplaceValidation: { ebay: readyValidation, etsy: notReadyEtsy } } }]}
      />
    );
    expect(html).toContain('Prada Cut Out Sneakers');
  });

  it('AI-first listing workflow: forwards a real marginPreview from the tool result through to the rendered draft', () => {
    const margin: MarginCalculationResult = {
      currency: 'EUR',
      costBreakdown: [],
      totalCost: 300,
      netProfit: 149,
      marginAmount: 149,
      marginPercent: 33.2,
      roi: 49.7,
      isEstimate: false,
      missingData: [],
      warnings: [],
    };
    const html = renderToStaticMarkup(
      <ListingDraftList
        toolCalls={[
          {
            name: 'generate_listing_draft',
            result: { draft: baseDraft, marketplaceValidation: { ebay: readyValidation, etsy: notReadyEtsy }, marginPreview: margin },
          },
        ]}
      />
    );
    expect(html).toContain('Marge estimée');
    expect(html).toContain('149.00 EUR');
  });

  it('renders an honest error message, never a fabricated draft, for an error outcome', () => {
    const html = renderToStaticMarkup(
      <ListingDraftList toolCalls={[{ name: 'generate_listing_draft', result: { error: 'This product was not found among this conversation\'s own search results.' } }]} />
    );
    expect(html).toContain('not found among this conversation');
  });
});
