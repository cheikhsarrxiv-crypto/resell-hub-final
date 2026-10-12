/**
 * Behavioral tests for generate_listing_draft / edit_listing_draft —
 * proves the revalidation guard (a sourceUrl/draft must really have come
 * from THIS conversation's own tool results, never trusted from the
 * model's bare say-so) using a small in-memory fake for
 * prisma.agentMessage.findMany, built from the exact raw shapes
 * AiAgentService.persistMessage actually writes (assistant tool_use
 * blocks + tool_result blocks correlated by tool_use_id).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createNotificationMock } = vi.hoisted(() => ({ createNotificationMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/NotificationService', () => ({
  NotificationService: { createNotification: createNotificationMock },
}));

interface FakeRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
}

let rows: FakeRow[] = [];
let rowIdCounter = 0;
let clock = 0;

vi.mock('@/lib/prisma', () => ({
  prisma: {
    // Phase 12C-Offline: findToolResultsByName now checks conversation
    // ownership first. This file's own tests aren't about workspace
    // ownership (that's covered in publish-listing-pipeline-integration.test.ts)
    // — every conversationId here is treated as belonging to whatever
    // workspaceId asks, so the pre-existing tests keep testing exactly
    // what they always tested (conversation-scoped revalidation).
    agentConversation: {
      findFirst: vi.fn(async ({ where }: any) => ({ id: where.id })),
    },
    agentMessage: {
      findMany: vi.fn(async ({ where }: any) => {
        const roleFilter: string[] | undefined = where?.role?.in;
        return rows
          .filter((r) => r.conversationId === where.conversationId)
          .filter((r) => !roleFilter || roleFilter.includes(r.role))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
    },
  },
}));

import { generateListingDraftTool, editListingDraftTool } from '@/services/ai/tools/listingDraftTools';
import type { NormalizedSourcingResult } from '@/services/sourcing/types';

function assistantToolUseRow(conversationId: string, toolUseId: string, toolName: string, input: unknown): FakeRow {
  return {
    id: `row-${++rowIdCounter}`,
    conversationId,
    role: 'assistant',
    content: JSON.stringify([{ type: 'tool_use', id: toolUseId, name: toolName, input }]),
    createdAt: new Date(++clock),
  };
}

function toolResultRow(conversationId: string, toolUseId: string, resultPayload: unknown): FakeRow {
  return {
    id: `row-${++rowIdCounter}`,
    conversationId,
    role: 'tool_result',
    content: JSON.stringify([{ type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(resultPayload) }]),
    createdAt: new Date(++clock),
  };
}

function pushSearchProductsCall(conversationId: string, toolUseId: string, results: NormalizedSourcingResult[]) {
  rows.push(assistantToolUseRow(conversationId, toolUseId, 'search_products', { query: 'prada' }));
  rows.push(toolResultRow(conversationId, toolUseId, { status: 'ok', results, providerErrors: [] }));
}

function pushDraftToolCall(conversationId: string, toolUseId: string, toolName: string, input: unknown, resultPayload: unknown) {
  rows.push(assistantToolUseRow(conversationId, toolUseId, toolName, input));
  rows.push(toolResultRow(conversationId, toolUseId, resultPayload));
}

/**
 * Free listing creation (real photo analysis) — simulates the synthetic
 * 'user_photos_uploaded' tool_use/tool_result pair AiAgentService.sendMessage
 * actually persists for a real attachment (see that method's own
 * comment). generate_listing_draft's free mode reads these back via
 * findToolResultsByName, exactly like it already does for search_products.
 */
function pushPhotoUploadCall(conversationId: string, toolUseId: string, photos: Array<{ url: string; storagePath: string; mimeType: string }>) {
  rows.push(assistantToolUseRow(conversationId, toolUseId, 'user_photos_uploaded', { count: photos.length }));
  rows.push(
    toolResultRow(conversationId, toolUseId, {
      photos: photos.map((p) => ({ ...p, uploadedAt: new Date().toISOString(), status: 'attached' })),
      count: photos.length,
    })
  );
}

const sourcedItem: NormalizedSourcingResult = {
  source: 'ebay',
  sourceId: 'v1|111|0',
  sourceUrl: 'https://www.ebay.co.uk/itm/111',
  title: 'Prada Cut Out Sneakers',
  brand: 'Prada',
  price: 380,
  currency: 'GBP',
  marketplace: 'EBAY_GB',
  images: ['https://img.ebay.com/main.jpg'],
  condition: 'USED_EXCELLENT',
  authenticityStatus: 'claimed',
};

describe('generate_listing_draft', () => {
  beforeEach(() => {
    rows = [];
    rowIdCounter = 0;
    clock = 0;
    createNotificationMock.mockClear();
  });

  it('is registered as a "write" tool (auto-executed, never confirmation-gated)', async () => {
    const { AiToolRegistry } = await import('@/services/ai/AiToolRegistry');
    expect(AiToolRegistry.get('generate_listing_draft')?.category).toBe('write');
  });

  it('A. builds a draft for a sourceUrl that really appeared in this conversation\'s search_products results', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    const result: any = await generateListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.error).toBeUndefined();
    expect(result.draft.source.sourceUrl).toBe(sourcedItem.sourceUrl);
    expect(result.draft.source.brand).toBe('Prada');
    expect(result.marketplaceValidation.ebay).toBeDefined();
    expect(result.marketplaceValidation.etsy).toBeDefined();
  });

  it('A. a sourceUrl that never appeared in this conversation is rejected — never fabricates a draft', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    const result: any = await generateListingDraftTool.handler(
      'ws-1',
      { sourceUrl: 'https://www.ebay.co.uk/itm/999-never-searched' },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.draft).toBeUndefined();
    expect(result.error).toMatch(/not found among this conversation/i);
  });

  it('H/cross-tenant: a sourceUrl that only appeared in a DIFFERENT conversation is rejected', async () => {
    pushSearchProductsCall('conv-OTHER', 'tu1', [sourcedItem]);

    const result: any = await generateListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl },
      { conversationId: 'conv-1', userId: 'user-1' } // different conversation — never sees conv-OTHER's results
    );

    expect(result.draft).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it('J: never calls any marketplace publish path — result contains no publication confirmation', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    const result: any = await generateListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(JSON.stringify(result)).not.toMatch(/published|externalId/i);
  });

  it('uses the proposed price as a distinct PROPOSAL, never silently replacing the source price', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    const result: any = await generateListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl, proposedPrice: 449, proposedCurrency: 'EUR' },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.draft.fields.price).toBe(449);
    expect(result.draft.source.price).toBe(380); // untouched source cost
  });

  it('AI-first listing workflow: computes the proposed price from an explicit targetMarginPercent, by exact algebra on the real source price', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    const result: any = await generateListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl, targetMarginPercent: 30 },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    // source price 380, 30% margin -> 380 / 0.7 ≈ 542.86
    expect(result.draft.fields.price).toBeCloseTo(542.86, 1);
  });

  it('AI-first listing workflow: triggers an in-app notification with a real deep link back to this conversation', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    const [workspaceId, type, , , , link] = createNotificationMock.mock.calls[0];
    expect(workspaceId).toBe('ws-1');
    expect(type).toBe('listing_draft_ready');
    expect(link).toBe('/dashboard/agent?conversationId=conv-1');
  });

  it('never notifies when the source revalidation fails (no draft was actually generated)', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    await generateListingDraftTool.handler(
      'ws-1',
      { sourceUrl: 'https://www.ebay.co.uk/itm/999-never-searched' },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('AI-first listing workflow: no marginPreview (null, never fabricated) when the draft has no proposed price yet', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    const result: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(result.draft.fields.price).toBeUndefined();
    expect(result.marginPreview).toBeNull();
  });

  it('AI-first listing workflow: computes marginPreview via the same PricingService engine calculate_margin uses, once a proposed price exists', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);

    const result: any = await generateListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl, proposedPrice: 449 },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.marginPreview).toBeDefined();
    expect(result.marginPreview).not.toBeNull();
    expect(result.marginPreview.currency).toBe(result.draft.fields.currency);
    expect(Array.isArray(result.marginPreview.missingData)).toBe(true);
    expect(Array.isArray(result.marginPreview.warnings)).toBe(true);
  });
});

describe('edit_listing_draft', () => {
  beforeEach(() => {
    rows = [];
    rowIdCounter = 0;
    clock = 0;
  });

  it('is registered as a "write" tool', async () => {
    const { AiToolRegistry } = await import('@/services/ai/AiToolRegistry');
    expect(AiToolRegistry.get('edit_listing_draft')?.category).toBe('write');
  });

  it('applies a patch on top of the most recent draft for the same sourceUrl and re-validates', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);
    const generated: any = await generateListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl },
      { conversationId: 'conv-1', userId: 'user-1' }
    );
    pushDraftToolCall('conv-1', 'tu2', 'generate_listing_draft', { sourceUrl: sourcedItem.sourceUrl }, generated);

    const edited: any = await editListingDraftTool.handler(
      'ws-1',
      // Phase 12C-Prep: ebayCategoryId/ebayMarketplaceId are now real,
      // required eBay fields (never inferred) — a full "ready" draft must
      // set them explicitly, exactly like a real seller would.
      { sourceUrl: sourcedItem.sourceUrl, patch: { price: 449, ebayCategoryId: 15709, ebayMarketplaceId: 'EBAY_GB' } },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(edited.draft.fields.price).toBe(449);
    expect(edited.draft.editedFieldKeys).toContain('price');
    expect(edited.marketplaceValidation.ebay.ready).toBe(true);
  });

  it('picks the MOST RECENT draft when edited twice — the second edit builds on the first, not the original', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);
    const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
    pushDraftToolCall('conv-1', 'tu2', 'generate_listing_draft', {}, generated);

    const firstEdit: any = await editListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, patch: { price: 449 } }, { conversationId: 'conv-1', userId: 'user-1' });
    pushDraftToolCall('conv-1', 'tu3', 'edit_listing_draft', {}, firstEdit);

    const secondEdit: any = await editListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, patch: { title: 'Updated title' } }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(secondEdit.draft.fields.price).toBe(449); // carried over from the first edit
    expect(secondEdit.draft.fields.title).toBe('Updated title');
  });

  it('AI-first listing workflow: color/material can only ever be set via an explicit edit, never generated', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);
    const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
    expect(generated.draft.fields.color).toBeUndefined();
    expect(generated.draft.fields.material).toBeUndefined();
    pushDraftToolCall('conv-1', 'tu2', 'generate_listing_draft', {}, generated);

    const edited: any = await editListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl, patch: { color: 'Noir', material: 'Cuir' } },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(edited.draft.fields.color).toBe('Noir');
    expect(edited.draft.fields.material).toBe('Cuir');
    expect(edited.draft.editedFieldKeys).toEqual(expect.arrayContaining(['color', 'material']));
  });

  it('AI-first listing workflow: model can only ever be set via an explicit edit, never generated', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);
    const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
    expect(generated.draft.fields.model).toBeUndefined();
    pushDraftToolCall('conv-1', 'tu2', 'generate_listing_draft', {}, generated);

    const edited: any = await editListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl, patch: { model: 'Cut Out' } },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(edited.draft.fields.model).toBe('Cut Out');
    expect(edited.draft.editedFieldKeys).toContain('model');
  });

  it('AI-first listing workflow: computing a marginPreview after adding a proposed price via edit', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);
    const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
    expect(generated.marginPreview).toBeNull();
    pushDraftToolCall('conv-1', 'tu2', 'generate_listing_draft', {}, generated);

    const edited: any = await editListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl, patch: { price: 449 } },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(edited.marginPreview).toBeDefined();
    expect(edited.marginPreview).not.toBeNull();
  });

  it('AI-first listing workflow: excludeImageUrls/includeImageUrls toggle usable images without ever touching source.images', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);
    const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
    pushDraftToolCall('conv-1', 'tu2', 'generate_listing_draft', {}, generated);

    const excluded: any = await editListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl, patch: {}, excludeImageUrls: [sourcedItem.images[0]] },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(excluded.draft.excludedImageUrls).toEqual([sourcedItem.images[0]]);
    expect(excluded.draft.source.images).toEqual(sourcedItem.images); // never touched
    pushDraftToolCall('conv-1', 'tu3', 'edit_listing_draft', {}, excluded);

    const restored: any = await editListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl, patch: {}, includeImageUrls: [sourcedItem.images[0]] },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(restored.draft.excludedImageUrls).toEqual([]);
  });

  it('AI-first listing workflow: a fabricated/foreign image url is silently ignored, never recorded as excluded', async () => {
    pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);
    const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl }, { conversationId: 'conv-1', userId: 'user-1' });
    pushDraftToolCall('conv-1', 'tu2', 'generate_listing_draft', {}, generated);

    const result: any = await editListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl, patch: {}, excludeImageUrls: ['https://not-a-real-draft-image.example/x.jpg'] },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.draft.excludedImageUrls ?? []).toEqual([]);
  });

  it('rejects editing a sourceUrl with no prior draft in this conversation — never fabricates one', async () => {
    const result: any = await editListingDraftTool.handler(
      'ws-1',
      { sourceUrl: sourcedItem.sourceUrl, patch: { price: 449 } },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.draft).toBeUndefined();
    expect(result.error).toMatch(/no listing draft found/i);
  });

  it('I/XSS: a patch cannot inject unexpected keys — Zod strips anything outside the declared editable fields', () => {
    const parsed = editListingDraftTool.inputSchema.safeParse({
      sourceUrl: sourcedItem.sourceUrl,
      patch: { price: 449, workspaceId: 'ws-ATTACKER', userId: 'user-ATTACKER' },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.patch).not.toHaveProperty('workspaceId');
      expect(parsed.data.patch).not.toHaveProperty('userId');
    }
  });

  it('G: a genuinely invalid sourceUrl (not a URL) is rejected by input validation before the handler ever runs', () => {
    const parsed = editListingDraftTool.inputSchema.safeParse({ sourceUrl: 'not-a-url', patch: { price: 449 } });
    expect(parsed.success).toBe(false);
  });

  describe('publish_listing hardening audit — etsyWhenMade is validated against the real Etsy-accepted values', () => {
    it('rejects a patch with an etsyWhenMade value Etsy does not actually accept', () => {
      const parsed = editListingDraftTool.inputSchema.safeParse({
        sourceUrl: sourcedItem.sourceUrl,
        patch: { etsyWhenMade: '2026_2030' }, // not a real Etsy when_made value
      });
      expect(parsed.success).toBe(false);
    });

    it('accepts a real Etsy-accepted etsyWhenMade value', () => {
      const parsed = editListingDraftTool.inputSchema.safeParse({
        sourceUrl: sourcedItem.sourceUrl,
        patch: { etsyWhenMade: '2020_2025' },
      });
      expect(parsed.success).toBe(true);
    });
  });

  /**
   * Phase 7, section 6 — "Prepare-moi cette annonce pour eBay et Etsy":
   * proves the architecture is Product -> ONE ListingDraft carrying BOTH
   * marketplaces' own fields/validation, never two separate Products and
   * never a shared draft that can only ever be ready for one marketplace
   * at a time. Each marketplace's own readiness/errors/payload stays
   * fully independent even though both live on the exact same draft
   * object (see listingDraft.ts's own validateEbayDraft/validateEtsyDraft
   * — never a single combined validator).
   */
  describe('Phase 7 — same draft prepared for BOTH eBay and Etsy (multi-marketplace, one Product)', () => {
    it('a draft edited with ONLY eBay fields is ready for eBay but explicitly NOT ready for Etsy, with the specific missing fields named', async () => {
      pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);
      const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, proposedPrice: 449, proposedCurrency: 'EUR' }, { conversationId: 'conv-1', userId: 'user-1' });
      pushDraftToolCall('conv-1', 'tu2', 'generate_listing_draft', {}, generated);

      const edited: any = await editListingDraftTool.handler(
        'ws-1',
        { sourceUrl: sourcedItem.sourceUrl, patch: { ebayCategoryId: 15709, ebayMarketplaceId: 'EBAY_GB' } },
        { conversationId: 'conv-1', userId: 'user-1' }
      );

      expect(edited.marketplaceValidation.ebay.ready).toBe(true);
      expect(edited.marketplaceValidation.etsy.ready).toBe(false);
      expect(edited.marketplaceValidation.etsy.missingFields).toEqual(
        expect.arrayContaining(['etsyTaxonomyId', 'etsyWhenMade', 'etsyWhoMade'])
      );
    });

    it('adding the Etsy-only fields on top makes the SAME draft ready for BOTH marketplaces at once — no second Product, no second draft object needed', async () => {
      pushSearchProductsCall('conv-1', 'tu1', [sourcedItem]);
      const generated: any = await generateListingDraftTool.handler('ws-1', { sourceUrl: sourcedItem.sourceUrl, proposedPrice: 449, proposedCurrency: 'EUR' }, { conversationId: 'conv-1', userId: 'user-1' });
      pushDraftToolCall('conv-1', 'tu2', 'generate_listing_draft', {}, generated);

      const ebayReady: any = await editListingDraftTool.handler(
        'ws-1',
        { sourceUrl: sourcedItem.sourceUrl, patch: { ebayCategoryId: 15709, ebayMarketplaceId: 'EBAY_GB' } },
        { conversationId: 'conv-1', userId: 'user-1' }
      );
      pushDraftToolCall('conv-1', 'tu3', 'edit_listing_draft', {}, ebayReady);

      const bothReady: any = await editListingDraftTool.handler(
        'ws-1',
        { sourceUrl: sourcedItem.sourceUrl, patch: { etsyTaxonomyId: 1234, etsyWhenMade: '2020_2025', etsyWhoMade: 'i_did' } },
        { conversationId: 'conv-1', userId: 'user-1' }
      );

      expect(bothReady.marketplaceValidation.ebay.ready).toBe(true);
      expect(bothReady.marketplaceValidation.etsy.ready).toBe(true);
      // Same underlying source item (same Product's provenance) for both.
      expect(bothReady.draft.source.sourceUrl).toBe(sourcedItem.sourceUrl);
      // Distinct, marketplace-specific fields coexist without conflict.
      expect(bothReady.draft.fields.ebayCategoryId).toBe(15709);
      expect(bothReady.draft.fields.etsyTaxonomyId).toBe(1234);
    });
  });
});

/**
 * Free listing creation (real photo analysis) — generate_listing_draft/
 * edit_listing_draft's FREE mode: no sourceUrl at all, for an item the
 * reseller already owns. Proves the mode is actually implemented (not
 * just described in the system prompt — see the readiness audit's P0
 * finding), without ever regressing the sourced mode proven above.
 */
describe('generate_listing_draft — FREE mode (no sourceUrl, self-declared item)', () => {
  beforeEach(() => {
    rows = [];
    rowIdCounter = 0;
    clock = 0;
    createNotificationMock.mockClear();
  });

  it('1. generates a draft with no sourceUrl at all, from the reseller\'s own stated title', async () => {
    const result: any = await generateListingDraftTool.handler(
      'ws-1',
      { title: 'Sac à main vintage' },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.error).toBeUndefined();
    expect(result.draft.source.kind).toBe('free');
    expect(result.draft.source.sourceUrl).toBeUndefined();
    expect(result.draft.fields.title).toBe('Sac à main vintage');
    expect(result.draftId).toBe(result.draft.source.sourceItemId);
    expect(result.draftId).toMatch(/^free-/);
  });

  it('2. a free draft automatically attaches a real photo already uploaded to this conversation', async () => {
    pushPhotoUploadCall('conv-1', 'photo-tu1', [
      { url: 'https://supabase.example/ws-1/_draft-uploads/conv-1/photo1.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/photo1.jpg', mimeType: 'image/jpeg' },
    ]);

    const result: any = await generateListingDraftTool.handler(
      'ws-1',
      { title: 'Montre vintage', condition: 'bon état' },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.draft.source.images).toEqual(['https://supabase.example/ws-1/_draft-uploads/conv-1/photo1.jpg']);
  });

  it('3. a free draft attaches MULTIPLE real photos, in the order they were uploaded', async () => {
    pushPhotoUploadCall('conv-1', 'photo-tu1', [
      { url: 'https://supabase.example/a.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/a.jpg', mimeType: 'image/jpeg' },
      { url: 'https://supabase.example/b.jpg', storagePath: 'ws-1/_draft-uploads/conv-1/b.jpg', mimeType: 'image/jpeg' },
    ]);

    const result: any = await generateListingDraftTool.handler('ws-1', { title: 'Veste en cuir' }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(result.draft.source.images).toEqual(['https://supabase.example/a.jpg', 'https://supabase.example/b.jpg']);
  });

  it('4. a free draft with NO photo at all still generates from text information alone', async () => {
    const result: any = await generateListingDraftTool.handler('ws-1', { title: 'Livre ancien', condition: 'bon état' }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(result.error).toBeUndefined();
    expect(result.draft.source.images).toEqual([]);
    expect(result.draft.fields.title).toBe('Livre ancien');
  });

  it('5. missing the one indispensable field (title) is rejected by input validation before the handler ever runs — the "insufficient information" control', () => {
    const parsed = generateListingDraftTool.inputSchema.safeParse({ condition: 'bon état' });
    expect(parsed.success).toBe(false);
  });

  it('6. edit_listing_draft edits a free draft by draftId, never a sourceUrl (which a free draft never has)', async () => {
    const generated: any = await generateListingDraftTool.handler('ws-1', { title: 'Sac à main vintage' }, { conversationId: 'conv-1', userId: 'user-1' });
    pushDraftToolCall('conv-1', 'tu1', 'generate_listing_draft', { title: 'Sac à main vintage' }, generated);

    const edited: any = await editListingDraftTool.handler(
      'ws-1',
      { draftId: generated.draftId, patch: { price: 89, ebayCategoryId: 15709, ebayMarketplaceId: 'EBAY_FR' } },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(edited.error).toBeUndefined();
    expect(edited.draft.fields.price).toBe(89);
    expect(edited.draft.source.kind).toBe('free');
    expect(edited.draftId).toBe(generated.draftId);
  });

  it('7. a patch with an invalid field (e.g. a non-Etsy-accepted etsyWhenMade) is rejected by validation, in free mode exactly like sourced mode', () => {
    const parsed = editListingDraftTool.inputSchema.safeParse({
      draftId: 'free-abc',
      patch: { etsyWhenMade: 'not-a-real-value' },
    });
    expect(parsed.success).toBe(false);
  });

  it('8. never invents brand/condition/size/color/material/model the reseller did not state — every omitted field stays genuinely absent, never defaulted', async () => {
    const result: any = await generateListingDraftTool.handler('ws-1', { title: 'Sac à main vintage' }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(result.draft.fields.brand).toBeUndefined();
    expect(result.draft.fields.condition).toBeUndefined();
    expect(result.draft.fields.size).toBeUndefined();
    expect(result.draft.fields.color).toBeUndefined();
    expect(result.draft.fields.material).toBeUndefined();
    expect(result.draft.fields.model).toBeUndefined();
  });

  it('never computes a marginPreview for a free draft — there is no sourced purchase cost to base one on', async () => {
    const result: any = await generateListingDraftTool.handler(
      'ws-1',
      { title: 'Sac à main vintage', proposedPrice: 89 },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.marginPreview).toBeNull();
  });

  it('rejects editing a draftId with no prior draft in this conversation — never fabricates one', async () => {
    const result: any = await editListingDraftTool.handler(
      'ws-1',
      { draftId: 'free-never-generated', patch: { price: 89 } },
      { conversationId: 'conv-1', userId: 'user-1' }
    );

    expect(result.draft).toBeUndefined();
    expect(result.error).toMatch(/no listing draft found/i);
  });

  it('still triggers the same in-app notification as the sourced mode', async () => {
    await generateListingDraftTool.handler('ws-1', { title: 'Sac à main vintage' }, { conversationId: 'conv-1', userId: 'user-1' });

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    const [workspaceId, type] = createNotificationMock.mock.calls[0];
    expect(workspaceId).toBe('ws-1');
    expect(type).toBe('listing_draft_ready');
  });

  /**
   * P1-1 fix (final review finding) — generate_listing_draft's own
   * description is sent VERBATIM to Anthropic (see AgentToolDefinition's
   * own comment in tools/types.ts) and must never tell the model to pass
   * a free-mode draftId to create_product, which has no such field and
   * only ever accepts a real sourceMarketplace/sourceId/sourceUrl triple
   * (see actionTools.ts's createProductInputSchema, untouched by free
   * listing creation). Contradicting SYSTEM_PROMPT_INSTRUCTIONS' own
   * explicit "create_product does not support free mode" note would
   * confuse the model into attempting a call that can only ever fail
   * Zod validation.
   */
  it('P1-1: the tool description never instructs the model to pass draftId to create_product, and explicitly says create_product does not accept one', () => {
    // The old, contradictory phrasing this fix removed — must never
    // reappear verbatim.
    expect(generateListingDraftTool.description).not.toContain('edit_listing_draft/create_product');
    // The corrective phrasing this fix added — proves the description now
    // explicitly rules out the misuse, not just omits the old wording.
    expect(generateListingDraftTool.description).toMatch(/NEVER to create_product/);
    expect(generateListingDraftTool.description).toMatch(/create_product, which does not accept a draftId/);
  });

  it('P1-1: create_product\'s own schema genuinely has no draftId field — confirms the corrected description matches reality, and that create_product itself was never touched by free listing creation', async () => {
    const { createProductTool } = await import('@/services/ai/tools/actionTools');
    expect(createProductTool.category).toBe('engage');
    const parsed = createProductTool.inputSchema.safeParse({ draftId: 'free-abc', title: 'x', sellingPrice: 1, purchasePrice: 1 });
    expect(parsed.success).toBe(false);
  });
});

/**
 * P2-2 fix (final review finding) — before this fix, generate_listing_draft's
 * z.union tried the sourced schema first; since it was non-strict, a call
 * mixing {sourceUrl, title} together matched the sourced branch silently
 * and dropped `title` with no error at all — an ambiguous call could
 * produce a draft in a mode the model didn't necessarily intend, with
 * nothing telling it so. `.strict()` on both top-level branches now makes
 * BOTH branches reject the mix, so the whole union fails explicitly.
 */
describe('generate_listing_draft / edit_listing_draft — mode exclusivity (P2-2 fix)', () => {
  it('mixing sourceUrl (sourced) and title (free) together is REJECTED, never silently treated as sourced mode with title dropped', () => {
    const parsed = generateListingDraftTool.inputSchema.safeParse({
      sourceUrl: 'https://www.ebay.co.uk/itm/111',
      title: 'Sac à main vintage',
    });
    expect(parsed.success).toBe(false);
  });

  it('a pure sourced call (sourceUrl only) still parses successfully — no regression from .strict()', () => {
    const parsed = generateListingDraftTool.inputSchema.safeParse({ sourceUrl: 'https://www.ebay.co.uk/itm/111', proposedPrice: 449 });
    expect(parsed.success).toBe(true);
  });

  it('a pure free call (title only) still parses successfully — no regression from .strict()', () => {
    const parsed = generateListingDraftTool.inputSchema.safeParse({ title: 'Sac à main vintage', condition: 'bon état' });
    expect(parsed.success).toBe(true);
  });

  it('edit_listing_draft: mixing sourceUrl and draftId together is REJECTED, never silently treated as sourced mode', () => {
    const parsed = editListingDraftTool.inputSchema.safeParse({
      sourceUrl: 'https://www.ebay.co.uk/itm/111',
      draftId: 'free-abc123',
      patch: { price: 89 },
    });
    expect(parsed.success).toBe(false);
  });

  it('edit_listing_draft: a pure sourced call (sourceUrl only) still parses successfully — no regression from .strict()', () => {
    const parsed = editListingDraftTool.inputSchema.safeParse({ sourceUrl: 'https://www.ebay.co.uk/itm/111', patch: { price: 449 } });
    expect(parsed.success).toBe(true);
  });

  it('edit_listing_draft: a pure free call (draftId only) still parses successfully — no regression from .strict()', () => {
    const parsed = editListingDraftTool.inputSchema.safeParse({ draftId: 'free-abc123', patch: { price: 89 } });
    expect(parsed.success).toBe(true);
  });

  it('edit_listing_draft: the nested patch object still silently strips unknown keys exactly as before (.strict() only applies to the TOP level)', () => {
    const parsed = editListingDraftTool.inputSchema.safeParse({
      draftId: 'free-abc123',
      patch: { price: 89, workspaceId: 'ws-ATTACKER' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect((parsed.data as any).patch).not.toHaveProperty('workspaceId');
    }
  });
});
