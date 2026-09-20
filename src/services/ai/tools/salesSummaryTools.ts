import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ResellHubOrderStatus } from '@/services/marketplace/StatusMapper';
import { AgentToolDefinition } from './types';

// The only statuses StatusMapper.mapToResellHub ever produces (confirmed by
// audit: OrdersSyncService/MarketplaceOrderService route every synced
// order's status through it, and OrderService.createOrder/cancelOrder only
// ever write 'pending'/'cancelled', both members of this same set) — reused
// rather than inventing a separate list, so `statuses` can never silently
// accept a value real orders never actually have.
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
// default (verified this turn) — not invented for this tool.
const DEFAULT_DAYS = 30;

// The rolling window is unbounded in AnalyticsService today, but this is a
// new tool the model can call freely, so an upper bound avoids an
// arbitrarily large unbounded scan — 1 year, generous enough for any real
// "sales summary" question.
const MAX_DAYS = 365;

const getSalesSummaryInputSchema = z.object({
  days: z.number().int().min(1).max(MAX_DAYS).optional(),
  statuses: z.array(z.enum(RESELLHUB_ORDER_STATUSES as [ResellHubOrderStatus, ...ResellHubOrderStatus[]])).min(1).optional(),
});

type GetSalesSummaryInput = z.infer<typeof getSalesSummaryInputSchema>;

interface MarketplaceBucket {
  marketplace: string | null;
  ordersCount: number;
  grossRevenue: number;
  itemsSold: number;
}

export const getSalesSummaryTool: AgentToolDefinition<GetSalesSummaryInput> = {
  name: 'get_sales_summary',
  description:
    "Summarize real sales activity for the reseller's own workspace over a rolling window: number of orders, gross revenue, items sold, average " +
    'order value, and the same breakdown per marketplace (grouped by the real Order.marketplace value, never inferred from a listing). ' +
    `Defaults to the last ${DEFAULT_DAYS} days if no \`days\` is given, up to a maximum of ${MAX_DAYS}. This is a rolling window (now minus N days), ` +
    'not an aligned calendar day/week/month, and it is not converted to any specific timezone. ' +
    'By default every order status is included — pass `statuses` to restrict to specific ones; this tool never decides on its own that cancelled or ' +
    'failed orders should be excluded from a "sale". ' +
    'Deliberately never returns profit, margin, net profit, marketplace fees, fulfillment cost, refunds, or returns — none of that data is reliably ' +
    'computed for real marketplace-synced orders today (estimatedProfit/marketplaceFees are not trustworthy), so this tool never presents it as fact.',
  category: 'read',
  inputSchema: getSalesSummaryInputSchema,
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
    },
  },
  async handler(workspaceId, input) {
    const days = input.days ?? DEFAULT_DAYS;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const to = new Date();

    // Single query, items joined in the same call — no per-order/per-
    // marketplace follow-up query (Étape 5's N+1 constraint). Aggregation
    // happens in memory below, the same "findMany + calcul mémoire"
    // pattern AnalyticsService.getDashboardMetrics already uses for this
    // exact shape of question.
    const orders = await prisma.order.findMany({
      where: {
        workspaceId,
        createdAt: { gte: from, lte: to },
        ...(input.statuses ? { status: { in: input.statuses } } : {}),
      },
      select: {
        totalPrice: true,
        marketplace: true,
        items: { select: { quantity: true } },
      },
    });

    const period = { days, from: from.toISOString(), to: to.toISOString() };

    if (orders.length === 0) {
      return {
        found: false,
        period,
        metrics: { ordersCount: 0, grossRevenue: 0, itemsSold: 0, averageOrderValue: 0 },
        byMarketplace: [],
      };
    }

    let grossRevenue = 0;
    let itemsSold = 0;
    // Order.marketplace is nullable — grouped under the real value (null
    // included) rather than fabricating an "Unknown" label for it.
    const byMarketplaceMap = new Map<string | null, MarketplaceBucket>();

    for (const order of orders) {
      const orderItemsSold = order.items.reduce((sum, item) => sum + item.quantity, 0);

      grossRevenue += order.totalPrice;
      itemsSold += orderItemsSold;

      const key = order.marketplace ?? null;
      const bucket = byMarketplaceMap.get(key) ?? {
        marketplace: key,
        ordersCount: 0,
        grossRevenue: 0,
        itemsSold: 0,
      };
      bucket.ordersCount += 1;
      bucket.grossRevenue += order.totalPrice;
      bucket.itemsSold += orderItemsSold;
      byMarketplaceMap.set(key, bucket);
    }

    const ordersCount = orders.length;

    return {
      found: true,
      period,
      metrics: {
        ordersCount,
        grossRevenue,
        itemsSold,
        averageOrderValue: ordersCount > 0 ? grossRevenue / ordersCount : 0,
      },
      byMarketplace: Array.from(byMarketplaceMap.values()),
    };
  },
};
