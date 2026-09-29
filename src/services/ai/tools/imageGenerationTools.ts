import { z } from 'zod';
import { addGeneratedImage, type ListingDraft } from '@/lib/listing/listingDraft';
import { ImageGenerationProviderRegistry } from '@/services/imagegen/ImageGenerationProviderRegistry';
import { AgentToolDefinition } from './types';
import { findLatestDraft, buildValidationResult } from './listingDraftTools';

/**
 * AI-first listing workflow — builds the EXACT prompt sent to the image
 * provider, from this draft's own already-known, already-verified facts
 * ONLY. Deliberately not model-supplied free text: accepting a prompt
 * from the model's own tool_use input would let it describe physical
 * details (a print, a logo placement, a specific texture) that were
 * never actually confirmed anywhere — exactly the kind of invented
 * product detail this whole workflow forbids. Every clause here traces
 * back to a real field the reseller can see in the very same preview.
 */
function buildImageGenerationPrompt(draft: ListingDraft): string {
  const parts = ['Professional e-commerce product photo'];
  if (draft.source.brand) parts.push(`of a ${draft.source.brand} item`);
  parts.push(`titled "${draft.fields.title}"`);
  if (draft.fields.condition) parts.push(`condition: ${draft.fields.condition}`);
  if (draft.fields.color) parts.push(`color: ${draft.fields.color}`);
  if (draft.fields.material) parts.push(`material: ${draft.fields.material}`);
  parts.push('neutral studio background, no text, no watermark, no logo overlay');
  return parts.join(', ');
}

const generateListingDraftImageInputSchema = z.object({
  sourceUrl: z.string().url(),
});

/**
 * generate_listing_draft_image — asks the configured
 * ImageGenerationProvider for one real, additional product image for an
 * already-generated draft. Never invents a URL: if no provider is
 * configured, or the real call fails, this returns a clear, honest
 * error — exactly like search_products' own SOURCE_NOT_CONFIGURED
 * handling — never a fabricated image.
 *
 * 'write' (auto-executed, no confirmation) — same category as
 * generate_listing_draft/edit_listing_draft: this only ever prepares
 * draft state (an ephemeral, conversation-scoped image URL), it never
 * publishes or persists anything by itself. The REAL external API call
 * this makes has a real cost, priced in aiUsageConfig.ts (see that
 * file's own comment on why this is priced at the same tier as
 * search_products, not free like generate_listing_draft's own
 * deterministic, non-external generation).
 */
export const generateListingDraftImageTool: AgentToolDefinition<z.infer<typeof generateListingDraftImageInputSchema>> = {
  name: 'generate_listing_draft_image',
  description:
    'Asks the configured AI image-generation provider for one additional product photo for the listing draft already prepared for sourceUrl in this ' +
    "conversation (via generate_listing_draft). The prompt is built ONLY from this draft's own already-known, already-shown facts (brand, title, " +
    "condition, color, material) — never invents a physical detail that isn't already in the draft. Returns a clear error, never a fabricated image " +
    "URL, when no image-generation provider is configured, or when the real call fails. The generated image is clearly marked GENERATED (never REAL) " +
    'everywhere it is shown — it must never be presented as an actual photo of this specific physical item. Real source photos are always preferred ' +
    'when they exist; use this to supplement them, not replace them, unless the reseller explicitly asks for a generated image instead.',
  category: 'write',
  inputSchema: generateListingDraftImageInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      sourceUrl: { type: 'string', description: 'The sourceUrl of the product whose draft to add a generated image to — must already have a draft in this conversation.' },
    },
    required: ['sourceUrl'],
  },
  async handler(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const draft = await findLatestDraft(context.conversationId, input.sourceUrl, workspaceId);
    if (!draft) {
      return { error: 'No listing draft found for this product in this conversation. Generate one first with generate_listing_draft.' };
    }

    const providers = ImageGenerationProviderRegistry.getConfiguredProviders();
    if (providers.length === 0) {
      return {
        status: 'PROVIDER_NOT_CONFIGURED',
        error: 'AI image generation is not available yet on this ADKSY instance — no image-generation provider is configured.',
      };
    }

    const prompt = buildImageGenerationPrompt(draft);
    const outcome = await providers[0].generate({ prompt, referenceImageUrl: draft.source.images[0] });

    if (outcome.status === 'error') {
      return { error: `Image generation failed: ${outcome.error.message}` };
    }

    const updated = addGeneratedImage(draft, outcome.image);
    return buildValidationResult(updated);
  },
};
