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

  it('renders an honest error message, never a fabricated draft, for an error outcome', () => {
    const html = renderToStaticMarkup(
      <ListingDraftList toolCalls={[{ name: 'generate_listing_draft', result: { error: 'This product was not found among this conversation\'s own search results.' } }]} />
    );
    expect(html).toContain('not found among this conversation');
  });
});
