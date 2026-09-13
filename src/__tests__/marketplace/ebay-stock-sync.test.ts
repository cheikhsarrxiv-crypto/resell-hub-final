/**
 * Tests the eBay stock-sync fix end to end:
 *
 *   ProductService.reserveInventory/releaseInventory (Inventory.available,
 *   the ADKSY source of truth) -> ListingService.syncListingInventory ->
 *   EbayAdapter.updateInventory -> eBay's bulkUpdatePriceQuantity.
 *
 * Part 1 (no DB needed) exercises EbayAdapter.updateInventory in
 * isolation with global.fetch mocked (same convention as
 * ebay-oauth.test.ts's createListing tests) to prove the real HTTP
 * method/endpoint/payload, without a live eBay Sandbox call.
 *
 * Part 2 (real DB, describe.skipIf(!dbAvailable)) proves the full chain
 * from ProductService down to the adapter, using the same
 * connection/token setup as listing-publish-token-wiring.test.ts —
 * EbayAdapter.updateInventory itself is mocked here (no real eBay
 * credentials in this environment) so these tests prove wiring and
 * error-isolation, not live delivery.
 */
import crypto from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter';

// ============================================================================
// Part 1: EbayAdapter.updateInventory — endpoint/method/payload (network mocked)
// ============================================================================

describe('EbayAdapter.updateInventory — bulkUpdatePriceQuantity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchOnce(response: { ok: boolean; status?: number; json: any }) {
    return vi.fn(async (_url: string, _init?: any) => ({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      statusText: response.ok ? 'OK' : 'Error',
      json: async () => response.json,
      text: async () => JSON.stringify(response.json),
    })) as any;
  }

  function makeAdapter() {
    const adapter = new EbayAdapter({ clientId: 'test', clientSecret: 'test', redirectUri: 'http://localhost' });
    adapter.setAccessToken('fake-access-token');
    return adapter;
  }

  it('POSTs to /sell/inventory/v1/bulk_update_price_quantity', async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: { responses: [{ sku: 'SKU-1', statusCode: 200 }] } });
    vi.stubGlobal('fetch', fetchMock);

    await makeAdapter().updateInventory('SKU-1', 7);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.sandbox.ebay.com/sell/inventory/v1/bulk_update_price_quantity');
    expect(init.method).toBe('POST');
  });

  it('sends the SKU and shipToLocationAvailability.quantity in the request body', async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: { responses: [{ sku: 'SKU-42', statusCode: 200 }] } });
    vi.stubGlobal('fetch', fetchMock);

    await makeAdapter().updateInventory('SKU-42', 3);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      requests: [
        {
          sku: 'SKU-42',
          shipToLocationAvailability: { quantity: 3 },
        },
      ],
    });
  });

  it('throws when eBay returns HTTP 200 but embeds a per-SKU failure', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: { responses: [{ sku: 'SKU-GONE', statusCode: 404, errors: [{ message: 'Inventory item does not exist' }] }] },
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(makeAdapter().updateInventory('SKU-GONE', 5)).rejects.toThrow();
  });

  it('resolves without throwing on a clean success response', async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: { responses: [{ sku: 'SKU-1', statusCode: 200 }] } });
    vi.stubGlobal('fetch', fetchMock);

    await expect(makeAdapter().updateInventory('SKU-1', 10)).resolves.toBeUndefined();
  });

  it('throws on an outright HTTP error (e.g. 401 expired token)', async () => {
    const fetchMock = mockFetchOnce({ ok: false, status: 401, json: { message: 'Invalid access token' } });
    vi.stubGlobal('fetch', fetchMock);

    await expect(makeAdapter().updateInventory('SKU-1', 10)).rejects.toThrow();
  });
});

// ============================================================================
// Part 2: ProductService.reserveInventory/releaseInventory -> real push chain
// ============================================================================

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'test-client-id';
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-client-secret';

async function setupWorkspace(available: number, reserved = 0) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const user = await prisma.user.create({
    data: { email: `ebay-stock-sync-${suffix}@example.com`, name: 'Test User', password: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: { name: 'Test WS', slug: `ebay-stock-sync-${suffix}`, userId: user.id },
  });
  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      sku: `STOCK-SYNC-${suffix}`,
      title: 'Stock sync test product',
      description: 'Used only to test the eBay stock push chain.',
    },
  });
  await prisma.inventory.create({
    data: {
      productId: product.id,
      workspaceId: workspace.id,
      quantity: available + reserved,
      available,
      reserved,
    },
  });

  return { user, workspace, product };
}

async function connectEbay(workspaceId: string) {
  const marketplace = await prisma.marketplace.upsert({
    where: { name: 'ebay' },
    update: {},
    create: { name: 'ebay', displayName: 'eBay' },
  });

  const { TokenManager } = await import('@/services/marketplace/TokenManager');
  const tokenManager = new TokenManager();
  const encrypted = tokenManager.encryptToken('real-ebay-access-token', workspaceId);

  return prisma.marketplaceConnection.create({
    data: {
      workspaceId,
      marketplaceId: marketplace.name,
      status: 'connected',
      encryptedOauthToken: encrypted.encrypted,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
}

async function createActiveEbayListing(productId: string, workspaceId: string, connectionId: string, externalId: string) {
  return prisma.listing.create({
    data: {
      productId,
      workspaceId,
      marketplaceConnectionId: connectionId,
      externalId, // deliberately NOT the SKU — proves the fix never uses this for the eBay call
      title: 'Test listing',
      description: 'Test listing description',
      price: 10,
      quantity: 5,
      status: 'active',
    },
  });
}

async function cleanup(ids: { userId: string; workspaceId: string; productId: string }) {
  await prisma.listing.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {});
  await prisma.marketplaceConnection.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {});
  await prisma.inventory.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {});
  await prisma.product.delete({ where: { id: ids.productId } }).catch(() => {});
  await prisma.workspace.delete({ where: { id: ids.workspaceId } }).catch(() => {});
  await prisma.user.delete({ where: { id: ids.userId } }).catch(() => {});
}

describe.skipIf(!dbAvailable)('ProductService.reserveInventory/releaseInventory — eBay stock push', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reserveInventory pushes the new absolute available quantity, keyed by Product.sku (not Listing.externalId)', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(10);
    const connection = await connectEbay(workspace.id);
    await createActiveEbayListing(product.id, workspace.id, connection.id, 'EBAY-ITEM-DIFFERENT-FROM-SKU');

    const updateInventorySpy = vi.spyOn(EbayAdapter.prototype, 'updateInventory').mockResolvedValue(undefined);

    try {
      const result = await ProductService.reserveInventory(product.id, workspace.id, 3);

      expect(result?.available).toBe(7); // 10 - 3
      expect(updateInventorySpy).toHaveBeenCalledTimes(1);
      expect(updateInventorySpy).toHaveBeenCalledWith(product.sku, 7); // absolute value, not a "-3" delta
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('releaseInventory also pushes the new absolute available quantity', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(4, 3); // 4 available, 3 reserved

    const connection = await connectEbay(workspace.id);
    await createActiveEbayListing(product.id, workspace.id, connection.id, 'EBAY-ITEM-XYZ');

    const updateInventorySpy = vi.spyOn(EbayAdapter.prototype, 'updateInventory').mockResolvedValue(undefined);

    try {
      const result = await ProductService.releaseInventory(product.id, workspace.id, 2);

      expect(result.available).toBe(6); // 4 + 2
      expect(updateInventorySpy).toHaveBeenCalledTimes(1);
      expect(updateInventorySpy).toHaveBeenCalledWith(product.sku, 6);
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('an eBay push failure never fails or rolls back the local reservation', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(10);
    const connection = await connectEbay(workspace.id);
    await createActiveEbayListing(product.id, workspace.id, connection.id, 'EBAY-ITEM-1');

    vi.spyOn(EbayAdapter.prototype, 'updateInventory').mockRejectedValue(new Error('eBay is down'));

    try {
      const result = await ProductService.reserveInventory(product.id, workspace.id, 4); // must resolve, not throw

      expect(result?.available).toBe(6); // the local reservation still succeeded

      const inventory = await prisma.inventory.findUnique({
        where: { productId_workspaceId: { productId: product.id, workspaceId: workspace.id } },
      });
      expect(inventory?.available).toBe(6); // persisted, not rolled back
      expect(inventory?.reserved).toBe(4);
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('an eBay push failure never fails releaseInventory either', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(2, 5);
    const connection = await connectEbay(workspace.id);
    await createActiveEbayListing(product.id, workspace.id, connection.id, 'EBAY-ITEM-1');

    vi.spyOn(EbayAdapter.prototype, 'updateInventory').mockRejectedValue(new Error('eBay is down'));

    try {
      const result = await ProductService.releaseInventory(product.id, workspace.id, 1);
      expect(result.available).toBe(3);
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('does not call the eBay API when the product has no active eBay listing', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(10);
    // No connection, no listing at all for this product.

    const updateInventorySpy = vi.spyOn(EbayAdapter.prototype, 'updateInventory');

    try {
      await ProductService.reserveInventory(product.id, workspace.id, 2);
      expect(updateInventorySpy).not.toHaveBeenCalled();
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('pushes to every active eBay listing when a product has more than one, always with the same SKU/quantity', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(10);
    const connection = await connectEbay(workspace.id);
    // Two active Listing rows for the same product on the same connection.
    await createActiveEbayListing(product.id, workspace.id, connection.id, 'EBAY-ITEM-A');
    await createActiveEbayListing(product.id, workspace.id, connection.id, 'EBAY-ITEM-B');

    const updateInventorySpy = vi.spyOn(EbayAdapter.prototype, 'updateInventory').mockResolvedValue(undefined);

    try {
      const result = await ProductService.reserveInventory(product.id, workspace.id, 1);

      expect(result?.available).toBe(9);
      expect(updateInventorySpy).toHaveBeenCalledTimes(2);
      // Both calls use the same product SKU and the same absolute quantity —
      // pushing to two listings of the same product is redundant but never
      // incorrect or double-decrementing (it's a "set", not a delta).
      expect(updateInventorySpy).toHaveBeenNthCalledWith(1, product.sku, 9);
      expect(updateInventorySpy).toHaveBeenNthCalledWith(2, product.sku, 9);
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });
});
