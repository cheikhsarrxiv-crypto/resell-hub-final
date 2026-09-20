import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AgentToolDefinition } from './types';

const getCustomerOrdersInputSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.customerId) || Boolean(data.email), {
    message: 'Either customerId or email is required',
  });

type GetCustomerOrdersInput = z.infer<typeof getCustomerOrdersInputSchema>;

// Same default this codebase already uses everywhere else a list is
// returned (OrderService.getOrders, ProductService.getProducts,
// ListingService.getListings) — reused rather than inventing a new one.
const MAX_ORDERS = 50;

/**
 * There is no Customer model (confirmed by audit) — customer identity is
 * denormalized directly onto Order's own customerId/customerEmail
 * columns, both required (never null) on every real Order row. This
 * builds the Prisma `where` for a single real customer:
 * - customerId alone -> match on customerId only.
 * - email alone -> match on customerEmail only.
 * - both provided -> match BOTH together (AND, never OR) — an OR here
 *   could conflate two different real people (one order matching the
 *   given customerId, a different order matching the given email), which
 *   is exactly the "never mix two customers" requirement.
 * workspaceId is always part of the same where clause — never a query
 * scoped by customerId/email alone.
 */
function buildCustomerWhere(workspaceId: string, input: GetCustomerOrdersInput) {
  if (input.customerId && input.email) {
    return { workspaceId, customerId: input.customerId, customerEmail: input.email };
  }
  if (input.customerId) {
    return { workspaceId, customerId: input.customerId };
  }
  return { workspaceId, customerEmail: input.email! };
}

export const getCustomerOrdersTool: AgentToolDefinition<GetCustomerOrdersInput> = {
  name: 'get_customer_orders',
  description:
    "Look up the order history for a single customer in the reseller's own workspace, by their customerId and/or email, to answer factual questions " +
    "like how many orders they've placed, what they bought, or their order statuses over time. " +
    'Read-only — never modifies anything, never requires confirmation. ' +
    'ADKSY has no separate Customer record — this matches on Order.customerId/customerEmail directly, so results are only as reliable as those ' +
    "marketplace-provided values. Returns only fields that are actually stored: there is no `currency` field on Order, so none is invented. " +
    `Returns up to ${MAX_ORDERS} most recent orders; totalOrders is the real total count even if it exceeds that. ` +
    "Returns { found: false } if no order in this workspace matches — never another workspace's data.",
  category: 'read',
  inputSchema: getCustomerOrdersInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      customerId: { type: 'string', description: 'The marketplace-provided customer id (Order.customerId). Provide this or email.' },
      email: { type: 'string', description: "The customer's email (Order.customerEmail). Provide this or customerId." },
    },
  },
  async handler(workspaceId, input) {
    const where = buildCustomerWhere(workspaceId, input);

    // items+product joined in the SAME query as the orders — avoids N+1
    // (Étape 4). The real total count is a separate aggregate query, the
    // same Promise.all([findMany, count]) pattern already used in
    // ProductService.getProducts/ListingService.getListings — needed so
    // totalOrders never misreports the true count as capped at MAX_ORDERS.
    // Only workspaceId + customerId/customerEmail in the where clause,
    // exactly like every other read tool's isolation boundary.
    const [orders, totalOrders] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: { include: { product: { select: { sku: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_ORDERS,
      }),
      prisma.order.count({ where }),
    ]);

    if (orders.length === 0) {
      return { found: false };
    }

    // No separate identity record exists — the customer summary is taken
    // from the most recent matching order's own real fields (orders are
    // already sorted newest-first), never merged/averaged across orders.
    const mostRecent = orders[0];

    return {
      found: true,
      customer: {
        customerId: mostRecent.customerId,
        email: mostRecent.customerEmail,
        name: mostRecent.customerName,
      },
      orders: orders.map((order) => ({
        orderId: order.id,
        status: order.status,
        totalAmount: order.totalPrice,
        createdAt: order.createdAt.toISOString(),
        // Real column, nullable — only included as-is, never defaulted.
        marketplace: order.marketplace ?? null,
        items: order.items.map((item) => ({
          productId: item.productId,
          title: item.title,
          // OrderItem has no sku column of its own — only the joined
          // Product's real sku, never fabricated.
          sku: item.product?.sku ?? null,
          quantity: item.quantity,
          unitPrice: item.price,
        })),
      })),
      totalOrders,
    };
  },
};
