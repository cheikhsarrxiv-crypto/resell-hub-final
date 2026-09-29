/**
 * AI-first listing workflow — static-markup rendering tests for
 * SelectionProposalCard, same renderToStaticMarkup convention as the
 * other Agent UI cards (see listing-draft-rendering.test.tsx's own header).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SelectionProposalCard } from '@/components/ai/SelectionProposalCard';

const selectedToolCalls = [
  {
    name: 'propose_listing_generation',
    result: { selected: true, sourceUrl: 'https://ebay.example/item/1', title: 'Prada Cut Out Sneakers', price: 380, currency: 'GBP', marketplace: 'EBAY_GB' },
  },
];

describe('SelectionProposalCard', () => {
  it('renders nothing when toolCalls has no propose_listing_generation call', () => {
    const html = renderToStaticMarkup(<SelectionProposalCard toolCalls={[{ name: 'search_products', result: {} }]} onSend={() => {}} />);
    expect(html).toBe('');
  });

  it('renders nothing when the selection was refused (selected: false)', () => {
    const html = renderToStaticMarkup(
      <SelectionProposalCard toolCalls={[{ name: 'propose_listing_generation', result: { selected: false, error: 'not found' } }]} onSend={() => {}} />
    );
    expect(html).toBe('');
  });

  it('renders both action buttons for a real selected outcome, only when onSend is provided', () => {
    const withSend = renderToStaticMarkup(<SelectionProposalCard toolCalls={selectedToolCalls} onSend={() => {}} />);
    expect(withSend).toContain('Générer l&#x27;annonce');
    expect(withSend).toContain('Créer manuellement');

    const withoutSend = renderToStaticMarkup(<SelectionProposalCard toolCalls={selectedToolCalls} />);
    expect(withoutSend).not.toContain('Générer l&#x27;annonce');
  });

  it('"Créer manuellement" links to the existing manual product form, the required fallback', () => {
    const html = renderToStaticMarkup(<SelectionProposalCard toolCalls={selectedToolCalls} onSend={() => {}} />);
    expect(html).toContain('href="/dashboard/products/new"');
  });

  it('never calls generate_listing_draft/create_product itself — only ever sends a plain chat message via onSend', () => {
    expect(SelectionProposalCard.toString()).not.toContain('generate_listing_draft');
    expect(SelectionProposalCard.toString()).not.toContain('create_product');
  });
});
