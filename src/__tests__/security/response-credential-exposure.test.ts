/**
 * R3-B.5 / R3-B.5.7 — API responses carry no credential and only the
 * fields the dashboard reads (Orders, Listings, Fulfillment, Partners).
 *
 * No DB, no network: Prisma is mocked and the exact Prisma args each
 * response path sends are inspected (keys, not just source patterns), plus
 * source-level checks for the route files (they import next/server / @/auth,
 * which do not resolve in this Vitest setup — same convention as
 * connections-public-select.test.ts).
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, isLimitReachedMock } = vi.hoisted(() => {
  const fn = () => vi.fn(async (..._a: any[]): Promise<any> => null);
  return {
    isLimitReachedMock: vi.fn(async () => false),
    prismaMock: {
      order: { findFirst: fn(), findMany: vi.fn(async () => []), count: vi.fn(async () => 0), create: fn() },
      listing: {
        findFirst: fn(), findMany: vi.fn(async (..._a: any[]): Promise<any[]> => []),
        count: vi.fn(async () => 0), create: fn(), update: fn(),
      },
      product: { findFirst: fn() },
      marketplaceConnection: { findFirst: fn() },
      fulfillmentPartner: { findMany: vi.fn(async () => []) },
      fulfillmentOrder: { findFirst: fn(), findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    },
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/services/ProductService', () => ({ ProductService: { reserveInventory: vi.fn(async () => undefined) } }));
vi.mock('@/services/SubscriptionService', () => ({
  SubscriptionService: { isLimitReached: isLimitReachedMock, hasFeature: vi.fn(async () => true) },
}));
vi.mock('@/services/NotificationService', () => ({ NotificationService: {} }));
vi.mock('@/services/fulfillment/registry', () => ({ getFulfillmentProvider: vi.fn() }));

import { OrderService } from '@/services/OrderService';
import { FulfillmentService } from '@/services/FulfillmentService';
import { ListingService } from '@/services/ListingService';
import {
  orderListResponseSelect,
  orderDetailResponseSelect,
  listingListResponseSelect,
  listingDetailResponseSelect,
  listingMutationResponseSelect,
  fulfillmentOrderListResponseSelect,
  fulfillmentOrderSendResponseSelect,
} from '@/lib/publicResponseSelects';

const CREDENTIALS = [
  'apiKey', 'apiSecret', 'encryptedOauthToken', 'encryptedRefreshToken', 'accountEmail',
  'tokenExpiresAt', 'sellerId', 'accountId', 'webhookUrl', 'apiUrl', 'providerId',
];
const MINIMISED_AWAY = [
  'purchasePrice', 'customerId', 'shippingEmail', 'shippingPhone', 'shippingAddress2',
  'shippingState', 'externalOrderId', 'trackingUrl', 'estimatedDelivery', 'actualDelivery',
  'workspaceId', 'revenue', 'orders',
];

function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

/** A response query must use `select` only, with no credential or minimised-away key. */
function expectMinimalResponseArgs(args: any, expectedSelect: unknown) {
  expect(args.include, 'response queries must use select, not include').toBeUndefined();
  expect(args.select).toBe(expectedSelect);
  const keys = keysOf(args.select);
  for (const f of [...CREDENTIALS, ...MINIMISED_AWAY]) {
    expect(keys.has(f), `response must not select ${f}`).toBe(false);
  }
}

const lastArgs = (mock: any) => (mock.mock.calls[mock.mock.calls.length - 1] as any[])[0];

beforeEach(() => {
  vi.clearAllMocks();
  isLimitReachedMock.mockResolvedValue(false);
});

describe('OrderService', () => {
  it('getOrders (GET /api/orders): list select, no relation, workspace-scoped', async () => {
    await OrderService.getOrders('ws-1', 50, 0, 'pending');
    // S8: the response query is the FIRST call (a second, id-only query derives the profitKnown flag)
    const args = (prismaMock.order.findMany.mock.calls[0] as any[])[0];
    expect(args.where).toEqual({ workspaceId: 'ws-1', status: 'pending' });
    expectMinimalResponseArgs(args, orderListResponseSelect);
    expect(Object.values(args.select).every((v) => v === true)).toBe(true);
  });

  it('getOrderForResponse (GET /api/orders/[id]): detail select, scoped by id + workspace', async () => {
    await OrderService.getOrderForResponse('order-1', 'ws-1');
    const args = lastArgs(prismaMock.order.findFirst);
    expect(args.where).toEqual({ id: 'order-1', workspaceId: 'ws-1' });
    expectMinimalResponseArgs(args, orderDetailResponseSelect);
  });

  it('createOrderForResponse (POST /api/orders): same write path, then minimal re-read in the workspace', async () => {
    prismaMock.listing.findFirst.mockResolvedValueOnce({
      id: 'l1', productId: 'p1', price: 10,
      product: { title: 't', purchasePrice: 3 },
      connection: { marketplace: { name: 'ebay' } },
    });
    prismaMock.order.create.mockResolvedValueOnce({ id: 'o1' });
    prismaMock.order.findFirst.mockResolvedValueOnce({ id: 'o1', status: 'pending' });

    const result = await OrderService.createOrderForResponse('ws-1', {
      listingId: 'l1', customerName: 'n', customerEmail: 'e@e.e', totalPrice: 10,
      marketplaceFees: 1, estimatedProfit: 2, shippingAddress: 'a', shippingCity: 'c',
      shippingPostalCode: 'p', shippingCountry: 'FR',
    } as any);

    // internal listing lookup is still workspace-scoped and still loads cost + marketplace
    const listingArgs = lastArgs(prismaMock.listing.findFirst);
    expect(listingArgs.where.workspaceId).toBe('ws-1');
    expect(listingArgs.include.product).toBe(true);
    // the write itself is unchanged business behavior
    expect(prismaMock.order.create).toHaveBeenCalledTimes(1);
    // the returned object comes from the minimal select, scoped to the workspace
    const readArgs = lastArgs(prismaMock.order.findFirst);
    expect(readArgs.where).toEqual({ id: 'o1', workspaceId: 'ws-1' });
    expectMinimalResponseArgs(readArgs, orderDetailResponseSelect);
    expect(result).toEqual({ id: 'o1', status: 'pending', profitKnown: true }); // S8 derived flag, no externalOrderId
  });

  it('getOrder stays the rich internal lookup used by the AI tools (all scalars, shipment, partner, items.product)', async () => {
    await OrderService.getOrder('order-1', 'ws-1');
    const args = lastArgs(prismaMock.order.findFirst);
    expect(args.where).toEqual({ id: 'order-1', workspaceId: 'ws-1' });
    expect(args.select).toBeUndefined(); // include => every scalar (customerId, externalOrderId, ...)
    expect(args.include.items).toBeTruthy();
    expect(args.include.listing).toBeTruthy();
    expect(args.include.fulfillmentOrder.include.shipment.include.trackingEvents).toBeTruthy();
    // still credential-safe
    const keys = keysOf(args.include);
    for (const f of CREDENTIALS) expect(keys.has(f)).toBe(false);
    expect(args.include.fulfillmentOrder.include.partner.select).toEqual({ id: true, name: true, country: true });
  });
});

describe('ListingService', () => {
  it('getListings (GET /api/listings): list select, workspace-scoped, no relation other than connection ref', async () => {
    await ListingService.getListings('ws-1', 50, 0, 'active', 'ebay');
    const args = lastArgs(prismaMock.listing.findMany);
    expect(args.where.workspaceId).toBe('ws-1');
    expect(args.where.deletedAt).toBeNull();
    expectMinimalResponseArgs(args, listingListResponseSelect);
    expect(Object.keys(args.select).filter((k) => typeof args.select[k] !== 'boolean')).toEqual(['connection']);
  });

  it('getListingForResponse (GET /api/listings/[id]): detail select scoped by id + workspace', async () => {
    await ListingService.getListingForResponse('l1', 'ws-1');
    const args = lastArgs(prismaMock.listing.findFirst);
    expect(args.where).toEqual({ id: 'l1', workspaceId: 'ws-1' });
    expectMinimalResponseArgs(args, listingDetailResponseSelect);
  });

  it('getListingsForMutationResponse (POST / PATCH): minimal select, workspace-scoped, keeps order, drops foreign rows', async () => {
    prismaMock.listing.findMany.mockResolvedValueOnce([{ id: 'b' }, { id: 'a' }]);
    const rows = await ListingService.getListingsForMutationResponse(['a', 'x', 'b'], 'ws-1');
    const args = lastArgs(prismaMock.listing.findMany);
    expect(args.where).toEqual({ id: { in: ['a', 'x', 'b'] }, workspaceId: 'ws-1' });
    expectMinimalResponseArgs(args, listingMutationResponseSelect);
    expect(rows.map((r: any) => r.id)).toEqual(['a', 'b']);
    expect(await ListingService.getListingsForMutationResponse([], 'ws-1')).toEqual([]);
  });

  it('getListing stays the internal lookup (full product + images, connection ref only, no orders)', async () => {
    await ListingService.getListing('l1', 'ws-1');
    const args = lastArgs(prismaMock.listing.findFirst);
    expect(args.where).toEqual({ id: 'l1', workspaceId: 'ws-1' });
    expect(args.select).toBeUndefined();
    expect(args.include.product).toEqual({ include: { images: true } });
    expect(args.include.orders).toBeUndefined();
    expect(args.include.connection.select.marketplace.select).toEqual({ name: true, displayName: true });
    const keys = keysOf(args.include);
    for (const f of CREDENTIALS) expect(keys.has(f)).toBe(false);
  });

  it('createListing idempotent path: an existing non-failed listing is returned as-is, nothing is created or published', async () => {
    prismaMock.product.findFirst.mockResolvedValueOnce({ id: 'p1', images: [] });
    prismaMock.marketplaceConnection.findFirst.mockResolvedValueOnce({
      id: 'c1', marketplace: { name: 'ebay', displayName: 'eBay' },
    });
    const existing = { id: 'l1', syncStatus: 'synced', connection: { id: 'c1' } };
    prismaMock.listing.findFirst.mockResolvedValueOnce(existing);

    const result = await ListingService.createListing('ws-1', { productId: 'p1', marketplaceIds: ['ebay'] } as any);

    expect(result).toEqual([existing]);
    expect(prismaMock.listing.create).not.toHaveBeenCalled();
    expect(prismaMock.listing.update).not.toHaveBeenCalled();
    // the existing-listing lookup is workspace-bounded through product + connection and returns the credential-safe include
    const lookup = lastArgs(prismaMock.listing.findFirst);
    expect(lookup.include.connection.select.marketplace.select).toEqual({ name: true, displayName: true });
    // the product and connection lookups stay workspace-scoped
    expect(lastArgs(prismaMock.product.findFirst).where.workspaceId).toBe('ws-1');
    expect(lastArgs(prismaMock.marketplaceConnection.findFirst).where.workspaceId).toBe('ws-1');
  });
});

describe('FulfillmentService', () => {
  it('getAvailablePartners selects only id, name, country', async () => {
    await FulfillmentService.getAvailablePartners();
    expect(lastArgs(prismaMock.fulfillmentPartner.findMany).select).toEqual({ id: true, name: true, country: true });
  });

  it('getFulfillmentOrders (GET /api/fulfillment): list select, workspace-scoped', async () => {
    await FulfillmentService.getFulfillmentOrders('ws-1', 'pending');
    const args = lastArgs(prismaMock.fulfillmentOrder.findMany);
    expect(args.where).toEqual({ workspaceId: 'ws-1', status: 'pending' });
    expectMinimalResponseArgs(args, fulfillmentOrderListResponseSelect);
  });

  it('getFulfillmentOrderForSendResponse (POST /api/fulfillment/send): minimal select scoped by id + workspace', async () => {
    await FulfillmentService.getFulfillmentOrderForSendResponse('fo-1', 'ws-1');
    const args = lastArgs(prismaMock.fulfillmentOrder.findFirst);
    expect(args.where).toEqual({ id: 'fo-1', workspaceId: 'ws-1' });
    expectMinimalResponseArgs(args, fulfillmentOrderSendResponseSelect);
  });
});

// ---- source-level checks: routes, and that internal callers keep the rich methods ----
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');

describe('routes use only the response-shaped methods (source level)', () => {
  const ordersRoute = read('src/app/api/orders/route.ts');
  const ordersIdRoute = read('src/app/api/orders/[orderId]/route.ts');
  const listingsRoute = read('src/app/api/listings/route.ts');
  const listingsIdRoute = read('src/app/api/listings/[id]/route.ts');
  const fulfillmentRoute = read('src/app/api/fulfillment/route.ts');
  const sendRoute = read('src/app/api/fulfillment/send/route.ts');
  const partnersRoute = read('src/app/api/fulfillment/partners/route.ts');

  it('orders', () => {
    expect(ordersRoute).toContain('OrderService.getOrders(');
    expect(ordersRoute).toContain('OrderService.createOrderForResponse(');
    expect(ordersRoute).not.toMatch(/OrderService\.createOrder\(/);
    expect(ordersIdRoute).toContain('OrderService.getOrderForResponse(');
    expect(ordersIdRoute).not.toMatch(/OrderService\.getOrder\(/);
  });

  it('listings', () => {
    expect(listingsRoute).toContain('getListingsForMutationResponse(');
    expect(listingsIdRoute).toContain('getListingForResponse(');
    expect(listingsIdRoute).toContain('getListingsForMutationResponse(');
    expect(listingsIdRoute).not.toMatch(/ListingService\.getListing\(/);
  });

  it('fulfillment send returns the minimal re-read, fulfillment list uses the service select', () => {
    expect(sendRoute).toContain('getFulfillmentOrderForSendResponse(');
    expect(fulfillmentRoute).toContain('getFulfillmentOrders(');
  });

  it('partners keeps requireAuth before any query', () => {
    expect(partnersRoute).toContain('await requireAuth()');
    expect(partnersRoute.indexOf('await requireAuth()')).toBeLessThan(partnersRoute.indexOf('getAvailablePartners()'));
  });

  it.each([
    ['orders', ordersRoute],
    ['orders/[orderId]', ordersIdRoute],
    ['fulfillment', fulfillmentRoute],
    ['fulfillment/send', sendRoute],
    ['listings', listingsRoute],
    ['listings/[id]', listingsIdRoute],
  ])('%s route still verifies the workspace', (_n, src) => {
    expect(src).toContain('getVerifiedWorkspaceId(request)');
  });

  it('listing detail route still verifies ownership by id', () => {
    expect(listingsIdRoute).toContain('verifyListingAccess(params.id, workspaceId)');
  });
});

describe('AI tools keep using the rich internal methods (source level)', () => {
  it('order / shipment / customer tools use OrderService.getOrder, never the response variant', () => {
    for (const f of ['orderTools', 'shipmentTools', 'customerTools']) {
      const src = read(`src/services/ai/tools/${f}.ts`);
      expect(src, f).toContain('OrderService.getOrder(');
      expect(src, f).not.toContain('getOrderForResponse');
    }
  });

  it('listing and action tools use ListingService.getListing / updateListing / FulfillmentService.sendToFulfillment', () => {
    const listingTools = read('src/services/ai/tools/listingTools.ts');
    expect(listingTools).toContain('ListingService.getListing(');
    expect(listingTools).not.toContain('getListingForResponse');
    const actionTools = read('src/services/ai/tools/actionTools.ts');
    expect(actionTools).toContain('ListingService.getListing(');
    expect(actionTools).toContain('ListingService.updateListing(');
    expect(actionTools).toContain('FulfillmentService.sendToFulfillment(');
    expect(actionTools).not.toContain('ForResponse');
  });
});
