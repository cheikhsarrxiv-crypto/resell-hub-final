import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ProductService } from '@/services/ProductService';
import { AgentToolDefinition } from './types';

const getInventoryInputSchema = z
  .object({
    productId: z.string().min(1).optional(),
    sku: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.productId) || Boolean(data.sku), {
    message: 'Either productId or sku is required',
  });

type GetInventoryInput = z.infer<typeof getInventoryInputSchema>;

/**
 * No InventoryService exists anywhere in this codebase (confirmed by
 * audit) — ProductService.reserveInventory/releaseInventory/updateInventory
 * are the only Inventory-writing code, and they establish what each
 * column really means:
 * - `quantity`: total declared stock (set by updateInventory).
 * - `reserved`: units currently held by in-progress orders (incremented
 *   by reserveInventory, decremented by releaseInventory).
 * - `available` = quantity - reserved, maintained atomically
 *   (`available: { decrement }` on reserve, `{ increment }` on release) —
 *   this is the REAL source of truth for "how many can I still sell",
 *   never Product.quantity (see that column's own schema comment: only
 *   set at creation/manual edit, never decremented by a sale).
 *
 * Resolving productId -> workspaceId ownership always goes through
 * ProductService.getProduct first (already workspace-scoped, same as
 * get_product/get_listing/get_order) — the Inventory row itself is then
 * read by the exact (productId, workspaceId) compound key the schema's
 * own @@unique constraint guarantees is at most one row, never a bare
 * productId lookup.
 */
async function resolveProduct(workspaceId: string, input: GetInventoryInput) {
  if (input.productId) {
    return ProductService.getProduct(input.productId, workspaceId);
  }
  // No existing service method resolves a product by SKU — this is a
  // minimal, equally workspace-scoped query (Product.sku is only unique
  // per-workspace via @@unique([workspaceId, sku]), so workspaceId must
  // always be part of the filter here too, never sku alone).
  return prisma.product.findFirst({
    where: { sku: input.sku!, workspaceId, deletedAt: null },
    include: { images: { orderBy: { order: 'asc' } } },
  });
}

export const getInventoryTool: AgentToolDefinition<GetInventoryInput> = {
  name: 'get_inventory',
  description:
    "Look up the real, live stock level for a single existing product belonging to the reseller's own workspace, by its ADKSY product id or SKU — " +
    'to answer factual questions like how many units are left, how many are reserved, how many are actually available to sell, or whether a SKU is out of stock. ' +
    'Read-only — never modifies anything, never requires confirmation. ' +
    "Inventory.available is the real source of truth for sellable stock — never state a stock level from a product's own declared quantity " +
    "(returned separately as declaredQuantity) when real inventory data is present; the two can legitimately differ and must never be conflated. " +
    "Returns { found: false } if the product doesn't exist in this workspace, or exists but has no inventory record at all — never another workspace's data.",
  category: 'read',
  inputSchema: getInventoryInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'The ADKSY product id (Product.id). Provide this or sku.' },
      sku: { type: 'string', description: "The product's SKU. Provide this or productId." },
    },
  },
  async handler(workspaceId, input) {
    const product = await resolveProduct(workspaceId, input);

    if (!product) {
      return { found: false };
    }

    // Same (productId, workspaceId) compound key already used in
    // listingTools.ts/productTools.ts for the real, live inventory row.
    const inventory = await prisma.inventory.findUnique({
      where: { productId_workspaceId: { productId: product.id, workspaceId } },
      select: { quantity: true, reserved: true, available: true, syncStatus: true, syncError: true, lastSyncedAt: true },
    });

    if (!inventory) {
      return { found: false };
    }

    return {
      found: true,
      inventory: {
        productId: product.id,
        sku: product.sku,
        productTitle: product.title,
        // Product's own declared quantity — NOT the live stock figure,
        // see this file's own header comment. Kept clearly distinct from
        // the real Inventory numbers below, never merged or renamed to
        // imply it's the same thing.
        declaredQuantity: product.quantity,
        quantity: inventory.quantity,
        reserved: inventory.reserved,
        available: inventory.available,
        syncStatus: inventory.syncStatus,
        syncError: inventory.syncError ?? null,
        lastSyncedAt: inventory.lastSyncedAt ? inventory.lastSyncedAt.toISOString() : null,
      },
    };
  },
};
