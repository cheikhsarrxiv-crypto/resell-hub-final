import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ListingService } from '@/services/ListingService';
import { Marketplace } from '@/types/marketplace';
import { AgentToolDefinition } from './types';

const getListingInputSchema = z.object({
  listingId: z.string().min(1, 'listingId is required'),
});

/**
 * Shapes ListingService.getListing's raw Prisma result (which includes
 * the FULL MarketplaceConnection row — apiKey/apiSecret/
 * encryptedOauthToken/encryptedRefreshToken/sellerId/accountEmail and
 * all — see prisma/schema.prisma's MarketplaceConnection model) into a
 * safe, agent-facing object. This allow-list is the actual security
 * boundary against a credential leak here: never spread `connection` or
 * `product` wholesale into the tool result.
 *
 * Every field is copied only when the underlying column actually has a
 * value — never defaulted/guessed. In particular:
 * - No `currency` field exists on Listing in the schema, so none is
 *   invented here.
 * - No `authenticityStatus` field exists on Listing or Product either —
 *   authenticity is only ever recorded on a NormalizedSourcingResult/
 *   ListingDraft (ephemeral, conversation-scoped) before a real Listing
 *   row is created, and is not persisted onto the Listing itself. This
 *   tool reads real Listing rows, so it never reports an authenticity
 *   status at all, rather than fabricate or reuse a stale one.
 * - No shipping carrier/tracking/service exists at the listing level
 *   either (those belong to a specific Order's Shipment, once a sale
 *   happens — see get_order for that) — only the product's own physical
 *   package dimensions (weight/length/width/height) are real "shipping"
 *   data at the listing stage, so that's all `shipping` ever contains.
 * - Availability is never deduced (e.g. never "quantity > 0 =>
 *   available") — the raw, real numbers from both Listing.status (the
 *   listing's own lifecycle field: active/delisted/sold_out/paused) and
 *   the separate Inventory row (quantity/reserved/available — the app's
 *   real live-stock source of truth, distinct from Product.quantity,
 *   see that field's own schema comment) are returned as-is, letting the
 *   model reason over real data instead of a computed guess.
 */
function formatListingForAgent(
  listing: NonNullable<Awaited<ReturnType<typeof ListingService.getListing>>>,
  inventory: { quantity: number; reserved: number; available: number } | null
) {
  const product = listing.product;
  const marketplace = listing.connection?.marketplace;

  const shipping =
    product.weightGrams != null || product.lengthCm != null || product.widthCm != null || product.heightCm != null
      ? {
          weightGrams: product.weightGrams ?? null,
          lengthCm: product.lengthCm ?? null,
          widthCm: product.widthCm ?? null,
          heightCm: product.heightCm ?? null,
        }
      : null;

  return {
    listingId: listing.id,
    productId: listing.productId,
    title: listing.title,
    description: listing.description,
    price: listing.price,
    quantity: listing.quantity,
    status: listing.status,
    syncStatus: listing.syncStatus,
    externalId: listing.externalId ?? null,
    marketplace: marketplace ? { name: marketplace.name, displayName: marketplace.displayName } : null,
    sku: product.sku ?? null,
    brand: product.brand ?? null,
    category: product.category ?? null,
    size: product.size ?? null,
    color: product.color ?? null,
    condition: product.condition ?? null,
    images: (product.images ?? [])
      .slice()
      .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.order - b.order)
      .map((img) => img.url),
    // Package dimensions only — never carrier/tracking/delivery method,
    // which don't exist at the listing level (see this function's own
    // header comment).
    shipping,
    // The app's real live-stock figure (see Inventory's own schema
    // comment) — absent (null) when no Inventory row exists for this
    // product/workspace, never defaulted to 0 or to `quantity` above.
    inventory: inventory ? { quantity: inventory.quantity, reserved: inventory.reserved, available: inventory.available } : null,
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
  };
}

export const getListingTool: AgentToolDefinition<{ listingId: string }> = {
  name: 'get_listing',
  description:
    "Look up a single existing listing belonging to the reseller's own workspace by its ADKSY listing id, to answer factual commercial questions about it " +
    '(availability, size, condition, price, shipping package info, which marketplace it is published on, SKU, etc.). ' +
    'Read-only — never modifies, publishes, delists, or negotiates anything, and never requires confirmation. ' +
    "Returns only fields that are actually stored in ADKSY — a field that isn't set comes back as null or is simply absent, never guessed or invented " +
    "(this includes authenticity, which is not stored on a real Listing at all, and shipping carrier/tracking, which only exist once a real order/shipment exists). " +
    "Returns { found: false } if the listing doesn't exist in this workspace — never another workspace's listing, and never reveals whether a listing with that id exists elsewhere.",
  category: 'read',
  inputSchema: getListingInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      listingId: {
        type: 'string',
        description: 'The ADKSY listing id (Listing.id), not a marketplace external listing id.',
      },
    },
    required: ['listingId'],
  },
  async handler(workspaceId, input) {
    // ListingService.getListing's `findFirst({ where: { id, workspaceId } })`
    // is the actual isolation boundary — a listingId from another
    // workspace simply matches no row and comes back null, exactly like
    // get_order's OrderService.getOrder. Never a bare
    // findUnique({ where: { id } }) that would leak cross-workspace.
    const listing = await ListingService.getListing(input.listingId, workspaceId);

    if (!listing) {
      return { found: false };
    }

    // Same (productId, workspaceId) compound key ProductService already
    // uses for the real, live inventory row (see that service's own
    // reserveInventory) — read-only here, never mutated.
    const inventory = await prisma.inventory.findUnique({
      where: { productId_workspaceId: { productId: listing.productId, workspaceId } },
      select: { quantity: true, reserved: true, available: true },
    });

    return { found: true, listing: formatListingForAgent(listing, inventory) };
  },
};

// Both declared directly on Listing's own schema comment (the only source
// of truth here — unlike Order.status, there is no separate mapper type to
// cross-check against). 'active'/'delisted'/'sold_out' are confirmed
// written by ListingService (createListing/deleteListing/handleSoldOut);
// 'paused' is declared but not yet written by any code path today — kept
// since it's the schema's own documented value, not invented for this tool.
const LISTING_STATUSES = ['active', 'delisted', 'sold_out', 'paused'] as const;
// Confirmed written by ListingService.createListing (syncing/synced/failed)
// and the schema's own default (not_synced).
const LISTING_SYNC_STATUSES = ['not_synced', 'syncing', 'synced', 'failed'] as const;

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const getListingsInputSchema = z.object({
  // Listing has no marketplace string of its own (unlike Order.marketplace)
  // — the only real source is its MarketplaceConnection relation, whose
  // marketplaceId is a direct, always-reliable FK (never the ambiguous
  // "unresolved listingId" situation Order/AnalyticsService has), so
  // filtering through it here never silently drops a listing.
  marketplace: z.nativeEnum(Marketplace).optional(),
  status: z.enum(LISTING_STATUSES).optional(),
  syncStatus: z.enum(LISTING_SYNC_STATUSES).optional(),
  productId: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
});

type GetListingsInput = z.infer<typeof getListingsInputSchema>;

export const getListingsTool: AgentToolDefinition<GetListingsInput> = {
  name: 'get_listings',
  description:
    "Search/list existing listings in the reseller's own workspace with real, supported filters, to answer questions like \"show my listings\", " +
    '"my eBay listings", "which listings are in error?", "which listings are out of sync?", "my listings for this product". ' +
    `Returns up to ${DEFAULT_LIMIT} listings by default (max ${MAX_LIMIT}), most recently created first; totalListings is the real total count even ` +
    'if it exceeds the returned page. ' +
    'status filters on the listing\'s own lifecycle (active/delisted/sold_out/paused); syncStatus filters on marketplace sync state ' +
    '(not_synced/syncing/synced/failed) — these are two different, independent fields, never conflated. ' +
    'marketplace filters on the listing\'s real MarketplaceConnection, never guessed. productId/sku narrow to a single product\'s listings ' +
    "(sku is resolved to a product in this workspace first; an unknown sku returns { found: false }, never another workspace's product). " +
    'For a single already-known listing id, use get_listing instead. ' +
    'Never returns OAuth tokens, API credentials, or any other MarketplaceConnection secret, nor invented profit/margin figures.',
  category: 'read',
  inputSchema: getListingsInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      marketplace: {
        type: 'string',
        enum: Object.values(Marketplace),
        description: 'Restrict to listings connected to this marketplace. Omit to include every marketplace.',
      },
      status: {
        type: 'string',
        enum: LISTING_STATUSES as unknown as string[],
        description: 'Restrict to this listing lifecycle status. Omit to include every status.',
      },
      syncStatus: {
        type: 'string',
        enum: LISTING_SYNC_STATUSES as unknown as string[],
        description: 'Restrict to this marketplace sync status. Omit to include every sync status.',
      },
      productId: { type: 'string', description: 'Restrict to listings for this ADKSY product id.' },
      sku: { type: 'string', description: "Restrict to listings for the product with this SKU, in this workspace." },
      limit: {
        type: 'number',
        description: `Maximum number of listings to return, most recently created first. Defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
      },
    },
  },
  async handler(workspaceId, input) {
    const limit = input.limit ?? DEFAULT_LIMIT;

    let productId = input.productId;

    if (!productId && input.sku) {
      // Same (workspaceId, sku) compound key ProductService/other tools
      // already resolve a SKU through — never a bare sku lookup that could
      // match another workspace's product.
      const product = await prisma.product.findFirst({
        where: { workspaceId, sku: input.sku, deletedAt: null },
        select: { id: true },
      });

      if (!product) {
        return { found: false, listings: [], totalListings: 0, returnedListings: 0 };
      }

      productId = product.id;
    }

    const where = {
      workspaceId,
      deletedAt: null,
      ...(productId ? { productId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.syncStatus ? { syncStatus: input.syncStatus } : {}),
      ...(input.marketplace ? { connection: { marketplaceId: input.marketplace } } : {}),
    };

    // Single query, product/connection joined via `select` (never a full
    // `include`, which on MarketplaceConnection would pull apiKey/
    // apiSecret/encryptedOauthToken/encryptedRefreshToken — see
    // formatListingForAgent's own header comment on that exact risk) — no
    // per-listing follow-up query. The real total count is a separate
    // aggregate query, same Promise.all([findMany, count]) pattern as
    // ListingService.getListings/get_orders/get_customer_orders.
    const [listings, totalListings] = await Promise.all([
      prisma.listing.findMany({
        where,
        select: {
          id: true,
          productId: true,
          title: true,
          price: true,
          quantity: true,
          status: true,
          syncStatus: true,
          externalId: true,
          createdAt: true,
          updatedAt: true,
          product: { select: { sku: true } },
          connection: { select: { marketplace: { select: { name: true, displayName: true } } } },
        },
        // Same order ListingService.getListings already uses — reused
        // rather than inventing a different default sort for this tool.
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.listing.count({ where }),
    ]);

    if (listings.length === 0) {
      return { found: false, listings: [], totalListings: 0, returnedListings: 0 };
    }

    return {
      found: true,
      listings: listings.map((listing) => ({
        listingId: listing.id,
        productId: listing.productId,
        title: listing.title,
        price: listing.price,
        quantity: listing.quantity,
        status: listing.status,
        syncStatus: listing.syncStatus,
        externalId: listing.externalId ?? null,
        marketplace: listing.connection
          ? { name: listing.connection.marketplace.name, displayName: listing.connection.marketplace.displayName }
          : null,
        sku: listing.product.sku ?? null,
        createdAt: listing.createdAt.toISOString(),
        updatedAt: listing.updatedAt.toISOString(),
      })),
      totalListings,
      returnedListings: listings.length,
    };
  },
};
