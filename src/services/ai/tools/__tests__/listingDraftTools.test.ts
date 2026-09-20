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
});
