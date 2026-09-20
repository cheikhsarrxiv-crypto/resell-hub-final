import { z } from 'zod';
import { AgentToolDefinition } from './types';
import { findLatestDraft } from './listingDraftTools';
import { validateEbayDraft, mapDraftToEbayInput, validateEtsyDraft, mapDraftToEtsyInput } from '@/lib/listing/listingDraft';
import { ListingService, getAuthenticatedAdapter } from '@/services/ListingService';
import { isRealEbayPublishEnabled, describeEbayEnvironment } from './ebayPublishGuard';
import { isRealEtsyPublishEnabled, describeEtsyEnvironment } from './etsyPublishGuard';

/**
 * Phase 12C-Offline — no policy (payment/return/fulfillment) storage or
 * retrieval exists anywhere in this codebase yet (confirmed by the
 * Phase 12C-Prep/Offline audits). Rather than silently omit this or
 * invent a policyId, every eBay publish preview says so explicitly and
 * uniformly — a real policy-lookup can replace this constant later
 * without changing anything else in this tool.
 */
const EBAY_POLICY_STATUS = 'POLICY_CONFIGURATION_REQUIRED' as const;
const EBAY_MISSING_POLICIES = ['paymentPolicyId', 'returnPolicyId', 'fulfillmentPolicyId'] as const;

/**
 * Phase 12A — the framework's minimum required non-destructive 'engage'
 * action: proposing, confirming, and "executing" this has zero real
 * effect on any data, account, or marketplace, whatever the outcome. It
 * exists purely to exercise the full
 * propose -> preview -> confirm -> execute -> audit pipeline
 * (AiActionService) end-to-end without depending on any other tool or
 * real workspace data.
 */
const simulateEngageInputSchema = z.object({
  note: z.string().max(500).optional(),
});

export const simulateEngageActionTool: AgentToolDefinition<{ note?: string }> = {
  name: 'simulate_engage_action',
  description:
    'Internal framework-testing action for the ADKSY Agent action pipeline. Proposes a simulated action that requires confirmation like a real one, but has NO real effect on any data, account, or marketplace whether or not it is confirmed. Not a real capability — never use this to imply a real action happened.',
  category: 'engage',
  inputSchema: simulateEngageInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description: 'Optional short note to include in the simulated summary, for testing purposes only.',
      },
    },
  },
  async preview(_workspaceId, input) {
    return {
      action: 'simulate_engage_action',
      simulated: true,
      note: input.note ?? null,
      message: 'This is a framework test action. Confirming it has no real effect.',
    };
  },
  async handler(_workspaceId, input) {
    return {
      simulated: true,
      note: input.note ?? null,
      message: 'Simulated execution completed. No real external or financial effect occurred.',
    };
  },
};

const publishListingInputSchema = z.object({
  sourceUrl: z.string().url(),
});

/**
 * Phase 12C-Offline — connects the real pipeline:
 * generate_listing_draft -> edit_listing_draft -> (preview) -> confirm ->
 * (handler) execute. `sourceUrl` is the ONLY input — never a raw
 * marketplaceId/categoryId/workspaceId the model or client could supply
 * directly; those all come from the already-revalidated ListingDraft
 * (see findLatestDraft, the exact same conversation-history revalidation
 * generate_listing_draft/edit_listing_draft already use — a sourceUrl
 * that never produced a draft IN THIS CONVERSATION is rejected, never
 * accepted on trust).
 *
 * Still 'engage' — never auto-executed (see AiToolRegistry.isAutoExecutable).
 * preview() builds the real payload (mapDraftToEbayInput) and stores it
 * verbatim as the confirmable AgentAction's summary, so what the reseller
 * confirms is exactly what handler() would send — never a separately
 * hand-written preview that could drift from reality.
 *
 * ABSOLUTE SAFEGUARD: handler() only ever reaches getAuthenticatedAdapter/
 * adapter.createListing when isRealEbayPublishEnabled() is true —
 * ENABLE_REAL_EBAY_PUBLISH must be the literal string 'true', which is
 * never set anywhere in this codebase or by any test. In every
 * environment where that variable is unset (every environment this was
 * developed and tested in), handler() returns a clearly-labeled
 * simulation and never imports/calls anything network-capable.
 */
export const publishListingTool: AgentToolDefinition<{ sourceUrl: string }> = {
  name: 'publish_listing',
  description:
    'Propose publishing the listing draft already prepared for sourceUrl (via generate_listing_draft/edit_listing_draft) IN THIS CONVERSATION to its target eBay marketplace. ' +
    "sourceUrl must match a draft this conversation already produced — never accepted on trust. Requires the reseller's explicit confirmation before anything happens. " +
    'The draft must be fully ready for eBay (see validateEbayDraft) or this is rejected with the specific reason. ' +
    'Payment/return/fulfillment policies are not yet managed by ADKSY — always flagged as requiring manual verification, never assumed. ' +
    'Never claim a listing was really published unless the result explicitly says so.',
  category: 'engage',
  inputSchema: publishListingInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      sourceUrl: {
        type: 'string',
        description: 'The sourceUrl of the product whose draft to publish — must already have a ready draft in this conversation.',
      },
    },
    required: ['sourceUrl'],
  },
  async preview(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const draft = await findLatestDraft(context.conversationId, input.sourceUrl, workspaceId);
    if (!draft) {
      return { error: 'No listing draft found for this product in this conversation. Generate one first with generate_listing_draft.' };
    }

    const validation = validateEbayDraft(draft);
    if (!validation.ready) {
      return { error: `This listing draft is not ready for eBay: ${validation.errors.join('; ')}` };
    }

    const ebayInput = mapDraftToEbayInput(draft);
    if (!ebayInput) {
      return { error: 'Listing draft could not be mapped to a valid eBay payload.' };
    }

    const realPublishEnabled = isRealEbayPublishEnabled();

    return {
      action: 'publish_listing',
      marketplace: 'eBay',
      environment: describeEbayEnvironment(),
      ...ebayInput,
      policyStatus: EBAY_POLICY_STATUS,
      missingPolicies: EBAY_MISSING_POLICIES,
      simulatedOnly: !realPublishEnabled,
      message: realPublishEnabled
        ? 'Confirming this action will attempt a real eBay publish in this environment.'
        : 'Confirming this action will NOT publish a real listing — real eBay publishing is disabled in this environment.',
    };
  },
  async handler(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const draft = await findLatestDraft(context.conversationId, input.sourceUrl, workspaceId);
    if (!draft) {
      return { error: 'No listing draft found for this product in this conversation. Generate one first with generate_listing_draft.' };
    }

    const validation = validateEbayDraft(draft);
    if (!validation.ready) {
      return { error: `This listing draft is not ready for eBay: ${validation.errors.join('; ')}` };
    }

    const ebayInput = mapDraftToEbayInput(draft);
    if (!ebayInput) {
      return { error: 'Listing draft could not be mapped to a valid eBay payload.' };
    }

    if (!isRealEbayPublishEnabled()) {
      return {
        simulated: true,
        reason: 'Real eBay publishing is disabled in this environment (ENABLE_REAL_EBAY_PUBLISH is not set to "true").',
        wouldHaveSent: ebayInput,
        message: 'Simulation only — no real marketplace call was made.',
      };
    }

    // Real path — never exercised in this environment (the flag above is
    // always false here; see the Phase 12C-Offline report's own "zero
    // real eBay call" confirmation). Any failure here (auth, validation,
    // network) propagates unmodified to AiActionService.confirmAndExecute's
    // own catch, which already logs it safely and stores only a generic,
    // secret-free error message — never a second, ad-hoc error handler
    // here that could diverge from that guarantee.
    const adapter = await getAuthenticatedAdapter(workspaceId, 'ebay');
    const result = await adapter.createListing(ebayInput as any);
    return {
      published: true,
      externalId: result.externalId,
      status: result.status,
    };
  },
};

const publishEtsyListingInputSchema = z.object({
  sourceUrl: z.string().url(),
});

/**
 * The Etsy equivalent of publish_listing above — same pipeline shape
 * (generate_listing_draft -> edit_listing_draft -> preview -> confirm ->
 * handler), same revalidation via findLatestDraft, same "sourceUrl is the
 * only input" rule, same absolute safeguard pattern (isRealEtsyPublishEnabled
 * instead of isRealEbayPublishEnabled — a SEPARATE flag, ENABLE_REAL_ETSY_PUBLISH,
 * never enabled by enabling the eBay one or vice versa).
 *
 * Deliberately a SEPARATE tool rather than a generalized "publish_listing"
 * with a marketplace parameter: eBay and Etsy require genuinely different
 * validation (validateEbayDraft vs validateEtsyDraft) and produce a
 * genuinely different payload shape (mapDraftToEbayInput vs
 * mapDraftToEtsyInput — Etsy has no policyStatus/currency/condition/images
 * concept at all in EtsyAdapter.createListing). A shared tool would need
 * to branch internally on marketplace anyway, with no reduction in real
 * complexity, and would risk the two pipelines becoming coupled — this
 * keeps the working eBay tool completely untouched.
 */
export const publishEtsyListingTool: AgentToolDefinition<{ sourceUrl: string }> = {
  name: 'publish_etsy_listing',
  description:
    'Propose publishing the listing draft already prepared for sourceUrl (via generate_listing_draft/edit_listing_draft) IN THIS CONVERSATION to Etsy. ' +
    "sourceUrl must match a draft this conversation already produced — never accepted on trust. Requires the reseller's explicit confirmation before anything happens. " +
    'The draft must be fully ready for Etsy (see validateEtsyDraft — requires who_made/when_made/taxonomy_id, never guessed) or this is rejected with the specific reason. ' +
    'Never claim a listing was really published unless the result explicitly says so.',
  category: 'engage',
  inputSchema: publishEtsyListingInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      sourceUrl: {
        type: 'string',
        description: 'The sourceUrl of the product whose draft to publish — must already have a ready draft in this conversation.',
      },
    },
    required: ['sourceUrl'],
  },
  async preview(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const draft = await findLatestDraft(context.conversationId, input.sourceUrl, workspaceId);
    if (!draft) {
      return { error: 'No listing draft found for this product in this conversation. Generate one first with generate_listing_draft.' };
    }

    const validation = validateEtsyDraft(draft);
    if (!validation.ready) {
      return { error: `This listing draft is not ready for Etsy: ${validation.errors.join('; ')}` };
    }

    const etsyInput = mapDraftToEtsyInput(draft);
    if (!etsyInput) {
      return { error: 'Listing draft could not be mapped to a valid Etsy payload.' };
    }

    const realPublishEnabled = isRealEtsyPublishEnabled();

    return {
      action: 'publish_etsy_listing',
      marketplace: 'Etsy',
      environment: describeEtsyEnvironment(),
      ...etsyInput,
      simulatedOnly: !realPublishEnabled,
      message: realPublishEnabled
        ? 'Confirming this action will attempt a real Etsy publish in this environment.'
        : 'Confirming this action will NOT publish a real listing — real Etsy publishing is disabled in this environment.',
    };
  },
  async handler(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const draft = await findLatestDraft(context.conversationId, input.sourceUrl, workspaceId);
    if (!draft) {
      return { error: 'No listing draft found for this product in this conversation. Generate one first with generate_listing_draft.' };
    }

    const validation = validateEtsyDraft(draft);
    if (!validation.ready) {
      return { error: `This listing draft is not ready for Etsy: ${validation.errors.join('; ')}` };
    }

    const etsyInput = mapDraftToEtsyInput(draft);
    if (!etsyInput) {
      return { error: 'Listing draft could not be mapped to a valid Etsy payload.' };
    }

    if (!isRealEtsyPublishEnabled()) {
      return {
        simulated: true,
        reason: 'Real Etsy publishing is disabled in this environment (ENABLE_REAL_ETSY_PUBLISH is not set to "true").',
        wouldHaveSent: etsyInput,
        message: 'Simulation only — no real marketplace call was made.',
      };
    }

    // Real path — never exercised in this environment (the flag above is
    // always false here). Any failure here (auth, validation, network)
    // propagates unmodified to AiActionService.confirmAndExecute's own
    // catch, which already logs it safely and stores only a generic,
    // secret-free error message — never a second, ad-hoc error handler
    // here that could diverge from that guarantee.
    const adapter = await getAuthenticatedAdapter(workspaceId, 'etsy');
    const result = await adapter.createListing(etsyInput as any);
    return {
      published: true,
      externalId: result.externalId,
      status: result.status,
    };
  },
};

/**
 * update_listing — proposes changing an EXISTING listing's title,
 * description, price, and/or quantity. 'engage' (not 'write'): unlike a
 * ListingDraft, a real Listing is a live business record already visible
 * everywhere else in the app, so every change — even one that never
 * touches a marketplace — always goes through the same
 * propose -> preview -> confirm -> execute pipeline as publish_listing,
 * never a second confirmation mechanism.
 *
 * CAPABILITY AUDIT (this file's own — verified against the real adapters,
 * never assumed from a schema comment):
 * - EbayAdapter.updateListing really supports title/description/quantity.
 *   Price is NOT supported here: it requires a `currency` alongside the
 *   new price value (EbayAdapter.updateListing throws otherwise), and
 *   ADKSY has no currency stored anywhere for an already-published Listing
 *   (Listing has no currency column at all — a draft's currency is
 *   ephemeral, conversation-scoped, and gone once the listing is created).
 *   Guessing a currency (e.g. defaulting to EUR) would be exactly the kind
 *   of invented data this project never allows, so eBay price changes are
 *   deliberately refused with a clear, honest reason rather than silently
 *   attempted or silently dropped.
 * - EtsyAdapter.updateListing really supports title/description/price/
 *   quantity — no currency requirement (Etsy's price field is a plain
 *   number), so all four are available for Etsy.
 * - DepopAdapter.updateListing / VintedAdapter.updateListing both
 *   unconditionally throw ("BLOCKED - requires approved Depop partner
 *   access" / not supported) — neither marketplace supports any field.
 * - A listing with no marketplace connection, or one that was never
 *   actually published (no externalId yet — ListingService.updateListing's
 *   own condition for whether it calls the adapter at all), has no
 *   marketplace to sync to: every field is a local-only ADKSY edit, and
 *   ListingService.updateListing already skips the marketplace call for
 *   exactly this case, so it's reused as-is.
 * - Listing.status has no update_listing field at all: no adapter's
 *   updateListing accepts a status/lifecycle value — delisting is a
 *   completely separate real operation (ListingService.deleteListing,
 *   its own adapter.deleteListing call), not a "change" this tool makes.
 */
const MARKETPLACE_UPDATE_CAPABILITIES: Record<string, readonly string[]> = {
  ebay: ['title', 'description', 'quantity'],
  etsy: ['title', 'description', 'price', 'quantity'],
  depop: [],
  vinted: [],
};

// Mirrors createListingSchema/updateListingSchema's own real constraints
// (src/lib/validations.ts) exactly — the app's one existing definition of
// a valid listing title/description/price/quantity — rather than inventing
// separate rules for this tool.
const updateListingChangesSchema = z
  .object({
    title: z.string().min(5).optional(),
    description: z.string().min(20).optional(),
    price: z.number().min(0.01).optional(),
    quantity: z.number().int().min(1).optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, { message: 'At least one field to change is required' });

const updateListingInputSchema = z.object({
  listingId: z.string().min(1, 'listingId is required'),
  changes: updateListingChangesSchema,
});

type UpdateListingInput = z.infer<typeof updateListingInputSchema>;
type UpdateListingChanges = z.infer<typeof updateListingChangesSchema>;

type ListingWithConnection = NonNullable<Awaited<ReturnType<typeof ListingService.getListing>>>;

/**
 * Whether ListingService.updateListing will actually call a marketplace
 * adapter for this listing — its OWN real condition
 * (`listing.connection && listing.externalId`), mirrored here rather than
 * re-derived differently, so this tool's capability check always agrees
 * with what will really happen at execute time.
 */
function resolveUpdateTarget(listing: ListingWithConnection): { marketplaceKey: string | null; marketplaceDisplayName: string | null } {
  const willCallMarketplace = Boolean(listing.connection && listing.externalId);
  if (!willCallMarketplace) {
    return { marketplaceKey: null, marketplaceDisplayName: null };
  }
  return {
    marketplaceKey: listing.connection!.marketplace.name,
    marketplaceDisplayName: listing.connection!.marketplace.displayName,
  };
}

function getUnsupportedFields(marketplaceKey: string | null, changes: UpdateListingChanges): string[] {
  // No marketplace call will be made at all (no connection, or never
  // actually published) — every field is a local-only ADKSY edit.
  if (!marketplaceKey) return [];
  const supported = MARKETPLACE_UPDATE_CAPABILITIES[marketplaceKey] ?? [];
  return Object.keys(changes).filter((field) => !supported.includes(field));
}

function buildUnsupportedFieldsError(marketplaceDisplayName: string, marketplaceKey: string, unsupported: string[]): string {
  const supported = MARKETPLACE_UPDATE_CAPABILITIES[marketplaceKey] ?? [];
  if (supported.length === 0) {
    return `${marketplaceDisplayName} listings cannot be updated through ADKSY today (no real update capability is implemented for this marketplace).`;
  }
  if (unsupported.includes('price') && marketplaceKey === 'ebay') {
    return (
      `Price cannot be changed on this eBay listing: ADKSY has no stored currency for it and never assumes one. ` +
      `Fields ADKSY can update on eBay: ${supported.join(', ')}.`
    );
  }
  return `${unsupported.join(', ')} cannot be changed on this ${marketplaceDisplayName} listing. Fields ADKSY can update here: ${supported.join(', ')}.`;
}

async function loadUpdatableListing(workspaceId: string, listingId: string): Promise<{ listing: ListingWithConnection } | { error: string }> {
  const listing = await ListingService.getListing(listingId, workspaceId);
  if (!listing) {
    return { error: 'Listing not found in this workspace.' };
  }
  if (listing.deletedAt) {
    return { error: 'This listing has been deleted and can no longer be updated.' };
  }
  return { listing };
}

export const updateListingTool: AgentToolDefinition<UpdateListingInput> = {
  name: 'update_listing',
  description:
    "Propose changing an existing listing's title, description, price, and/or quantity in the reseller's own workspace. " +
    'Always requires the reseller\'s explicit confirmation before anything changes — a request to change a listing is never treated as confirmation ' +
    'by itself. Which fields can really be changed depends on the listing\'s marketplace: eBay supports title/description/quantity only (price cannot ' +
    'be changed there because ADKSY has no stored currency for an already-published listing and never assumes one); Etsy supports all four fields; ' +
    "Depop and Vinted listings cannot be updated at all today. A listing with no marketplace connection (or never actually published) is a local-only " +
    'ADKSY edit, so every field is available. There is no way to change a listing\'s status/lifecycle (active/delisted/etc.) through this tool — no ' +
    'marketplace update operation supports that; delisting is a separate action. Rejects the whole request (never applies part of it) if any requested ' +
    "field isn't really supported for this listing.",
  category: 'engage',
  inputSchema: updateListingInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      listingId: { type: 'string', description: 'The ADKSY listing id (Listing.id) to update.' },
      changes: {
        type: 'object',
        description: 'At least one field to change. Only fields actually provided are changed — everything else stays as-is.',
        properties: {
          title: { type: 'string', description: 'New title (at least 5 characters).' },
          description: { type: 'string', description: 'New description (at least 20 characters).' },
          price: { type: 'number', description: 'New price (must be positive). Not available for an eBay-published listing — see this tool\'s description.' },
          quantity: { type: 'number', description: 'New quantity (must be at least 1).' },
        },
      },
    },
    required: ['listingId', 'changes'],
  },
  async preview(workspaceId, input) {
    const loaded = await loadUpdatableListing(workspaceId, input.listingId);
    if ('error' in loaded) return { error: loaded.error };
    const { listing } = loaded;

    const { marketplaceKey, marketplaceDisplayName } = resolveUpdateTarget(listing);
    const unsupported = getUnsupportedFields(marketplaceKey, input.changes);
    if (unsupported.length > 0) {
      return { error: buildUnsupportedFieldsError(marketplaceDisplayName!, marketplaceKey!, unsupported) };
    }

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (input.changes.title !== undefined) changes.title = { before: listing.title, after: input.changes.title };
    if (input.changes.description !== undefined) changes.description = { before: listing.description, after: input.changes.description };
    if (input.changes.price !== undefined) changes.price = { before: listing.price, after: input.changes.price };
    if (input.changes.quantity !== undefined) changes.quantity = { before: listing.quantity, after: input.changes.quantity };

    return {
      action: 'update_listing',
      listingId: listing.id,
      marketplace: marketplaceKey ? { name: marketplaceKey, displayName: marketplaceDisplayName } : null,
      changes,
      willSyncToMarketplace: marketplaceKey !== null,
      message: marketplaceKey
        ? `Confirming this will update the listing on ${marketplaceDisplayName} and in ADKSY.`
        : 'This listing is not currently published on any marketplace — confirming this will update it in ADKSY only.',
    };
  },
  async handler(workspaceId, input) {
    const loaded = await loadUpdatableListing(workspaceId, input.listingId);
    if ('error' in loaded) return { error: loaded.error };
    const { listing } = loaded;

    const { marketplaceKey } = resolveUpdateTarget(listing);
    const unsupported = getUnsupportedFields(marketplaceKey, input.changes);
    if (unsupported.length > 0) {
      const { marketplaceDisplayName } = resolveUpdateTarget(listing);
      return { error: buildUnsupportedFieldsError(marketplaceDisplayName!, marketplaceKey!, unsupported) };
    }

    // ListingService.updateListing is the SAME real execution path the
    // human-facing dashboard edit already uses — marketplace call first
    // (only when connection+externalId exist, exactly the condition this
    // tool already checked above), DB update only once that succeeds (or
    // skipped entirely for a local-only listing). Never reimplemented
    // here. A real marketplace failure propagates unmodified to
    // AiActionService.confirmAndExecute's own catch, exactly like
    // publish_listing/publish_etsy_listing's own real-call branch — never
    // a second, ad-hoc error handler here.
    const updated = await ListingService.updateListing(input.listingId, workspaceId, input.changes);

    return {
      success: true,
      listingId: updated.id,
      marketplace: marketplaceKey,
      syncedToMarketplace: marketplaceKey !== null,
      updated: {
        title: updated.title,
        description: updated.description,
        price: updated.price,
        quantity: updated.quantity,
      },
    };
  },
};
