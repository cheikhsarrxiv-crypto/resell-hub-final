import { z } from 'zod';
import { AgentToolDefinition } from './types';
import { findLatestDraft } from './listingDraftTools';
import { validateEbayDraft, mapDraftToEbayInput, validateEtsyDraft, mapDraftToEtsyInput } from '@/lib/listing/listingDraft';
import { getAuthenticatedAdapter } from '@/services/ListingService';
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
