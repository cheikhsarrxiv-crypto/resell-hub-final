import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AgentToolDefinition } from './types';
import { findLatestDraft } from './listingDraftTools';
import { validateEbayDraft, mapDraftToEbayInput, validateEtsyDraft, mapDraftToEtsyInput } from '@/lib/listing/listingDraft';
import { ListingService, getAuthenticatedAdapter } from '@/services/ListingService';
import { OrderService } from '@/services/OrderService';
import { FulfillmentService } from '@/services/FulfillmentService';
import { SubscriptionService } from '@/services/SubscriptionService';
import { isRealEbayPublishEnabled, describeEbayEnvironment } from './ebayPublishGuard';
import { isRealEtsyPublishEnabled, describeEtsyEnvironment } from './etsyPublishGuard';
import { reconcileStuckListing, type EbayOfferLookup } from '@/services/listing/ListingReconciliationService';
import { ProductService, PRODUCT_SKU_CONFLICT_MESSAGE, PRODUCT_SOURCE_CONFLICT_MESSAGE } from '@/services/ProductService';
import { createProductSchema } from '@/lib/validations';
import { findToolResultsByName } from './conversationToolResults';
import { isNormalizedSourcingResult } from '@/lib/ai/sourcingResults';

/**
 * Persistence-architecture audit (see the "Architecture A" report) — a
 * successful adapter.createListing() previously never created a local
 * Listing row at all. Fixed here by reusing ONLY two things that already
 * exist and are correct, never by reimplementing them differently:
 * - the DB-level partial unique index on (productId, marketplaceConnectionId)
 *   WHERE deletedAt IS NULL (see prisma/schema.prisma's Listing model
 *   comment) — the real anti-duplicate-publish guard, no new migration.
 * - the exact reserve-before-call ('syncing') / update-after-result
 *   ('synced' or 'failed') state machine ListingService.createListing
 *   already uses for the human dashboard's publish flow — mirrored here
 *   rather than imported, since ListingService.createListing builds its
 *   own (currently incomplete for eBay — a separate, pre-existing bug not
 *   fixed here) payload from Product fields, while this pipeline's payload
 *   always comes from the already-validated ListingDraft.
 *
 * Architecture A (validated): publish_listing/publish_etsy_listing require
 * a real, existing, workspace-owned productId — never a Product created on
 * the fly from a sourced item (that would require inventing purchasePrice/
 * location/currency, which this project never does). sourceUrl identifies
 * where the item was FOUND (the draft's own source), never an ADKSY
 * Product — those are permanently separate identifier spaces.
 */
async function loadPublishableProduct(
  workspaceId: string,
  productId: string
): Promise<{ product: { id: string; sku: string; sourceUrl: string | null } } | { error: string }> {
  const product = await prisma.product.findFirst({
    where: { id: productId, workspaceId, deletedAt: null },
    select: { id: true, sku: true, sourceUrl: true },
  });
  if (!product) {
    return { error: "Product not found in this workspace. Publishing requires an existing ADKSY product — sourceUrl never identifies one on its own." };
  }
  return { product };
}

/**
 * Phase 7 audit finding: nothing previously checked that the productId a
 * publish call names is actually THE product the draft (sourceUrl) was
 * prepared for — a draft generated for one sourced item could be published
 * under any other unrelated, workspace-owned Product's identity (its own
 * real SKU), which is exactly the "publishes the wrong Product" risk this
 * phase's audit called out. Only enforced when the product itself carries
 * real source provenance (product.sourceUrl set, i.e. it was created via
 * create_product from a sourced item) — a manually-created product (no
 * recorded source) is unaffected, preserving that existing, legitimate use
 * of a listing draft.
 */
function checkDraftMatchesProduct(product: { sourceUrl: string | null }, draftSourceItemId: string): { error: string } | null {
  if (product.sourceUrl && product.sourceUrl !== draftSourceItemId) {
    return { error: "This listing draft was prepared for a different sourced item than this product's own recorded source — refusing to publish it under the wrong product." };
  }
  return null;
}

async function loadMarketplaceConnectionForPublish(
  workspaceId: string,
  marketplaceName: string,
  marketplaceDisplayName: string
): Promise<{ connection: { id: string } } | { error: string }> {
  const connection = await prisma.marketplaceConnection.findFirst({
    where: { workspaceId, marketplaceId: marketplaceName },
    select: { id: true },
  });
  if (!connection) {
    return { error: `No ${marketplaceDisplayName} connection found for this workspace. Connect ${marketplaceDisplayName} in Settings before publishing.` };
  }
  return { connection };
}

interface ReservedListingFields {
  title: string;
  description: string;
  price: number;
  quantity: number;
}

type ReserveListingOutcome =
  /** A real, confirmed publish already exists (has a real externalId) — no adapter call, this IS the idempotent replay. Unchanged normal behavior. */
  | { outcome: 'already_published'; listing: { id: string; externalId: string | null; status: string } }
  /**
   * Listing-reconciliation fix: an existing row is stuck at 'syncing'
   * (a prior attempt reserved it but never reached a terminal
   * synced/failed state — see ListingReconciliationService's header for
   * why). It must be reconciled with the real marketplace state before
   * it can be trusted as published OR retried — never assumed to be
   * either.
   */
  | { outcome: 'needs_reconciliation'; listing: { id: string } }
  /** A brand-new reservation (or a reused 'failed' slot) — proceed with a real adapter call exactly as before. */
  | { outcome: 'reserved_for_publish'; listing: { id: string; externalId: string | null; status: string } };

function classifyExistingListing(listing: { id: string; externalId: string | null; status: string; syncStatus: string }): ReserveListingOutcome | null {
  if (listing.syncStatus === 'synced') {
    return { outcome: 'already_published', listing };
  }
  // 'reconciling' is a transient state ListingReconciliationService's own
  // atomic claim writes WHILE a reconciliation is actually in flight for
  // this exact row (see that file's header). A third concurrent request
  // landing here must be routed the same way as 'syncing' — never fall
  // through to the reservation path below, which would otherwise try to
  // reuse/overwrite a row another request is mid-reconciliation on.
  // reconcileStuckListing's own claim (which only matches 'syncing')
  // correctly reports this as 'in_progress' rather than re-checking the
  // marketplace a second time.
  if (listing.syncStatus === 'syncing' || listing.syncStatus === 'reconciling') {
    return { outcome: 'needs_reconciliation', listing: { id: listing.id } };
  }
  // 'failed' (or any other non-terminal value) — not a final classification, caller proceeds to reserve/reuse the row.
  return null;
}

/**
 * Mirrors ListingService.createListing's own reserve-then-publish guard
 * exactly (see that method's own comments): a Listing already 'synced'
 * for this (productId, connectionId) pair means the intent is already
 * satisfied — returned as-is, the real adapter call is NEVER made again.
 * A 'failed' row is a retryable slot, reused in place rather than
 * inserting a duplicate. The DB's own partial unique index
 * (Listing_active_product_connection_key) is the real, race-safe backstop
 * if two requests somehow reach the insert at the same time.
 *
 * Listing-reconciliation fix: a 'syncing' row is NO LONGER treated the
 * same as 'synced'. Before this fix, a Listing stuck at 'syncing' (the
 * real marketplace call succeeded but the DB write that should have
 * followed it — markListingSynced — failed or crashed) was silently
 * reported as `alreadyPublished: true` with `externalId: null` forever,
 * and never retried. It is now reported as its own outcome,
 * 'needs_reconciliation', so the caller can resolve it against the real
 * marketplace state (see ListingReconciliationService) instead of
 * guessing either way.
 */
async function reserveListingForPublish(
  workspaceId: string,
  productId: string,
  connectionId: string,
  fields: ReservedListingFields
): Promise<ReserveListingOutcome> {
  const existingListing = await prisma.listing.findFirst({
    where: { productId, marketplaceConnectionId: connectionId, deletedAt: null },
  });

  if (existingListing) {
    const classified = classifyExistingListing(existingListing);
    if (classified) return classified;
  }

  try {
    const reserved = existingListing
      ? await prisma.listing.update({
          where: { id: existingListing.id },
          data: { syncStatus: 'syncing', syncError: null, ...fields },
        })
      : await prisma.listing.create({
          data: {
            productId,
            workspaceId,
            marketplaceConnectionId: connectionId,
            status: 'active',
            syncStatus: 'syncing',
            ...fields,
          },
        });
    return { outcome: 'reserved_for_publish', listing: reserved };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Lost a race — another request already claimed this exact pair a
      // moment ago. Same outcome as the fast-path check above: classify
      // whatever exists now, never publish a duplicate.
      const raceWinner = await prisma.listing.findFirst({ where: { productId, marketplaceConnectionId: connectionId, deletedAt: null } });
      if (raceWinner) {
        const classified = classifyExistingListing(raceWinner);
        if (classified) return classified;
        // raceWinner is itself 'failed' (or similar) — treat it as the reserved slot, same as the non-race path would.
        return { outcome: 'reserved_for_publish', listing: raceWinner };
      }
    }
    throw error;
  }
}

/**
 * Listing.syncError is documented (see the schema's own comment) as "short,
 * user-facing message... Never raw exceptions/stack traces" — a fixed,
 * generic message here follows that exact rule the same way
 * ListingService.createListing's own catch block does, without
 * reimplementing its Etsy-specific regex branches (irrelevant here: this
 * pipeline's Etsy fields come from the already-validated draft, never from
 * buildEtsyListingRequirements/Product).
 */
async function markListingFailed(listingId: string, marketplaceDisplayName: string) {
  return prisma.listing.update({
    where: { id: listingId },
    data: { syncStatus: 'failed', syncError: `Couldn't publish to ${marketplaceDisplayName}. Please try again.` },
  }).catch(() => undefined); // best-effort bookkeeping — never masks the real error, which the caller still throws/propagates
}

async function markListingSynced(listingId: string, externalId: string | undefined) {
  // A "successful" createListing with no real externalId is not actually
  // usable (nothing to look the listing up by later) — treated as a
  // failure here rather than silently marking 'synced' with a missing id,
  // same principle as EbayAdapter.createListing's own missing-offerId check.
  if (!externalId) {
    throw new Error('Marketplace createListing succeeded but returned no externalId.');
  }
  return prisma.listing.update({ where: { id: listingId }, data: { externalId, syncStatus: 'synced' } });
}

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

/**
 * create_product — the missing link the provenance/deduplication audit
 * identified: turns a real, already-sourced marketplace item into a real
 * ADKSY Product (+ its Inventory row), with its provenance persisted
 * (Option A, src/prisma/schema.prisma's own Product comment). Still never
 * creates a Listing or publishes anything — that stays publish_listing/
 * publish_etsy_listing's job, entirely untouched here (Architecture A,
 * see actionTools.ts's own header comment above publishListingTool: a
 * Product must already exist before either publish tool will touch it —
 * this tool is what makes that true for a sourced item for the first time).
 *
 * Real, matching PRODUCT_CONDITION_VALUES duplicated here on purpose,
 * kept in sync by hand with createProductSchema's own inline enum
 * (src/lib/validations.ts) — Zod's `.default()`-wrapped enum isn't
 * cleanly re-exported/composed across modules, and this is the same
 * "small, stable, hand-duplicated" tradeoff already accepted elsewhere in
 * this codebase (e.g. EtsyListingMapper.ETSY_WHEN_MADE_OPTIONS).
 */
const PRODUCT_CONDITION_VALUES = ['new', 'like-new', 'good', 'fair', 'used'] as const;

const createProductInputSchema = z.object({
  // Provenance — all three REQUIRED for this tool (unlike Product's own
  // schema, where they're optional to keep manual dashboard creation
  // working). Revalidated against a real search_products result in THIS
  // conversation before anything is ever created — see
  // findMatchingSourcingResult below. Never accepted on trust just
  // because the model says so.
  sourceMarketplace: z.string().min(1),
  sourceId: z.string().min(1),
  sourceUrl: z.string().url(),

  title: z.string().min(2),
  description: z.string().min(5).optional(),

  // Financial fields — deliberately REQUIRED, never defaulted or
  // inferred from the sourcing result's own price (that is a cost the
  // source reports, never automatically the reseller's real purchase
  // price or a proposed selling price — see ListingDraftFields' own
  // documented rule, mirrored here for the same reason).
  sellingPrice: z.number().min(0),
  purchasePrice: z.number().min(0),

  sku: z.string().min(1).optional(),
  brand: z.string().optional(),
  condition: z.enum(PRODUCT_CONDITION_VALUES).optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  // Deliberately NO `quantity` input: a sourced item is inherently a
  // single physical unit (the same rule ListingGenerationService already
  // applies to a draft's own quantity) — the Agent is never allowed to
  // invent a stock count for it. Omitted entirely so createProductSchema's
  // own existing `.default(1)` applies, exactly like a manual creation
  // with no quantity given.
  // Deliberately NO `images`: Product itself has no images column (they
  // live on the separate ProductImage table via StorageService, which
  // needs a real file, not a source URL to hotlink) — out of this task's
  // explicit scope.
});

type CreateProductToolInput = z.infer<typeof createProductInputSchema>;

/**
 * Never trusts sourceMarketplace/sourceId/sourceUrl the model merely
 * repeats back — confirms all three together match a real search_products
 * result that really appeared IN THIS CONVERSATION, the same
 * findToolResultsByName-based revalidation pattern already used by
 * generate_listing_draft/edit_listing_draft (see listingDraftTools.ts's
 * own findSourcedResult) and by publish_listing/publish_etsy_listing (see
 * findLatestDraft) — never a second, parallel verification system.
 * All three fields must match the SAME candidate result; if any one
 * differs, this returns null and the action is refused.
 */
async function findMatchingSourcingResult(conversationId: string, workspaceId: string, input: CreateProductToolInput) {
  const entries = await findToolResultsByName(conversationId, ['search_products'], workspaceId);
  for (const entry of entries) {
    const payload = entry.result as { results?: unknown[] } | null;
    const results = Array.isArray(payload?.results) ? payload!.results! : [];
    for (const candidate of results) {
      if (
        isNormalizedSourcingResult(candidate) &&
        candidate.source === input.sourceMarketplace &&
        candidate.sourceId === input.sourceId &&
        candidate.sourceUrl === input.sourceUrl
      ) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * ProductService.createProduct's own known, clean business-error messages
 * (never the raw Prisma text — see that method's own comments) that
 * represent a genuine, expected refusal rather than an unexpected failure.
 * Mirrors sendToFulfillmentTool's own KNOWN_FULFILLMENT_ERRORS pattern:
 * matched errors become a controlled `{error}` result (AiActionService
 * releases the usage reservation, marks the action COMPLETED with this
 * refusal as its result — never FAILED); anything else propagates
 * unmodified to AiActionService's own catch. PRODUCT_SOURCE_CONFLICT_MESSAGE
 * is handled separately below (it needs the existing product's id looked
 * up), never added to this set.
 */
const KNOWN_PRODUCT_CREATION_ERRORS = new Set([PRODUCT_SKU_CONFLICT_MESSAGE, 'Product limit reached for your plan']);

function buildProductPreview(workspaceId: string, input: CreateProductToolInput) {
  return {
    action: 'create_product',
    sourceMarketplace: input.sourceMarketplace,
    sourceId: input.sourceId,
    sourceUrl: input.sourceUrl,
    title: input.title,
    description: input.description ?? null,
    sellingPrice: input.sellingPrice,
    purchasePrice: input.purchasePrice,
    sku: input.sku ?? null,
    brand: input.brand ?? null,
    condition: input.condition ?? 'used',
    size: input.size ?? null,
    color: input.color ?? null,
    message: 'Confirming this will add a new product to your ADKSY catalog with these exact details.',
  };
}

export const createProductTool: AgentToolDefinition<CreateProductToolInput> = {
  name: 'create_product',
  description:
    'Propose creating a new ADKSY catalog product (with its stock record) from a product the reseller selected from a previous search_products result in THIS conversation. ' +
    'sourceMarketplace/sourceId/sourceUrl together must exactly match one of those real results — a fabricated or foreign combination is rejected, never accepted on trust. ' +
    "purchasePrice and sellingPrice must be the reseller's own real, explicit values — never invented or copied from the source's own listed price. " +
    'If this exact source was already added to this workspace\'s catalog before, this is refused (never creates a duplicate, never silently returns the existing product as if this succeeded). ' +
    'Requires the reseller\'s explicit confirmation before anything is created. Never creates a Listing or publishes anything — use publish_listing/publish_etsy_listing separately once this product exists.',
  category: 'engage',
  inputSchema: createProductInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      sourceMarketplace: { type: 'string', description: "The sourcing provider name (e.g. 'ebay') — must match a real search_products result in this conversation." },
      sourceId: { type: 'string', description: 'The exact sourceId of a result already returned by search_products in this conversation.' },
      sourceUrl: { type: 'string', description: 'The exact sourceUrl of that same result.' },
      title: { type: 'string', description: 'Product title.' },
      description: { type: 'string', description: 'Product description. Optional.' },
      sellingPrice: { type: 'number', description: "The reseller's own real proposed selling price. Never invented." },
      purchasePrice: { type: 'number', description: "The reseller's own real purchase cost. Never invented or copied from the source's listed price without confirmation." },
      sku: { type: 'string', description: 'Optional. A real SKU auto-generated if omitted, exactly like manual product creation.' },
      brand: { type: 'string', description: 'Optional.' },
      condition: { type: 'string', enum: PRODUCT_CONDITION_VALUES as unknown as string[], description: 'Optional, defaults to "used".' },
      size: { type: 'string', description: 'Optional.' },
      color: { type: 'string', description: 'Optional.' },
    },
    required: ['sourceMarketplace', 'sourceId', 'sourceUrl', 'title', 'sellingPrice', 'purchasePrice'],
  },
  async preview(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const sourced = await findMatchingSourcingResult(context.conversationId, workspaceId, input);
    if (!sourced) {
      return { error: "This source does not match a real search_products result in this conversation. Search again before selecting it." };
    }

    return buildProductPreview(workspaceId, input);
  },
  async handler(workspaceId, input, context) {
    if (!context) return { error: 'Missing conversation context' };

    const sourced = await findMatchingSourcingResult(context.conversationId, workspaceId, input);
    if (!sourced) {
      return { error: "This source does not match a real search_products result in this conversation. Search again before selecting it." };
    }

    // Reuses the exact same validation/defaulting pipeline the human
    // dashboard's own POST /api/products already goes through (condition
    // defaults to 'used', quantity defaults to 1, description defaults to
    // '' inside ProductService itself) — never a second, hand-rolled set
    // of defaults that could drift from it.
    const parsed = createProductSchema.safeParse({
      sku: input.sku,
      title: input.title,
      description: input.description,
      brand: input.brand,
      condition: input.condition,
      size: input.size,
      color: input.color,
      purchasePrice: input.purchasePrice,
      sellingPrice: input.sellingPrice,
      sourceMarketplace: input.sourceMarketplace,
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl,
    });
    if (!parsed.success) {
      return { error: `Invalid product data: ${parsed.error.errors.map((e) => e.message).join('; ')}` };
    }

    try {
      // ProductService.createProduct already owns: the Product+Inventory
      // atomic transaction, SKU generation when omitted, and the SKU/
      // source P2002 -> clean-error mapping — never reimplemented here.
      const product = await ProductService.createProduct(workspaceId, parsed.data);
      return {
        success: true,
        productId: product.id,
        sku: product.sku,
        title: product.title,
        sourceMarketplace: product.sourceMarketplace,
        sourceId: product.sourceId,
        sourceUrl: product.sourceUrl,
        sellingPrice: product.sellingPrice,
        purchasePrice: product.purchasePrice,
        inventoryQuantity: parsed.data.quantity,
      };
    } catch (error) {
      if (error instanceof Error && error.message === PRODUCT_SOURCE_CONFLICT_MESSAGE) {
        // Duplicate source, never a second Product created. Looking up
        // the existing product's id is a plain, workspace-scoped read —
        // the same {workspaceId, ...} shape every other tool already
        // uses (see get_product) — never a mutation, never a fallback to
        // treating this as a success.
        const existing = await prisma.product.findFirst({
          where: { workspaceId, sourceMarketplace: input.sourceMarketplace, sourceId: input.sourceId },
          select: { id: true },
        });
        return {
          success: false,
          error: 'This source has already been added to your catalog.',
          errorCode: 'PRODUCT_SOURCE_ALREADY_EXISTS',
          message: 'This source has already been added to your catalog.',
          existingProductId: existing?.id ?? null,
        };
      }
      if (error instanceof Error && KNOWN_PRODUCT_CREATION_ERRORS.has(error.message)) {
        return { error: error.message };
      }
      // Unexpected (e.g. a genuinely unrecognized P2002 shape, or a real
      // DB failure) — propagates unmodified to AiActionService.confirmAndExecute's
      // own catch, which already logs it safely and stores only a generic,
      // secret-free error message — never a second, ad-hoc error handler here.
      throw error;
    }
  },
};

const publishListingInputSchema = z.object({
  sourceUrl: z.string().url(),
  // Architecture A (persistence audit) — required: a real, existing,
  // workspace-owned ADKSY Product to attach the resulting Listing to.
  // sourceUrl identifies where the item was FOUND, never an ADKSY Product
  // — those stay permanently separate identifier spaces. No Product is
  // ever created here; publishing without one already existing is refused.
  productId: z.string().min(1, 'productId is required'),
});

/**
 * Phase 12C-Offline — connects the real pipeline:
 * generate_listing_draft -> edit_listing_draft -> (preview) -> confirm ->
 * (handler) execute. `sourceUrl`/`productId` are the ONLY inputs — never a
 * raw marketplaceId/categoryId/workspaceId the model or client could
 * supply directly; the marketplace payload fields all come from the
 * already-revalidated ListingDraft (see findLatestDraft, the exact same
 * conversation-history revalidation generate_listing_draft/
 * edit_listing_draft already use — a sourceUrl that never produced a draft
 * IN THIS CONVERSATION is rejected, never accepted on trust), while
 * productId is independently verified against this exact workspace.
 *
 * Still 'engage' — never auto-executed (see AiToolRegistry.isAutoExecutable).
 * preview() builds the real payload (mapDraftToEbayInput) and stores it
 * verbatim as the confirmable AgentAction's summary, so what the reseller
 * confirms is exactly what handler() would send — never a separately
 * hand-written preview that could drift from reality. preview() never
 * writes to the database — only handler(), after confirmation, reserves/
 * persists the Listing (see reserveListingForPublish above).
 *
 * ABSOLUTE SAFEGUARD: handler() only ever reaches getAuthenticatedAdapter/
 * adapter.createListing when isRealEbayPublishEnabled() is true —
 * ENABLE_REAL_EBAY_PUBLISH must be the literal string 'true', which is
 * never set anywhere in this codebase or by any test. In every
 * environment where that variable is unset (every environment this was
 * developed and tested in), handler() returns a clearly-labeled
 * simulation and never imports/calls anything network-capable, and never
 * touches the Listing table either.
 */
export const publishListingTool: AgentToolDefinition<{ sourceUrl: string; productId: string }> = {
  name: 'publish_listing',
  description:
    'Propose publishing the listing draft already prepared for sourceUrl (via generate_listing_draft/edit_listing_draft) IN THIS CONVERSATION to its target eBay marketplace, ' +
    'attaching it to an existing ADKSY product (productId). ' +
    "sourceUrl must match a draft this conversation already produced — never accepted on trust; productId must be a real, existing product in this workspace " +
    "— sourceUrl alone never identifies one (it only says where the item was found). Requires the reseller's explicit confirmation before anything happens. " +
    'The draft must be fully ready for eBay (see validateEbayDraft) or this is rejected with the specific reason. ' +
    "The SKU actually sent to eBay is always the product's own real SKU, never a value from the draft. " +
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
      productId: {
        type: 'string',
        description: 'The ADKSY product id (Product.id) this listing is for — must already exist in this workspace. Never inferred from sourceUrl.',
      },
    },
    required: ['sourceUrl', 'productId'],
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

    const productResult = await loadPublishableProduct(workspaceId, input.productId);
    if ('error' in productResult) return { error: productResult.error };
    const { product } = productResult;

    const mismatch = checkDraftMatchesProduct(product, draft.source.sourceItemId);
    if (mismatch) return { error: mismatch.error };

    const connectionResult = await loadMarketplaceConnectionForPublish(workspaceId, 'ebay', 'eBay');
    if ('error' in connectionResult) return { error: connectionResult.error };

    const realPublishEnabled = isRealEbayPublishEnabled();

    return {
      action: 'publish_listing',
      marketplace: 'eBay',
      environment: describeEbayEnvironment(),
      ...ebayInput,
      // The real product's own SKU — never the draft's — exactly what
      // handler() will really send (see this tool's own header comment).
      sku: product.sku,
      productId: product.id,
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

    const productResult = await loadPublishableProduct(workspaceId, input.productId);
    if ('error' in productResult) return { error: productResult.error };
    const { product } = productResult;

    const mismatch = checkDraftMatchesProduct(product, draft.source.sourceItemId);
    if (mismatch) return { error: mismatch.error };

    const connectionResult = await loadMarketplaceConnectionForPublish(workspaceId, 'ebay', 'eBay');
    if ('error' in connectionResult) return { error: connectionResult.error };
    const { connection } = connectionResult;

    // Real product SKU, never the draft's own — see this tool's header
    // comment and the persistence-architecture audit (needed so a future
    // order synced by SKU can actually resolve back to this product).
    const payload = { ...ebayInput, sku: product.sku };

    if (!isRealEbayPublishEnabled()) {
      return {
        simulated: true,
        reason: 'Real eBay publishing is disabled in this environment (ENABLE_REAL_EBAY_PUBLISH is not set to "true").',
        wouldHaveSent: payload,
        message: 'Simulation only — no real marketplace call was made.',
      };
    }

    const reserveResult = await reserveListingForPublish(workspaceId, product.id, connection.id, {
      title: ebayInput.title as string,
      description: ebayInput.description as string,
      price: ebayInput.price as number,
      quantity: ebayInput.quantity as number,
    });

    if (reserveResult.outcome === 'already_published') {
      // Idempotent replay: this exact (product, connection) pair is
      // already confirmed synced — the real adapter call is NEVER repeated.
      return {
        published: true,
        listingId: reserveResult.listing.id,
        externalId: reserveResult.listing.externalId,
        status: reserveResult.listing.status,
        alreadyPublished: true,
      };
    }

    if (reserveResult.outcome === 'needs_reconciliation') {
      // Listing-reconciliation fix: a prior attempt for this exact
      // (product, connection) pair is stuck at 'syncing' — the real eBay
      // call may have already succeeded even though ADKSY never recorded
      // it. Never trusted as published and never blindly retried until
      // this is resolved against eBay's own real state.
      const ebayMarketplaceId = (ebayInput.ebay as { marketplaceId?: string } | undefined)?.marketplaceId;
      const adapter = await getAuthenticatedAdapter(workspaceId, 'ebay');
      const reconciliation = await reconcileStuckListing(reserveResult.listing, 'ebay', product.sku, adapter as unknown as EbayOfferLookup, ebayMarketplaceId);

      if (reconciliation.outcome === 'synced' || reconciliation.outcome === 'already_published') {
        return {
          published: true,
          listingId: reconciliation.listing.id,
          externalId: reconciliation.listing.externalId,
          status: reconciliation.listing.status,
          alreadyPublished: true,
        };
      }
      if (reconciliation.outcome === 'not_found_retryable') {
        return {
          error:
            'A previous publish attempt for this product could not be confirmed on eBay and has been marked for retry. Please try publishing again.',
        };
      }
      // 'unable_to_verify' or 'in_progress' — fail closed: never conclude
      // absence, never republish while the real state is unknown.
      return {
        error:
          "This product's eBay publish status from a previous attempt could not be confirmed right now. No new listing will be created until this is resolved — please try again shortly.",
      };
    }

    try {
      // Real path — never exercised in this environment (the flag above is
      // always false here; see the Phase 12C-Offline report's own "zero
      // real eBay call" confirmation). Any failure here (auth, validation,
      // network) propagates unmodified to AiActionService.confirmAndExecute's
      // own catch, which already logs it safely and stores only a generic,
      // secret-free error message — never a second, ad-hoc error handler
      // here that could diverge from that guarantee. The Listing row is
      // still marked 'failed' first (see markListingFailed) — local
      // bookkeeping only, never masking or replacing the real error.
      const adapter = await getAuthenticatedAdapter(workspaceId, 'ebay');
      const result = await adapter.createListing(payload as any);
      const finalListing = await markListingSynced(reserveResult.listing.id, result.externalId);
      return {
        published: true,
        listingId: finalListing.id,
        externalId: result.externalId,
        status: result.status,
      };
    } catch (error) {
      await markListingFailed(reserveResult.listing.id, 'eBay');
      throw error;
    }
  },
};

const publishEtsyListingInputSchema = z.object({
  sourceUrl: z.string().url(),
  // Architecture A (persistence audit) — same rule as publish_listing:
  // required, real, existing, workspace-owned Product. Never created here.
  productId: z.string().min(1, 'productId is required'),
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
export const publishEtsyListingTool: AgentToolDefinition<{ sourceUrl: string; productId: string }> = {
  name: 'publish_etsy_listing',
  description:
    'Propose publishing the listing draft already prepared for sourceUrl (via generate_listing_draft/edit_listing_draft) IN THIS CONVERSATION to Etsy, ' +
    'attaching it to an existing ADKSY product (productId). ' +
    "sourceUrl must match a draft this conversation already produced — never accepted on trust; productId must be a real, existing product in this workspace " +
    "— sourceUrl alone never identifies one. Requires the reseller's explicit confirmation before anything happens. " +
    'The draft must be fully ready for Etsy (see validateEtsyDraft — requires who_made/when_made/taxonomy_id, never guessed) or this is rejected with the specific reason. ' +
    "The SKU actually sent to Etsy is always the product's own real SKU, never a value from the draft. " +
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
      productId: {
        type: 'string',
        description: 'The ADKSY product id (Product.id) this listing is for — must already exist in this workspace. Never inferred from sourceUrl.',
      },
    },
    required: ['sourceUrl', 'productId'],
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

    const productResult = await loadPublishableProduct(workspaceId, input.productId);
    if ('error' in productResult) return { error: productResult.error };
    const { product } = productResult;

    const mismatch = checkDraftMatchesProduct(product, draft.source.sourceItemId);
    if (mismatch) return { error: mismatch.error };

    const connectionResult = await loadMarketplaceConnectionForPublish(workspaceId, 'etsy', 'Etsy');
    if ('error' in connectionResult) return { error: connectionResult.error };

    const realPublishEnabled = isRealEtsyPublishEnabled();

    return {
      action: 'publish_etsy_listing',
      marketplace: 'Etsy',
      environment: describeEtsyEnvironment(),
      ...etsyInput,
      sku: product.sku,
      productId: product.id,
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

    const productResult = await loadPublishableProduct(workspaceId, input.productId);
    if ('error' in productResult) return { error: productResult.error };
    const { product } = productResult;

    const mismatch = checkDraftMatchesProduct(product, draft.source.sourceItemId);
    if (mismatch) return { error: mismatch.error };

    const connectionResult = await loadMarketplaceConnectionForPublish(workspaceId, 'etsy', 'Etsy');
    if ('error' in connectionResult) return { error: connectionResult.error };
    const { connection } = connectionResult;

    const payload = { ...etsyInput, sku: product.sku };

    if (!isRealEtsyPublishEnabled()) {
      return {
        simulated: true,
        reason: 'Real Etsy publishing is disabled in this environment (ENABLE_REAL_ETSY_PUBLISH is not set to "true").',
        wouldHaveSent: payload,
        message: 'Simulation only — no real marketplace call was made.',
      };
    }

    const reserveResult = await reserveListingForPublish(workspaceId, product.id, connection.id, {
      title: etsyInput.title as string,
      description: etsyInput.description as string,
      price: etsyInput.price as number,
      quantity: etsyInput.quantity as number,
    });

    if (reserveResult.outcome === 'already_published') {
      return {
        published: true,
        listingId: reserveResult.listing.id,
        externalId: reserveResult.listing.externalId,
        status: reserveResult.listing.status,
        alreadyPublished: true,
      };
    }

    if (reserveResult.outcome === 'needs_reconciliation') {
      // Listing-reconciliation fix: a prior attempt for this exact
      // (product, connection) pair is stuck at 'syncing'. Etsy has no
      // reliable SKU-indexed listing lookup (see
      // ListingReconciliationService's own documented reason) — this
      // always fails closed rather than guess either way: never trusted
      // as published, never blindly retried.
      const reconciliation = await reconcileStuckListing(reserveResult.listing, 'etsy', product.sku, null, undefined);

      if (reconciliation.outcome === 'synced' || reconciliation.outcome === 'already_published') {
        return {
          published: true,
          listingId: reconciliation.listing.id,
          externalId: reconciliation.listing.externalId,
          status: reconciliation.listing.status,
          alreadyPublished: true,
        };
      }
      if (reconciliation.outcome === 'not_found_retryable') {
        return {
          error:
            'A previous publish attempt for this product could not be confirmed on Etsy and has been marked for retry. Please try publishing again.',
        };
      }
      return {
        error:
          "This product's Etsy publish status from a previous attempt could not be confirmed right now. No new listing will be created until this is resolved — please try again shortly.",
      };
    }

    try {
      // Real path — never exercised in this environment (the flag above is
      // always false here). Any failure here (auth, validation, network)
      // propagates unmodified to AiActionService.confirmAndExecute's own
      // catch, which already logs it safely and stores only a generic,
      // secret-free error message — never a second, ad-hoc error handler
      // here that could diverge from that guarantee.
      const adapter = await getAuthenticatedAdapter(workspaceId, 'etsy');
      const result = await adapter.createListing(payload as any);
      const finalListing = await markListingSynced(reserveResult.listing.id, result.externalId);
      return {
        published: true,
        listingId: finalListing.id,
        externalId: result.externalId,
        status: result.status,
      };
    } catch (error) {
      await markListingFailed(reserveResult.listing.id, 'Etsy');
      throw error;
    }
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

/**
 * send_to_fulfillment — proposes sending an existing order to ADKSY's own
 * fulfillment pipeline. 'engage': creates a real, persistent FulfillmentOrder
 * and flips the order's own status/fulfillmentType — a real, visible
 * business effect, never auto-executed.
 *
 * AUDIT (this tool's own, verified against the real
 * FulfillmentService.sendToFulfillment before writing any of this):
 * - Reuses FulfillmentService.sendToFulfillment AS-IS — its plan gate
 *   (SubscriptionService.hasFeature(workspaceId, 'fulfillmentEnabled')),
 *   its Order lookup ({id, workspaceId} — workspace isolation already
 *   enforced there), its "already has a FulfillmentOrder" pre-check, and
 *   its partner lookup are never reimplemented here.
 * - Double-fulfillment guard: FulfillmentOrder.orderId is @unique in the
 *   Prisma schema (prisma/schema.prisma) — a real, race-safe DB-level
 *   backstop. Two concurrent confirmations for the same order can each
 *   pass the service's own pre-check, but only ONE prisma.fulfillmentOrder.create
 *   ever succeeds; the loser's raw Prisma error is deliberately NOT
 *   pattern-matched below (never turned into the friendly "already
 *   created" message) — it propagates to AiActionService's own generic,
 *   already-safe catch, exactly like any other unexpected failure.
 * - sendToFulfillment does NOT check Order.status (a cancelled/failed
 *   order is not blocked by the service itself) and does NOT touch
 *   Inventory/stock at all (no reservation, no stock check — that only
 *   ever happens at Order-creation time via ProductService.reserveInventory).
 *   Never invented here: this tool surfaces the order's real status in
 *   preview so the reseller can judge, but never adds a new blocking rule
 *   the real service doesn't itself enforce.
 * - Explicitly out of scope (per this task): never calls
 *   simulateOrderAccepted/Processing/Shipped/Delivered — this tool stops at
 *   the real sendToFulfillment call.
 */
const sendToFulfillmentInputSchema = z.object({
  orderId: z.string().min(1, 'orderId is required'),
  // Optional: FulfillmentPartner is a global (non-workspace-scoped) list —
  // auto-resolved only when exactly one active partner exists (see
  // resolveFulfillmentPartner), never guessed among several, mirroring
  // OrdersSyncService's own "only when exactly one candidate" discipline.
  partnerId: z.string().min(1).optional(),
});

type SendToFulfillmentInput = z.infer<typeof sendToFulfillmentInputSchema>;

// The exact, real business-error messages FulfillmentService.sendToFulfillment
// throws today (verified against its source) — never guessed. Anything else
// (e.g. a raw Prisma race error) is deliberately NOT matched here, so it
// propagates unmodified to AiActionService's own safe, generic catch.
const KNOWN_FULFILLMENT_ERRORS = new Set([
  'Fulfillment is not included in your current plan',
  'Order not found',
  'Fulfillment order already created',
  'Fulfillment partner not found',
]);

async function resolveFulfillmentPartner(
  partnerId: string | undefined
): Promise<{ partner: { id: string; name: string; country: string; costPerOrder: number; processingTime: number; deliveryTime: number } } | { error: string }> {
  if (partnerId) {
    const partner = await prisma.fulfillmentPartner.findUnique({ where: { id: partnerId } });
    if (!partner || partner.status !== 'active') {
      return { error: 'Fulfillment partner not found or not active.' };
    }
    return { partner };
  }

  const activePartners = await prisma.fulfillmentPartner.findMany({ where: { status: 'active' } });
  if (activePartners.length === 0) {
    return { error: 'No active fulfillment partner is configured for this workspace.' };
  }
  if (activePartners.length > 1) {
    return { error: 'Multiple fulfillment partners are available — specify partnerId to choose one.' };
  }
  return { partner: activePartners[0] };
}

export const sendToFulfillmentTool: AgentToolDefinition<SendToFulfillmentInput> = {
  name: 'send_to_fulfillment',
  description:
    "Propose sending an existing order in the reseller's own workspace to ADKSY's own fulfillment pipeline (FulfillmentService.sendToFulfillment), " +
    'creating a real FulfillmentOrder and moving the order to fulfillmentType "automatic" / status "processing". ' +
    "Requires the reseller's explicit confirmation before anything happens. If the order already has a fulfillment order, or fulfillment is not " +
    "included in the workspace's current plan, this is rejected with the specific reason — never silently retried or worked around. " +
    'Does not check inventory/stock (the real service does not either) and does not check the order\'s own status — both are surfaced as real, ' +
    'factual context in the proposal, never used to invent a new blocking rule the real service does not enforce. ' +
    'Never simulates acceptance, processing, shipping, or delivery — those remain separate, explicitly-simulated capabilities, not real fulfillment.',
  category: 'engage',
  inputSchema: sendToFulfillmentInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'The ADKSY order id (Order.id) to send to fulfillment.' },
      partnerId: {
        type: 'string',
        description: 'The fulfillment partner id to use. Omit if only one active partner exists — it will be used automatically.',
      },
    },
    required: ['orderId'],
  },
  async preview(workspaceId, input) {
    const order = await OrderService.getOrder(input.orderId, workspaceId);
    if (!order) {
      return { error: 'Order not found in this workspace.' };
    }

    const partnerResult = await resolveFulfillmentPartner(input.partnerId);
    if ('error' in partnerResult) return { error: partnerResult.error };
    const { partner } = partnerResult;

    // Read-only — the exact same check sendToFulfillment itself makes,
    // surfaced here purely so a doomed-from-the-start proposal isn't shown
    // as if it would succeed. Never a second, divergent gate.
    const fulfillmentEnabled = await SubscriptionService.hasFeature(workspaceId, 'fulfillmentEnabled');

    const alreadyHasFulfillmentOrder = Boolean(order.fulfillmentOrder);

    return {
      action: 'send_to_fulfillment',
      orderId: order.id,
      orderStatus: order.status,
      alreadyHasFulfillmentOrder,
      fulfillmentEnabledForPlan: fulfillmentEnabled,
      partner: {
        id: partner.id,
        name: partner.name,
        country: partner.country,
        costPerOrder: partner.costPerOrder,
        processingTime: partner.processingTime,
        deliveryTime: partner.deliveryTime,
      },
      items: order.items.map((item) => ({ productId: item.productId, title: item.title, quantity: item.quantity })),
      message: !fulfillmentEnabled
        ? "This workspace's current plan does not include fulfillment — confirming this will fail."
        : alreadyHasFulfillmentOrder
          ? 'This order already has a fulfillment order — confirming this will fail (no duplicate is ever created).'
          : `Confirming this will create a real fulfillment order with ${partner.name} and move this order to "processing".`,
    };
  },
  async handler(workspaceId, input) {
    const order = await OrderService.getOrder(input.orderId, workspaceId);
    if (!order) {
      return { error: 'Order not found in this workspace.' };
    }

    const partnerResult = await resolveFulfillmentPartner(input.partnerId);
    if ('error' in partnerResult) return { error: partnerResult.error };
    const { partner } = partnerResult;

    try {
      // The real, unmodified service — never reimplemented here. Its own
      // plan gate, workspace-scoped order lookup, and existing-fulfillment-
      // order check all run exactly as they do for the human dashboard flow.
      const fulfillmentOrder = await FulfillmentService.sendToFulfillment(input.orderId, workspaceId, partner.id);

      return {
        success: true,
        fulfillmentOrderId: fulfillmentOrder.id,
        orderId: input.orderId,
        partner: partner.name,
        status: fulfillmentOrder.status,
      };
    } catch (error) {
      if (error instanceof Error && KNOWN_FULFILLMENT_ERRORS.has(error.message)) {
        return { error: error.message };
      }
      // Unexpected (e.g. a lost race against another concurrent
      // confirmation hitting the DB's own unique constraint) — propagates
      // unmodified to AiActionService.confirmAndExecute's own catch, which
      // already logs it safely and stores only a generic, secret-free
      // error message. Never a second, ad-hoc error handler here.
      throw error;
    }
  },
};
