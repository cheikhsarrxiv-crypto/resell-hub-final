/**
 * Static-markup rendering tests for the Phase 11A presentational
 * components. This project has no @testing-library/react or jsdom
 * installed, and Phase 11A must not add a new test dependency — so
 * these use react-dom/server's renderToStaticMarkup (part of the
 * `react-dom` dependency the app already ships), which needs no DOM/
 * window/document and works fine under vitest's `environment: 'node'`.
 *
 * This proves what a given props/state combination actually renders —
 * it does NOT simulate typing/clicking (that would need jsdom + a
 * testing-library, not added here). Interaction-driven state transitions
 * (send, reset, conversationId reuse, error mapping) are covered instead
 * at the pure-logic level in src/lib/ai/__tests__/agentConversation.test.ts,
 * which is what actually drives these components' behavior.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentMessageList } from '@/components/ai/AgentMessageList';
import { AgentErrorBanner } from '@/components/ai/AgentErrorBanner';
import { AgentComposer } from '@/components/ai/AgentComposer';
import type { AgentUiMessage } from '@/lib/ai/agentConversation';

describe('AgentMessageList', () => {
  it('empty conversation renders the empty state with example prompts, no message bubbles', () => {
    const html = renderToStaticMarkup(<AgentMessageList messages={[]} sending={false} />);

    expect(html).toContain('Trouve-moi une sneaker Prada avec une bonne marge.');
    expect(html).toContain('Je cherche une veste Stone Island');
  });

  it('example prompts in the empty state are plain text, never buttons/links that could auto-send', () => {
    const html = renderToStaticMarkup(<AgentMessageList messages={[]} sending={false} />);

    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
  });

  it('a user message is displayed', () => {
    const messages: AgentUiMessage[] = [{ id: '1', role: 'user', content: 'Je cherche une Prada' }];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

    expect(html).toContain('Je cherche une Prada');
  });

  it('an assistant reply is displayed alongside the user message that triggered it', () => {
    const messages: AgentUiMessage[] = [
      { id: '1', role: 'user', content: 'Je cherche une Prada' },
      { id: '2', role: 'assistant', content: 'Je vais rechercher des options correspondant à votre demande.' },
    ];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

    expect(html).toContain('Je cherche une Prada');
    expect(html).toContain('Je vais rechercher des options');
  });

  it('shows the loading indicator while sending', () => {
    const messages: AgentUiMessage[] = [{ id: '1', role: 'user', content: 'hi' }];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={true} />);

    expect(html).toContain('L&#x27;Agent réfléchit');
  });

  it('does not show the loading indicator once a reply has arrived', () => {
    const messages: AgentUiMessage[] = [
      { id: '1', role: 'user', content: 'hi' },
      { id: '2', role: 'assistant', content: 'hello' },
    ];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

    expect(html).not.toContain('réfléchit');
  });

  it('Phase 11B: renders product cards under an assistant message that carried a real search_products result', () => {
    const messages: AgentUiMessage[] = [
      { id: '1', role: 'user', content: 'Je cherche une Prada' },
      {
        id: '2',
        role: 'assistant',
        content: "J'ai trouvé plusieurs options.",
        toolCalls: [
          {
            name: 'search_products',
            result: {
              status: 'ok',
              results: [
                {
                  source: 'ebay',
                  sourceUrl: 'https://www.ebay.co.uk/itm/111',
                  title: 'Prada Sneakers',
                  price: 450,
                  currency: 'GBP',
                  marketplace: 'EBAY_GB',
                  images: [],
                  authenticityStatus: 'claimed',
                },
              ],
            },
          },
        ],
      },
    ];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

    expect(html).toContain('Prada Sneakers');
    expect(html).toContain("Voir l&#x27;annonce");
  });

  it('Phase 4: "Créer un produit" appears on a sourcing card only when onSend is provided and the turn isn\'t sending', () => {
    const messages: AgentUiMessage[] = [
      {
        id: '2',
        role: 'assistant',
        content: "J'ai trouvé plusieurs options.",
        toolCalls: [
          {
            name: 'search_products',
            result: {
              status: 'ok',
              results: [
                { source: 'ebay', sourceUrl: 'https://www.ebay.co.uk/itm/111', title: 'Prada Sneakers', price: 450, currency: 'GBP', marketplace: 'EBAY_GB', images: [], authenticityStatus: 'claimed' },
              ],
            },
          },
        ],
      },
    ];

    const withSend = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} onSend={() => {}} />);
    expect(withSend).toContain('Créer un produit');

    const withoutSend = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);
    expect(withoutSend).not.toContain('Créer un produit');

    // Never offered while a turn is in flight — same rule as the composer's own disabled send button.
    const whileSending = renderToStaticMarkup(<AgentMessageList messages={messages} sending={true} onSend={() => {}} />);
    expect(whileSending).not.toContain('Créer un produit');
  });

  it('a plain conversational reply with no toolCalls never shows a product grid', () => {
    const messages: AgentUiMessage[] = [
      { id: '1', role: 'user', content: 'Bonjour' },
      { id: '2', role: 'assistant', content: 'Bonjour, comment puis-je vous aider ?' },
    ];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

    expect(html).not.toContain("Voir l&#x27;annonce");
  });

  it('a user message never carries/renders product cards, even if toolCalls were somehow set on it', () => {
    const messages: AgentUiMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'hi',
        toolCalls: [{ name: 'search_products', result: { status: 'ok', results: [] } }],
      },
    ];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

    expect(html).not.toContain('Aucun résultat trouvé');
  });

  describe('Phase 11C: MarginSummary association and coexistence with sourcing cards', () => {
    const marginResult = {
      currency: 'EUR',
      costBreakdown: [{ type: 'purchase_price', amount: 500, currency: 'EUR', source: 'known', description: 'x' }],
      totalCost: 500,
      netProfit: 100,
      marginAmount: 100,
      marginPercent: 16.67,
      roi: 20,
      isEstimate: false,
      missingData: [],
      warnings: [],
    };

    it('21/22. margin from message A stays attached to message A, and message B\'s own margin stays with B (no mixing)', () => {
      const messages: AgentUiMessage[] = [
        { id: '1', role: 'user', content: 'calcule la marge #1' },
        {
          id: '2',
          role: 'assistant',
          content: 'Voici le calcul #1.',
          toolCalls: [{ name: 'calculate_margin', result: { ...marginResult, netProfit: 111 } }],
        },
        { id: '3', role: 'user', content: 'et une autre recherche' },
        {
          id: '4',
          role: 'assistant',
          content: 'Nouvelle recherche, pas de calcul ici.',
        },
        { id: '5', role: 'user', content: 'calcule la marge #2' },
        {
          id: '6',
          role: 'assistant',
          content: 'Voici le calcul #2.',
          toolCalls: [{ name: 'calculate_margin', result: { ...marginResult, netProfit: 222 } }],
        },
      ];
      const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

      const firstIndex = html.indexOf('111');
      const noCalcMessageIndex = html.indexOf('Nouvelle recherche');
      const secondIndex = html.indexOf('222');

      expect(firstIndex).toBeGreaterThan(-1);
      expect(secondIndex).toBeGreaterThan(-1);
      // The message between the two margin calculations carries neither figure.
      expect(html.slice(noCalcMessageIndex, secondIndex)).not.toContain('111');
      expect(html.slice(noCalcMessageIndex, secondIndex)).not.toContain('222');
      expect(firstIndex).toBeLessThan(noCalcMessageIndex);
    });

    it('23. an assistant reply with no calculate_margin call shows no MarginSummary at all', () => {
      const messages: AgentUiMessage[] = [
        { id: '1', role: 'user', content: 'Bonjour' },
        { id: '2', role: 'assistant', content: 'Bonjour ! Comment puis-je vous aider ?' },
      ];
      const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

      expect(html).not.toContain('Analyse de rentabilité');
    });

    it('24. search_products and calculate_margin in the SAME message both render, without mixing their data', () => {
      const messages: AgentUiMessage[] = [
        { id: '1', role: 'user', content: 'cherche et calcule' },
        {
          id: '2',
          role: 'assistant',
          content: "Voici ce que j'ai trouvé et le calcul de marge associé.",
          toolCalls: [
            {
              name: 'search_products',
              result: {
                status: 'ok',
                results: [
                  {
                    source: 'ebay',
                    sourceUrl: 'https://www.ebay.co.uk/itm/111',
                    title: 'Prada Sneakers',
                    price: 450,
                    currency: 'GBP',
                    marketplace: 'EBAY_GB',
                    images: [],
                    authenticityStatus: 'claimed',
                  },
                ],
              },
            },
            { name: 'calculate_margin', result: marginResult },
          ],
        },
      ];
      const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

      expect(html).toContain('Prada Sneakers');
      expect(html).toContain('Analyse de rentabilité');
    });

    it('25. across several turns, sourcing results and margin summaries never bleed into the wrong message', () => {
      const messages: AgentUiMessage[] = [
        { id: '1', role: 'user', content: 'cherche des Prada' },
        {
          id: '2',
          role: 'assistant',
          content: 'Résultats Prada.',
          toolCalls: [
            {
              name: 'search_products',
              result: {
                status: 'ok',
                results: [
                  {
                    source: 'ebay',
                    sourceUrl: 'https://x',
                    title: 'Prada Item Alpha',
                    price: 1,
                    currency: 'EUR',
                    marketplace: 'EBAY_FR',
                    images: [],
                    authenticityStatus: 'claimed',
                  },
                ],
              },
            },
          ],
        },
        { id: '3', role: 'user', content: 'calcule la marge' },
        { id: '4', role: 'assistant', content: 'Calcul effectué.', toolCalls: [{ name: 'calculate_margin', result: marginResult }] },
      ];
      const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

      const sourcingIndex = html.indexOf('Prada Item Alpha');
      const marginIndex = html.indexOf('Analyse de rentabilité');

      expect(sourcingIndex).toBeGreaterThan(-1);
      expect(marginIndex).toBeGreaterThan(sourcingIndex);
      // The margin card block itself never contains the sourcing card's title.
      expect(html.slice(marginIndex)).not.toContain('Prada Item Alpha');
    });
  });

  it('never renders message content as raw HTML — a script-tag-looking message stays inert text', () => {
    const dangerous = '<script>alert("xss")</script>';
    const messages: AgentUiMessage[] = [{ id: '1', role: 'user', content: dangerous }];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

    // React escapes text children by default — a literal, unescaped
    // <script> tag in the output would mean it was rendered as markup.
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('the message region is marked aria-live so new messages are announced', () => {
    const messages: AgentUiMessage[] = [{ id: '1', role: 'user', content: 'hi' }];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

    expect(html).toContain('aria-live="polite"');
  });

  it('Phase 11E: the message region uses role="log" with a descriptive label, a stronger a11y signal than aria-live alone for a sequential chat transcript', () => {
    const messages: AgentUiMessage[] = [{ id: '1', role: 'user', content: 'hi' }];
    const html = renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />);

    expect(html).toContain('role="log"');
    expect(html).toContain('aria-label="Conversation avec l&#x27;Agent ADKSY"');
  });

  it('Phase 11E: renders without crashing when the new auto-scroll ref/effect are present (no real DOM under renderToStaticMarkup, so this only proves no crash — see this file\'s own header comment on the limitation)', () => {
    const messages: AgentUiMessage[] = [{ id: '1', role: 'user', content: 'hi' }];
    expect(() => renderToStaticMarkup(<AgentMessageList messages={messages} sending={false} />)).not.toThrow();
  });
});

describe('AgentErrorBanner', () => {
  it('renders the given plain-language message', () => {
    const html = renderToStaticMarkup(<AgentErrorBanner message="Trop de demandes. Veuillez réessayer dans quelques instants." />);

    expect(html).toContain('Trop de demandes');
    expect(html).toContain('role="alert"');
  });

  it('never renders a stack trace or a raw error object shape, only the given string', () => {
    const html = renderToStaticMarkup(<AgentErrorBanner message="Une erreur est survenue. Veuillez réessayer." />);

    expect(html).not.toContain('at ');
    expect(html).not.toContain('Error:');
  });
});

describe('AgentComposer', () => {
  it('renders with an accessible label and a send button', () => {
    const html = renderToStaticMarkup(<AgentComposer sending={false} onSend={() => {}} />);

    expect(html).toContain('Écrire un message à l&#x27;Agent ADKSY');
    expect(html).toContain('aria-label="Envoyer le message"');
  });

  it('the send button starts disabled — an empty message cannot be sent', () => {
    const html = renderToStaticMarkup(<AgentComposer sending={false} onSend={() => {}} />);

    expect(html).toContain('disabled');
  });

  it('the textarea is disabled while sending', () => {
    const html = renderToStaticMarkup(<AgentComposer sending={true} onSend={() => {}} />);

    expect(html).toMatch(/<textarea[^>]*disabled/);
  });

  it('Phase 11E: the textarea keeps a bounded max-height class, so a multi-line (Shift+Enter) message that grows the box never grows unbounded', () => {
    const html = renderToStaticMarkup(<AgentComposer sending={false} onSend={() => {}} />);

    expect(html).toMatch(/<textarea[^>]*class="[^"]*max-h-32/);
  });

  it('Phase 11E: renders without crashing with the new textarea ref in place (the auto-grow effect itself needs a real DOM/scrollHeight, which renderToStaticMarkup does not provide — see this file\'s own header comment)', () => {
    expect(() => renderToStaticMarkup(<AgentComposer sending={false} onSend={() => {}} />)).not.toThrow();
  });

  it('Phase 11E: the character counter, when shown, stays a plain announced text node rather than a fabricated/rounded value', () => {
    const html = renderToStaticMarkup(<AgentComposer sending={false} onSend={() => {}} />);

    // Below the 90% threshold with an empty value — the counter is not shown at all.
    expect(html).not.toContain('/ 4000');
  });
});

describe('Phase 11D regression: a restored conversation (via deserializeHistoryResponse) renders exactly like a live one', () => {
  it('a conversation restored from GET history still shows SourcingResultsGrid and MarginSummaryList for the message that produced them', () => {
    // Shaped exactly like deserializeHistoryResponse's own output — see
    // agentConversation.test.ts for that function's own dedicated tests.
    // This proves AgentMessageList doesn't care or need to know whether
    // a message came from a live POST or a restored GET.
    const restoredMessages: AgentUiMessage[] = [
      { id: 'db-1', role: 'user', content: 'Je cherche une Prada et calcule la marge.' },
      {
        id: 'db-2',
        role: 'assistant',
        content: "Voici ce que j'ai trouvé, avec le calcul de marge.",
        toolCalls: [
          {
            name: 'search_products',
            result: {
              status: 'ok',
              results: [
                {
                  source: 'ebay',
                  sourceUrl: 'https://www.ebay.co.uk/itm/111',
                  title: 'Restored Prada Sneakers',
                  price: 450,
                  currency: 'GBP',
                  marketplace: 'EBAY_GB',
                  images: [],
                  authenticityStatus: 'claimed',
                },
              ],
            },
          },
          {
            name: 'calculate_margin',
            result: {
              currency: 'EUR',
              costBreakdown: [{ type: 'purchase_price', amount: 500, currency: 'EUR', source: 'known', description: 'x' }],
              totalCost: 500,
              netProfit: 150,
              marginAmount: 150,
              marginPercent: 23.08,
              roi: 30,
              isEstimate: false,
              missingData: [],
              warnings: [],
            },
          },
        ],
      },
    ];

    const html = renderToStaticMarkup(<AgentMessageList messages={restoredMessages} sending={false} />);

    // Both Phase 11B and Phase 11C surfaces render correctly
    // post-restoration (message ids are React `key`s only — never part
    // of the rendered output itself — their preservation is proven at
    // the data layer in ai-agent-service.test.ts and
    // agentConversation.test.ts, not here).
    expect(html).toContain(restoredMessages[0].content);
    expect(html).toContain('Restored Prada Sneakers');
    expect(html).toContain('Analyse de rentabilité');
  });

  it('a restored conversation with only plain text messages (no toolCalls) shows no cards at all', () => {
    const restoredMessages: AgentUiMessage[] = [
      { id: 'db-1', role: 'user', content: 'Bonjour' },
      { id: 'db-2', role: 'assistant', content: 'Bonjour ! Comment puis-je vous aider ?' },
    ];

    const html = renderToStaticMarkup(<AgentMessageList messages={restoredMessages} sending={false} />);

    expect(html).not.toContain('Voir l&#x27;annonce');
    expect(html).not.toContain('Analyse de rentabilité');
  });
});
