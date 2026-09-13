/**
 * Proves the fix for the SKU/listing_id regression: ListingService's
 * getInventoryUpdateIdentifier() (used by syncListingInventory and
 * handleSoldOut) sends each marketplace's Inventory API the identifier it
 * actually expects:
 *   - eBay's bulkUpdatePriceQuantity is keyed by Product.sku.
 *   - Etsy's /listings/{listing_id}/inventory is keyed by the listing_id
 *     itself (Listing.externalId) — Etsy has no SKU-indexed endpoint.
 * Before this fix, both received Product.sku unconditionally, which is
 * wrong for Etsy.
 *
 * Real DB (describe.skipIf(!dbAvailable)), same setup convention as
 * ebay-stock-sync.test.ts. Both adapters' HTTP-calling updateInventory is
 * mocked (no real eBay/Etsy credentials in this environment) — everything
 * else (ProductService, ListingService, real token decryption) is real.
 */
import crypto from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter';
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'test-ebay-client-id';
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-ebay-client-secret';
process.env.ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID || 'test-etsy-client-id';
process.env.ETSY_CLIENT_SECRET = process.env.ETSY_CLIENT_SECRET || 'test-etsy-client-secret';

async function setupWorkspace(available: number) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const user = await prisma.user.create({
    data: { email: `inv-id-test-${suffix}@example.com`, name: 'Test User', password: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: { name: 'Test WS', slug: `inv-id-test-${suffix}`, userId: user.id },
  });
  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      sku: `INV-ID-${suffix}`,
      title: 'Inventory identifier test product',
      description: 'Used only to test per-marketplace identifier selection.',
    },
  });
  await prisma.inventory.create({
    data: { productId: product.id, workspaceId: workspace.id, quantity: available, available, reserved: 0 },
  });

  return { user, workspace, product };
}

async function connectMarketplace(workspaceId: string, name: 'ebay' | 'etsy') {
  const marketplace = await prisma.marketplace.upsert({
    where: { name },
    update: {},
    create: { name, displayName: name === 'ebay' ? 'eBay' : 'Etsy' },
  });

  const { TokenManager } = await import('@/services/marketplace/TokenManager');
  const tokenManager = new TokenManager();
  const encrypted = tokenManager.encryptToken(`real-${name}-access-token`, workspaceId);

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

async function createActiveListing(productId: string, workspaceId: string, connectionId: string, externalId: string) {
  return prisma.listing.create({
    data: {
      productId,
      workspaceId,
      marketplaceConnectionId: connectionId,
      externalId,
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

describe.skipIf(!dbAvailable)('Per-marketplace Inventory API identifier (SKU vs listing_id)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('eBay: updateInventory is called with Product.sku, not Listing.externalId', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(10);
    const connection = await connectMarketplace(workspace.id, 'ebay');
    await createActiveListing(product.id, workspace.id, connection.id, 'EBAY-LISTING-ID-999');

    const ebaySpy = vi.spyOn(EbayAdapter.prototype, 'updateInventory').mockResolvedValue(undefined);

    try {
      await ProductService.reserveInventory(product.id, workspace.id, 3);

      expect(ebaySpy).toHaveBeenCalledTimes(1);
      expect(ebaySpy).toHaveBeenCalledWith(product.sku, 7);
      expect(ebaySpy).not.toHaveBeenCalledWith('EBAY-LISTING-ID-999', expect.anything());
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('Etsy: updateInventory is called with Listing.externalId (listing_id), not Product.sku', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(10);
    const connection = await connectMarketplace(workspace.id, 'etsy');
    const listing = await createActiveListing(product.id, workspace.id, connection.id, 'ETSY-LISTING-ID-555');

    const etsySpy = vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockResolvedValue(undefined);

    try {
      await ProductService.reserveInventory(product.id, workspace.id, 4);

      expect(etsySpy).toHaveBeenCalledTimes(1);
      expect(etsySpy).toHaveBeenCalledWith(listing.externalId, 6);
      expect(etsySpy).not.toHaveBeenCalledWith(product.sku, expect.anything());
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('a product listed on both eBay and Etsy sends each adapter its own correct identifier', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(20);
    const ebayConnection = await connectMarketplace(workspace.id, 'ebay');
    const etsyConnection = await connectMarketplace(workspace.id, 'etsy');
    await createActiveListing(product.id, workspace.id, ebayConnection.id, 'EBAY-LISTING-ID-1');
    const etsyListing = await createActiveListing(product.id, workspace.id, etsyConnection.id, 'ETSY-LISTING-ID-1');

    const ebaySpy = vi.spyOn(EbayAdapter.prototype, 'updateInventory').mockResolvedValue(undefined);
    const etsySpy = vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockResolvedValue(undefined);

    try {
      await ProductService.reserveInventory(product.id, workspace.id, 5);

      expect(ebaySpy).toHaveBeenCalledTimes(1);
      expect(ebaySpy).toHaveBeenCalledWith(product.sku, 15);
      expect(etsySpy).toHaveBeenCalledTimes(1);
      expect(etsySpy).toHaveBeenCalledWith(etsyListing.externalId, 15);
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('an Etsy push failure never fails or rolls back reserveInventory', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(10);
    const connection = await connectMarketplace(workspace.id, 'etsy');
    await createActiveListing(product.id, workspace.id, connection.id, 'ETSY-LISTING-ID-1');

    vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockRejectedValue(new Error('Etsy is down'));

    try {
      const result = await ProductService.reserveInventory(product.id, workspace.id, 3); // must resolve, not throw
      expect(result?.available).toBe(7);

      const inventory = await prisma.inventory.findUnique({
        where: { productId_workspaceId: { productId: product.id, workspaceId: workspace.id } },
      });
      expect(inventory?.available).toBe(7); // persisted, not rolled back
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('simultaneous eBay AND Etsy push failures never fail releaseInventory', async () => {
    const { ProductService } = await import('@/services/ProductService');
    const { user, workspace, product } = await setupWorkspace(2);
    const ebayConnection = await connectMarketplace(workspace.id, 'ebay');
    const etsyConnection = await connectMarketplace(workspace.id, 'etsy');
    await createActiveListing(product.id, workspace.id, ebayConnection.id, 'EBAY-LISTING-ID-1');
    await createActiveListing(product.id, workspace.id, etsyConnection.id, 'ETSY-LISTING-ID-1');

    vi.spyOn(EbayAdapter.prototype, 'updateInventory').mockRejectedValue(new Error('eBay is down'));
    vi.spyOn(EtsyAdapter.prototype, 'updateInventory').mockRejectedValue(new Error('Etsy is down'));

    try {
      const result = await ProductService.releaseInventory(product.id, workspace.id, 3); // must resolve, not throw
      expect(result.available).toBe(5); // 2 + 3, both marketplace pushes failed but the local release still applied
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });
});
