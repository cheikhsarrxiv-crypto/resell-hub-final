/**
 * Static-markup rendering tests for the Phase 12A confirmation UI
 * (AgentActionPreview, AgentActionStatus, AgentConfirmation) — see
 * agent-ui-rendering.test.tsx's own header comment for why
 * renderToStaticMarkup (no new test dependency) is used here.
 *
 * IMPORTANT LIMITATION (same category as every other Phase 11/12 render
 * test): renderToStaticMarkup performs one synchronous render pass —
 * clicking Confirm/Cancel, the busy state, and the actual
 * fetch()-driven confirm/cancel round trip are never exercised this way.
 * That logic (mapAgentActionErrorToMessage, confirmAgentAction,
 * cancelAgentAction, ACTION_UPDATE) is covered at the pure-logic level in
 * agentConversation.test.ts, and the full pipeline behind it in
 * ai-action-service.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentActionPreview } from '@/components/ai/AgentActionPreview';
import { AgentActionStatus } from '@/components/ai/AgentActionStatus';
import { AgentConfirmation } from '@/components/ai/AgentConfirmation';
import { AgentMessageList } from '@/components/ai/AgentMessageList';
import type { AgentPendingAction, AgentUiMessage } from '@/lib/ai/agentConversation';

const basePendingAction: AgentPendingAction = {
  actionId: 'action-1',
  toolName: 'publish_listing',
  status: 'PENDING_CONFIRMATION',
  expiresAt: '2026-01-01T12:15:00.000Z',
  summary: {
    action: 'publish_listing',
    listingId: 'listing-1',
    title: 'Prada Cut Out sneakers',
    price: { amount: 449, currency: 'EUR' },
    marketplace: 'eBay',
    marketplaceConnected: true,
    simulatedOnly: true,
    message: 'Confirming this action will NOT publish a real listing in this version of ADKSY.',
  },
};

describe('AgentActionPreview', () => {
  it('renders real backend-computed fields, never fabricated ones', () => {
    const html = renderToStaticMarkup(<AgentActionPreview summary={basePendingAction.summary} />);

    expect(html).toContain('Prada Cut Out sneakers');
    expect(html).toContain('449');
    expect(html).toContain('EUR');
    expect(html).toContain('eBay');
  });

  it('never renders internal/structural keys as a labeled field', () => {
    const html = renderToStaticMarkup(<AgentActionPreview summary={basePendingAction.summary} />);
    expect(html).not.toContain('>action<');
    expect(html).not.toContain('>confirmationRequired<');
  });

  it('renders a seller-provided title as plain text even if it contains markup-looking characters', () => {
    const dangerous = '<img src=x onerror=alert(1)>';
    const html = renderToStaticMarkup(<AgentActionPreview summary={{ title: dangerous }} />);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('renders "—" for a null/undefined field, never a fabricated value', () => {
    const html = renderToStaticMarkup(<AgentActionPreview summary={{ title: null }} />);
    expect(html).toContain('—');
  });

  it('humanizes an unknown key rather than showing raw camelCase', () => {
    const html = renderToStaticMarkup(<AgentActionPreview summary={{ someFutureField: 'x' }} />);
    expect(html).toContain('Some Future Field');
  });

  it('Phase 4 — renders create_product\'s own preview fields (source, sourceUrl, purchase/selling price, brand, condition) with real French labels', () => {
    const createProductSummary = {
      action: 'create_product',
      sourceMarketplace: 'ebay',
      sourceId: 'v1|111|0',
      sourceUrl: 'https://www.ebay.co.uk/itm/111',
      title: 'Prada Cut Out Sneakers',
      description: 'A real description.',
      sellingPrice: 449,
      purchasePrice: 200,
      sku: null,
      brand: 'Prada',
      condition: 'used',
      size: null,
      color: null,
      message: 'Confirming this will add a new product to your ADKSY catalog with these exact details.',
    };
    const html = renderToStaticMarkup(<AgentActionPreview summary={createProductSummary} />);

    expect(html).toContain('Source');
    expect(html).toContain('https://www.ebay.co.uk/itm/111');
    expect(html).toContain('Prix de vente proposé');
    expect(html).toContain('449');
    expect(html).toContain("Prix d&#x27;achat");
    expect(html).toContain('200');
    expect(html).toContain('Marque');
    expect(html).toContain('Prada');
    expect(html).toContain('État');
    // null fields render as "—", never a fabricated value.
    expect(html).toContain('—');
  });
});

describe('AgentActionStatus', () => {
  it('renders a distinct label for each status', () => {
    expect(renderToStaticMarkup(<AgentActionStatus status="PENDING_CONFIRMATION" />)).toContain('En attente de confirmation');
    expect(renderToStaticMarkup(<AgentActionStatus status="COMPLETED" />)).toContain('Terminée');
    expect(renderToStaticMarkup(<AgentActionStatus status="FAILED" />)).toContain('Échouée');
    expect(renderToStaticMarkup(<AgentActionStatus status="CANCELLED" />)).toContain('Annulée');
    expect(renderToStaticMarkup(<AgentActionStatus status="EXPIRED" />)).toContain('Expirée');
  });
});

describe('AgentConfirmation', () => {
  it('renders Confirm/Cancel controls while PENDING_CONFIRMATION', () => {
    const html = renderToStaticMarkup(
      <AgentConfirmation pendingAction={basePendingAction} onConfirm={() => {}} onCancel={() => {}} />
    );

    expect(html).toContain('Confirmer');
    expect(html).toContain('Annuler');
  });

  it('never shows Confirm/Cancel controls once the action is COMPLETED', () => {
    const html = renderToStaticMarkup(
      <AgentConfirmation
        pendingAction={{ ...basePendingAction, status: 'COMPLETED', result: { simulated: true } }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(html).not.toContain('>Confirmer<');
    expect(html).not.toContain('>Annuler<');
    expect(html).toContain('confirmée et exécutée');
  });

  it('shows the stored error, never a raw exception, when FAILED', () => {
    const html = renderToStaticMarkup(
      <AgentConfirmation
        pendingAction={{ ...basePendingAction, status: 'FAILED', error: 'Action execution failed' }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(html).toContain('Action execution failed');
    expect(html).not.toContain('>Confirmer<');
  });

  it('never renders dangerouslySetInnerHTML anywhere in its own source', () => {
    const componentSource = AgentConfirmation.toString();
    expect(componentSource).not.toContain('dangerouslySetInnerHTML');
  });
});

describe('AgentMessageList — Phase 12A wiring', () => {
  it('renders AgentConfirmation under the assistant message that carries a pendingAction', () => {
    const messages: AgentUiMessage[] = [
      { id: '1', role: 'user', content: 'publie mon annonce' },
      {
        id: '2',
        role: 'assistant',
        content: 'Voulez-vous confirmer la publication ?',
        pendingAction: basePendingAction,
      },
    ];

    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

    expect(html).toContain('Confirmation requise');
    expect(html).toContain('Prada Cut Out sneakers');
  });

  it('a user message never carries/renders a confirmation, even if pendingAction were somehow set on it', () => {
    const messages: AgentUiMessage[] = [
      { id: '1', role: 'user', content: 'hi', pendingAction: basePendingAction } as AgentUiMessage,
    ];

    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);
    expect(html).not.toContain('Confirmation requise');
  });

  it('an assistant message with no pendingAction renders no confirmation UI at all', () => {
    const messages: AgentUiMessage[] = [{ id: '1', role: 'assistant', content: 'Voici les résultats.' }];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);
    expect(html).not.toContain('Confirmation requise');
  });
});
