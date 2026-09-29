import { z } from 'zod';
import { isNormalizedSourcingResult } from '@/lib/ai/sourcingResults';
import { AgentToolDefinition } from './types';
import { findToolResultsByName } from './conversationToolResults';

/**
 * AI-first listing workflow — the structured signal that backs the
 * proactive "Veux-tu que je crée ton annonce ?" proposal (see this
 * project's own audit: the reseller must never need to type the exact
 * phrase "génère mon annonce" themselves).
 *
 * Deliberately a real tool call, never text-pattern matching on the
 * model's own prose: every other structured UI affordance in this app
 * (SourcingResultsGrid, MarginSummaryList, ListingDraftList,
 * AgentConfirmation) already renders ONLY from a real toolCalls entry,
 * never from parsing message.content — this follows the exact same rule,
 * so the frontend can reliably detect "the reseller just selected a
 * sourced item" and render the two proposal buttons without any fragile
 * heuristic on the assistant's own wording.
 *
 * Category 'read': zero side effect, a pure revalidation of what
 * search_products already returned in this conversation (same
 * findSourcedResult-style guard as generate_listing_draft/create_product
 * — never trusts a sourceUrl the model merely repeats back). Costs 0 AI
 * Units (see aiUsageConfig.ts) — it is bookkeeping to support the UI, not
 * a real technical or business operation.
 *
 * IMPORTANT for the system prompt: calling this tool must NEVER be
 * followed, in the same turn, by generate_listing_draft — the whole
 * point is to show the proposal FIRST and only generate once the
 * reseller explicitly says yes (e.g. by clicking "Générer l'annonce").
 */
const proposeListingGenerationInputSchema = z.object({
  sourceUrl: z.string().url(),
});

export const proposeListingGenerationTool: AgentToolDefinition<z.infer<typeof proposeListingGenerationInputSchema>> = {
  name: 'propose_listing_generation',
  description:
    'Call this the moment the reseller selects or clearly expresses interest in ONE specific product from a previous search_products result in this ' +
    'conversation (e.g. they clicked a "select" action, or said "je prends celle-ci"/"cette Prada Cut m\'intéresse") — BEFORE generating anything. ' +
    'It only confirms the selection is real (revalidated against this conversation\'s own search_products results, never accepted on trust) and returns ' +
    'the item\'s own real fields so you can propose next steps. Never call generate_listing_draft or create_product in the same turn as this tool — ' +
    'first present the proactive proposal to the reseller (offer to prepare the full listing automatically, or let them create it manually), and only ' +
    'call generate_listing_draft once they explicitly agree. Has no side effect and costs nothing.',
  category: 'read',
  inputSchema: proposeListingGenerationInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      sourceUrl: { type: 'string', description: 'The exact sourceUrl of the result the reseller selected — must match a real search_products result in this conversation.' },
    },
    required: ['sourceUrl'],
  },
  async handler(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const entries = await findToolResultsByName(context.conversationId, ['search_products'], workspaceId);
    for (const entry of entries) {
      const payload = entry.result as { results?: unknown[] } | null;
      const results = Array.isArray(payload?.results) ? payload!.results! : [];
      for (const candidate of results) {
        if (isNormalizedSourcingResult(candidate) && candidate.sourceUrl === input.sourceUrl) {
          return {
            selected: true,
            sourceUrl: candidate.sourceUrl,
            title: candidate.title,
            price: candidate.price,
            currency: candidate.currency,
            marketplace: candidate.marketplace,
            imageCount: candidate.images.length,
          };
        }
      }
    }

    return {
      selected: false,
      error: "This product was not found among this conversation's own search results. Search again before selecting it.",
    };
  },
};
