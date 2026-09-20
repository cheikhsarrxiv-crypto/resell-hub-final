import { z } from 'zod';
import { OrderService } from '@/services/OrderService';
import { prisma } from '@/lib/prisma';
import { ResellHubOrderStatus } from '@/services/marketplace/StatusMapper';
import { Marketplace } from '@/types/marketplace';
import { AgentToolDefinition } from './types';

const getOrderInputSchema = z.object({
  orderId: z.string().min(1, 'orderId is required'),
});

/**
 * Shapes OrderService.getOrder's raw Prisma result into a compact,
 * agent-facing object. Not a security boundary (Order has no
 * token/secret fields to begin with) — this exists so the model reasons
 * over a small, predictable JSON shape instead of the full ORM object
 * with every nested relation.
 */
function formatOrderForAgent(order: NonNullable<Awaited<ReturnType<typeof OrderService.getOrder>>>) {
  return {
    id: order.id,
    status: order.status,
    fulfillmentType: order.fulfillmentType,
    marketplace: order.marketplace,
    externalOrderId: order.externalOrderId,
    customerName: order.customerName,
    totalPrice: order.totalPrice,
    marketplaceFees: order.marketplaceFees,
    estimatedProfit: order.estimatedProfit,
    shippingCity: order.shippingCity,
    shippingCountry: order.shippingCountry,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      price: item.price,
    })),
    fulfillment: order.fulfillmentOrder
      ? {
          status: order.fulfillmentOrder.status,
          partner: order.fulfillmentOrder.partner.name,
          tracking: order.fulfillmentOrder.shipment
            ? {
                carrier: order.fulfillmentOrder.shipment.carrier,
                trackingNumber: order.fulfillmentOrder.shipment.trackingNumber,
                status: order.fulfillmentOrder.shipment.status,
              }
            : null,
        }
      : null,
  };
}

export const getOrderTool: AgentToolDefinition<{ orderId: string }> = {
  name: 'get_order',
  description:
    "Look up a single order belonging to the reseller's own workspace by its ADKSY order id. " +
    'Returns order status, items, pricing, and fulfillment/tracking info if any. ' +
    "Returns an error if the order doesn't exist in this workspace — never another workspace's order.",
  category: 'read',
  inputSchema: getOrderInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      orderId: {
        type: 'string',
        description: 'The ADKSY order id (Order.id), not a marketplace external order id.',
      },
    },
    required: ['orderId'],
  },
  async handler(workspaceId, input) {
    // OrderService.getOrder's `where: { id, workspaceId }` is the actual
    // isolation boundary — an order id from another workspace simply
    // matches no row and comes back null, exactly like every other
    // consumer of this method (see src/lib/security.ts's verifyOrderAccess).
    const order = await OrderService.getOrder(input.orderId, workspaceId);

    if (!order) {
      return { error: 'Order not found in this workspace.' };
    }

    return formatOrderForAgent(order);
  },
};

// The only statuses StatusMapper.mapToResellHub ever produces (confirmed by
// audit: OrdersSyncService/MarketplaceOrderService route every synced
// order's status through it, OrderService.createOrder/cancelOrder only
// ever write 'pending'/'cancelled', both members of this same set) — reused
// rather than inventing a separate list, exactly like salesSummaryTools.ts.
const RESELLHUB_ORDER_STATUSES: readonly ResellHubOrderStatus[] = [
  'pending',
  'confirmed',
  'shipped',
  'partially_shipped',
  'delivered',
  'cancelled',
  'failed',
];

// Matches AnalyticsService.getDashboardMetrics/getRevenueTrend's own
// default (already verified for salesSummaryTools.ts) — reused here rather
// than inventing a different default for the same kind of rolling window.
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

// Order.marketplace is a free string column (audit: written from either
// OrdersSyncService's sync-context Marketplace value or
// OrderService.createOrder's connection.marketplace.name), but the only
// real identifiers ever written are the app-level Marketplace enum's
// values — validating against it rejects a marketplace name that could
// never match a real order, rather than silently returning found:false.
const getOrdersInputSchema = z.object({
  days: z.number().int().min(1).max(MAX_DAYS).optional(),
  statuses: z
    .array(z.enum(RESELLHUB_ORDER_STATUSES as [ResellHubOrderStatus, ...ResellHubOrderStatus[]]))
    .min(1)
    .optional(),
  marketplace: z.nativeEnum(Marketplace).optional(),
  // Same codebase-wide default/cap this project already uses for a list of
  // orders (ProductService.getProducts/ListingService.getListings/
  // OrderService.getOrders/customerOrderTools.ts all take 50) — the default
  // here is smaller (20) since this is a chat-facing summary the model
  // reads directly, not a paginated UI list.
  limit: z.number().int().min(1).max(50).optional(),
});

type GetOrdersInput = z.infer<typeof getOrdersInputSchema>;

const DEFAULT_LIMIT = 20;

export const getOrdersTool: AgentToolDefinition<GetOrdersInput> = {
  name: 'get_orders',
  description:
    "List/search orders in the reseller's own workspace with real, supported filters — a rolling day window, order status, and/or marketplace — " +
    'to answer questions like "show my latest orders", "which orders are pending?", "my eBay orders", or "orders from the last 7 days". ' +
    `Defaults to the last ${DEFAULT_DAYS} days (max ${MAX_DAYS}) and returns up to ${DEFAULT_LIMIT} orders (max 50, most recent first); ` +
    'totalOrders is the real total count even if it exceeds the returned page. ' +
    'By default every order status is included — pass `statuses` to restrict to specific ones; this tool never decides on its own that cancelled or ' +
    'failed orders should be excluded. ' +
    'marketplace filters on the order\'s own real Order.marketplace value, never inferred from a listing. ' +
    'Returns only real, stored fields — never profit, margin, fees, fulfillment cost, refunds, shipping service/pickup point, or tracking, none of ' +
    'which this tool reads or can reliably provide.',
  category: 'read',
  inputSchema: getOrdersInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      days: {
        type: 'number',
        description: `Size of the rolling window in days, ending now. Defaults to ${DEFAULT_DAYS}, max ${MAX_DAYS}.`,
      },
      statuses: {
        type: 'array',
        items: { type: 'string', enum: RESELLHUB_ORDER_STATUSES as unknown as string[] },
        description:
          'Restrict to these exact order statuses. Omit to include every status (no restriction) — this tool never excludes cancelled/failed on its own.',
      },
      marketplace: {
        type: 'string',
        enum: Object.values(Marketplace),
        description: 'Restrict to orders from this marketplace (Order.marketplace). Omit to include every marketplace.',
      },
      limit: {
        type: 'number',
        description: `Maximum number of orders to return, most recent first. Defaults to ${DEFAULT_LIMIT}, max 50.`,
      },
    },
  },
  async handler(workspaceId, input) {
    const days = input.days ?? DEFAULT_DAYS;
    const limit = input.limit ?? DEFAULT_LIMIT;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const to = new Date();

    const where = {
      workspaceId,
      createdAt: { gte: from, lte: to },
      ...(input.statuses ? { status: { in: input.statuses } } : {}),
      ...(input.marketplace ? { marketplace: input.marketplace } : {}),
    };

    // items+product joined in the SAME query as the orders — avoids N+1
    // (same pattern as customerOrderTools.ts). The real total count is a
    // separate aggregate query (Promise.all([findMany, count])), needed so
    // totalOrders never misreports the true count as capped at `limit`.
    const [orders, totalOrders] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: { include: { product: { select: { sku: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    const period = { days, from: from.toISOString(), to: to.toISOString() };

    if (orders.length === 0) {
      return { found: false, period, orders: [], totalOrders: 0, returnedOrders: 0 };
    }

    return {
      found: true,
      period,
      orders: orders.map((order) => ({
        orderId: order.id,
        status: order.status,
        // Real column, nullable — only included as-is, never defaulted.
        marketplace: order.marketplace ?? null,
        totalAmount: order.totalPrice,
        createdAt: order.createdAt.toISOString(),
        customer: {
          customerId: order.customerId,
          name: order.customerName,
          email: order.customerEmail,
        },
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
      returnedOrders: orders.length,
    };
  },
};
