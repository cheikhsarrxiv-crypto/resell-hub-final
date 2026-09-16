/**
 * Real-DB regression tests for the fix to EtsyAdapter's previous
 * hardcoded who_made/when_made/taxonomy_id placeholders (taxonomy_id: 1,
 * when_made: 'made_to_order').
 *
 * ListingService.createListing must now block publishing to Etsy — for
 * that one marketplace only, never affecting other selected marketplaces
 * — when the product has no real Etsy category (etsyTaxonomyId) or
 * production year set, instead of silently publishing under a fabricated
 * category. See EtsyListingMapper.ts.
 *
 * Same convention as listing-publish-token-wiring.test.ts: real DB rows,
 * real EtsyListingMapper logic, only the Etsy HTTP call itself is mocked
 * (no real API credentials in this environment). Skipped entirely when no
 * test database is reachable (this sandbox has none).
 */
import crypto from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TokenManager } from '@/services/marketplace/TokenManager';
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter';
import { ListingService } from '@/services/ListingService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID || 'test-etsy-client-id';
process.env.ETSY_CLIENT_SECRET = process.env.ETSY_CLIENT_SECRET || 'test-etsy-client-secret';

async function setupWorkspaceWithEtsyConnection(productOverrides: Record<string, unknown> = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const user = await prisma.user.create({
    data: { email: `etsy-taxonomy-test-${suffix}@example.com`, name: 'Test User', password: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: { name: 'Test WS', slug: `etsy-taxonomy-test-${suffix}`, userId: user.id },
  });
  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      sku: `ETSY-TAX-TEST-${suffix}`,
      title: 'Etsy taxonomy test product',
      description: 'Used only to test the Etsy taxonomy publish block.',
      ...productOverrides,
    },
  });
  const marketplace = await prisma.marketplace.upsert({
    where: { name: 'etsy' },
    update: {},
    create: { name: 'etsy', displayName: 'Etsy' },
  });
  await prisma.plan.upsert({
    where: { name: 'free' },
    update: {},
    create: { name: 'free', displayName: 'Free', maxProducts: 10, maxListings: 20, maxOrders: 50, maxMarketplaces: 2, maxUsers: 1 },
  });

  const tokenManager = new TokenManager();
  const encrypted = tokenManager.encryptToken('real-etsy-access-token', workspace.id);

  await prisma.marketplaceConnection.create({
    data: {
      workspaceId: workspace.id,
      marketplaceId: marketplace.name,
      status: 'connected',
      sellerId: 'shop-123',
      encryptedOauthToken: encrypted.encrypted,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return { user, workspace, product };
}

async function cleanup(ids: { userId: string; workspaceId: string; productId: string }) {
  await prisma.listing.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {});
  await prisma.marketplaceConnection.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {});
  await prisma.product.delete({ where: { id: ids.productId } }).catch(() => {});
  await prisma.workspace.delete({ where: { id: ids.workspaceId } }).catch(() => {});
  await prisma.user.delete({ where: { id: ids.userId } }).catch(() => {});
}

describe.skipIf(!dbAvailable)('ListingService.createListing - Etsy taxonomy block', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks publishing to Etsy when the product has no etsyTaxonomyId, without ever calling the Etsy API', async () => {
    const { user, workspace, product } = await setupWorkspaceWithEtsyConnection({
      etsyTaxonomyId: null,
      etsyWhenMade: '2020_2025',
    });

    const createListingSpy = vi.spyOn(EtsyAdapter.prototype, 'createListing');

    try {
      const result = await ListingService.createListing(workspace.id, {
        productId: product.id,
        title: 'Blocked Etsy listing',
        description: 'Description long enough to pass validation rules.',
        price: 20,
        quantity: 1,
        marketplaceIds: ['etsy'],
        fulfillmentType: 'self',
      });

      expect(createListingSpy).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].syncStatus).toBe('failed');
      expect(result[0].syncError).toMatch(/Etsy category/i);
      expect(result[0].externalId).toBeNull();
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('blocks publishing to Etsy when the product has no etsyWhenMade, without ever calling the Etsy API', async () => {
    const { user, workspace, product } = await setupWorkspaceWithEtsyConnection({
      etsyTaxonomyId: 1429,
      etsyWhenMade: null,
    });

    const createListingSpy = vi.spyOn(EtsyAdapter.prototype, 'createListing');

    try {
      const result = await ListingService.createListing(workspace.id, {
        productId: product.id,
        title: 'Blocked Etsy listing (no when-made era)',
        description: 'Description long enough to pass validation rules.',
        price: 20,
        quantity: 1,
        marketplaceIds: ['etsy'],
        fulfillmentType: 'self',
      });

      expect(createListingSpy).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].syncStatus).toBe('failed');
      expect(result[0].syncError).toMatch(/when made/i);
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('publishes to Etsy with the real mapped who_made/when_made/taxonomy_id when both fields are set', async () => {
    const { user, workspace, product } = await setupWorkspaceWithEtsyConnection({
      etsyTaxonomyId: 1429,
      etsyWhenMade: '2020_2025',
    });

    const createListingSpy = vi
      .spyOn(EtsyAdapter.prototype, 'createListing')
      .mockResolvedValue({ externalId: 'ETSY-MOCK-123' } as any);

    try {
      const result = await ListingService.createListing(workspace.id, {
        productId: product.id,
        title: 'Real Etsy listing',
        description: 'Description long enough to pass validation rules.',
        price: 45,
        quantity: 1,
        marketplaceIds: ['etsy'],
        fulfillmentType: 'self',
      });

      expect(createListingSpy).toHaveBeenCalledTimes(1);
      const callArg = createListingSpy.mock.calls[0][0];
      expect(callArg.etsy).toEqual({
        whoMade: 'someone_else',
        whenMade: '2020_2025',
        taxonomyId: 1429,
      });

      expect(result[0].syncStatus).toBe('synced');
      expect(result[0].externalId).toBe('ETSY-MOCK-123');
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });
});
