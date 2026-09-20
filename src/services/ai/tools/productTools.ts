import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ProductService } from '@/services/ProductService';
import { AgentToolDefinition } from './types';

const getProductInputSchema = z.object({
  productId: z.string().min(1, 'productId is required'),
});

/**
 * Shapes ProductService.getProduct's result (already workspace-scoped via
 * `findFirst({ id, workspaceId })`, exactly like ListingService.getListing/
 * OrderService.getOrder) plus two lightweight, equally workspace-scoped
 * lookups this tool needs and ProductService.getProduct doesn't already
 * include: the real live Inventory row (same productId_workspaceId
 * pattern already used in listingTools.ts) and this product's own
 * Listing rows (a Product can have several — one per marketplace it's
 * published to — never assumed to be exactly one).
 *
 * Product.quantity is explicitly NOT the live stock source of truth (see
 * that column's own schema comment: "only set at creation/manual edit,
 * never decremented by a sale") — reported here as `declaredQuantity` so
 * it's never confused with the real `inventory.available` figure, never
 * silently treated as the same thing.
 */
function formatProductForAgent(
  product: NonNullable<Awaited<ReturnType<typeof ProductService.getProduct>>>,
  inventory: { quantity: number; reserved: number; available: number } | null,
  listings: Array<{ id: string; title: string; price: number; quantity: number; status: string; connection: { marketplace: { name: string; displayName: string } } | null }>
) {
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
    productId: product.id,
    sku: product.sku,
    supplierSku: product.supplierSku ?? null,
    title: product.title,
    description: product.description,
    brand: product.brand ?? null,
    category: product.category ?? null,
    size: product.size ?? null,
    color: product.color ?? null,
    condition: product.condition,
    purchasePrice: product.purchasePrice,
    sellingPrice: product.sellingPrice,
    fulfillmentCost: product.fulfillmentCost,
    fees: product.fees,
    location: product.location ?? null,
    // Product's own declared quantity — NOT the live stock figure, see
    // this function's own header comment. Never renamed to "stock" or
    // "available" to avoid implying it is.
    declaredQuantity: product.quantity,
    // The app's real live-stock figure (Inventory.available/reserved) —
    // absent (null) when no Inventory row exists, never defaulted.
    inventory: inventory ? { quantity: inventory.quantity, reserved: inventory.reserved, available: inventory.available } : null,
    shipping,
    images: (product.images ?? [])
      .slice()
      .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.order - b.order)
      .map((img) => img.url),
    // A product can be listed on several marketplaces at once — never
    // assumed to have exactly one listing.
    listings: listings.map((listing) => ({
      listingId: listing.id,
      title: listing.title,
      price: listing.price,
      quantity: listing.quantity,
      status: listing.status,
      marketplace: listing.connection?.marketplace
        ? { name: listing.connection.marketplace.name, displayName: listing.connection.marketplace.displayName }
        : null,
    })),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export const getProductTool: AgentToolDefinition<{ productId: string }> = {
  name: 'get_product',
  description:
    "Look up a single existing product belonging to the reseller's own workspace by its ADKSY product id, to answer factual questions about it " +
    '(purchase cost, selling price, stock/inventory, SKU, brand, category, size, color, condition, package dimensions, and which listings/marketplaces it is published on). ' +
    'Read-only — never modifies anything, never calls a marketplace, never requires confirmation. ' +
    "Returns only fields that are actually stored in ADKSY — absent data comes back as null, never guessed or invented. " +
    'declaredQuantity (Product\'s own quantity column) is NOT the live stock figure — use `inventory.available`/`inventory.reserved` for that when present; ' +
    "never state a stock level from declaredQuantity alone if inventory data is available. " +
    "Returns { found: false } if the product doesn't exist in this workspace — never another workspace's product.",
  category: 'read',
  inputSchema: getProductInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      productId: {
        type: 'string',
        description: 'The ADKSY product id (Product.id).',
      },
    },
    required: ['productId'],
  },
  async handler(workspaceId, input) {
    // ProductService.getProduct's `findFirst({ where: { id, workspaceId } })`
    // is the actual isolation boundary — a productId from another
    // workspace simply matches no row and comes back null, exactly like
    // get_order/get_listing/get_shipment/get_customer. Never a bare
    // findUnique({ where: { id } }) that would leak cross-workspace.
    const product = await ProductService.getProduct(input.productId, workspaceId);

    if (!product) {
      return { found: false };
    }

    // Same (productId, workspaceId) compound key already used in
    // listingTools.ts for the real, live inventory row — read-only here.
    const inventory = await prisma.inventory.findUnique({
      where: { productId_workspaceId: { productId: product.id, workspaceId } },
      select: { quantity: true, reserved: true, available: true },
    });

    // This product's own listings — scoped by BOTH productId and
    // workspaceId together, never productId alone (which could otherwise
    // match nothing since Listing rows are workspace-owned, but never
    // relying on productId's non-guessability as the sole boundary).
    const listings = await prisma.listing.findMany({
      where: { productId: product.id, workspaceId, deletedAt: null },
      include: { connection: { include: { marketplace: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return { found: true, product: formatProductForAgent(product, inventory, listings) };
  },
};
