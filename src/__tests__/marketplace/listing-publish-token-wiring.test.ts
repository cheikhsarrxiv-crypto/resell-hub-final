/**
 * Real-DB regression tests for the marketplace publish chain:
 *
 *   Marketplace connection (OAuth) -> encrypted token in DB -> decrypted
 *   correctly -> loaded onto the adapter -> ListingService.createListing()
 *   actually calls the marketplace API with a real token.
 *
 * Three independent bugs were found and fixed together, because fixing
 * only one would still leave publishing broken:
 *  1. ListingService normalized marketplace names to UPPERCASE before
 *     handing them to AdapterFactory, but the Marketplace enum (and
 *     Marketplace.name in the DB) is lowercase — AdapterFactory's switch
 *     never matched, so it always threw "Unsupported marketplace".
 *  2. TokenManager.decryptToken() never received the real AES-GCM IV
 *     used at encryption time (it was discarded — only the ciphertext
 *     was persisted) and reconstructed a fake one from the connection's
 *     id, which could never work — every decrypt after storage failed.
 *  3. ListingService.createListing/updateListing/deleteListing/
 *     syncListingInventory/handleSoldOut built a fresh adapter without
 *     ever loading the workspace's real access token onto it, so even a
 *     fully-connected account would fail with "Access token required".
 *
 * The eBay/Etsy HTTP calls themselves are mocked (no real API
 * credentials in this environment) — everything else (DB rows, real
 * AES-256-GCM encryption/decryption via TokenManager, the real
 * MarketplaceConnectionService/ListingService code paths) is real.
 */
import crypto from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TokenManager } from '@/services/marketplace/TokenManager';
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter';
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
process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'test-client-id';
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-client-secret';

async function setupWorkspaceWithConnection(realAccessToken: string, status: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const user = await prisma.user.create({
    data: { email: `listing-token-test-${suffix}@example.com`, name: 'Test User', password: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: { name: 'Test WS', slug: `listing-token-test-${suffix}`, userId: user.id },
  });
  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      sku: `TOK-TEST-${suffix}`,
      title: 'Token wiring test product',
      description: 'Used only to test the marketplace publish token chain.',
    },
  });
  const marketplace = await prisma.marketplace.upsert({
    where: { name: 'ebay' },
    update: {},
    create: { name: 'ebay', displayName: 'eBay' },
  });
  // SubscriptionService.getSubscription() falls back to the plan named
  // 'free' for a workspace with no subscription (real prod behavior) —
  // needs to actually exist for that fallback (and the plan-limit
  // enforcement it feeds) to do anything other than block everything.
  await prisma.plan.upsert({
    where: { name: 'free' },
    update: {},
    create: { name: 'free', displayName: 'Free', maxProducts: 10, maxListings: 20, maxOrders: 50, maxMarketplaces: 2, maxUsers: 1 },
  });

  const tokenManager = new TokenManager();
  const encrypted = tokenManager.encryptToken(realAccessToken, workspace.id);

  const connection = await prisma.marketplaceConnection.create({
    data: {
      workspaceId: workspace.id,
      marketplaceId: marketplace.name,
      status,
      // Only the combined `.encrypted` string is ever persisted in
      // production (MarketplaceConnectionService.handleOAuthCallback) —
      // mirror that exactly, don't also store `.iv` separately.
      encryptedOauthToken: encrypted.encrypted,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return { user, workspace, product, marketplace, connection };
}

async function cleanup(ids: { userId: string; workspaceId: string; productId: string }) {
  await prisma.listing.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {});
  await prisma.marketplaceConnection.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {});
  await prisma.product.delete({ where: { id: ids.productId } }).catch(() => {});
  await prisma.workspace.delete({ where: { id: ids.workspaceId } }).catch(() => {});
  await prisma.user.delete({ where: { id: ids.userId } }).catch(() => {});
}

describe.skipIf(!dbAvailable)('TokenManager - storage round trip (real DB persistence shape)', () => {
  it('decrypts correctly when only the combined `encrypted` string survives storage (no separate iv)', () => {
    const manager = new TokenManager();
    const original = 'real-oauth-access-token-abc123';

    const encrypted = manager.encryptToken(original, 'ws-real-1');

    // Simulate exactly what happens on the way through Prisma: only
    // `.encrypted` is written to a single DB column, `.iv` is never
    // stored anywhere.
    const asStoredInDb = { encrypted: encrypted.encrypted };

    const decrypted = manager.decryptToken(asStoredInDb, 'ws-real-1');
    expect(decrypted).toBe(original);
  });

  it('would have failed under the old (connection.id-as-iv) approach — regression guard', () => {
    const manager = new TokenManager();
    const encrypted = manager.encryptToken('some-token', 'ws-real-2');

    // The old code did: Buffer.from(connection.id, 'hex') as the IV,
    // instead of the real random IV used at encryption time. A cuid
    // like this is not a valid/matching IV, so decryption must fail.
    const fakeIvFromConnectionId = { encrypted: `${'clx1a2b3c4d5e6f7g8h9i0j1k2'}:${encrypted.encrypted.split(':')[1]}:${encrypted.encrypted.split(':')[2]}` };

    expect(() => manager.decryptToken(fakeIvFromConnectionId, 'ws-real-2')).toThrow();
  });
});

describe.skipIf(!dbAvailable)('ListingService.createListing - real token wiring', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the real decrypted access token onto the adapter and publishes (network mocked)', async () => {
    const realToken = 'real-ebay-access-token-xyz789';
    const { user, workspace, product, connection } = await setupWorkspaceWithConnection(
      realToken,
      'connected'
    );

    const setAccessTokenSpy = vi.spyOn(EbayAdapter.prototype, 'setAccessToken');
    const createListingSpy = vi
      .spyOn(EbayAdapter.prototype, 'createListing')
      .mockResolvedValue({ externalId: 'EBAY-MOCK-123' } as any);

    try {
      const result = await ListingService.createListing(workspace.id, {
        productId: product.id,
        title: 'Real token wiring test listing',
        description: 'Description long enough to pass validation rules.',
        price: 42,
        quantity: 1,
        marketplaceIds: ['ebay'],
        fulfillmentType: 'self',
      });

      // The token handed to the adapter must be the exact plaintext
      // token that was encrypted and stored — proves the full chain
      // (decrypt -> setAccessToken) actually ran with real data.
      expect(setAccessTokenSpy).toHaveBeenCalledWith(realToken);
      expect(createListingSpy).toHaveBeenCalledTimes(1);
      expect(setAccessTokenSpy.mock.invocationCallOrder[0]).toBeLessThan(
        createListingSpy.mock.invocationCallOrder[0]
      );

      expect(result).toHaveLength(1);
      expect(result[0].externalId).toBe('EBAY-MOCK-123');
      expect(result[0].syncStatus).toBe('synced');
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });

  it('never marks a mock/demo connection as synced — no listing silently reported as published', async () => {
    const { user, workspace, product } = await setupWorkspaceWithConnection('unused-token', 'mock');

    const createListingSpy = vi.spyOn(EbayAdapter.prototype, 'createListing');

    try {
      const result = await ListingService.createListing(workspace.id, {
        productId: product.id,
        title: 'Should not publish via a mock connection',
        description: 'Description long enough to pass validation rules.',
        price: 20,
        quantity: 1,
        marketplaceIds: ['ebay'],
        fulfillmentType: 'self',
      });

      // MarketplaceConnectionService.getAccessToken() rejects a
      // non-'connected' status before any network call is attempted.
      expect(createListingSpy).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].syncStatus).toBe('failed');
      expect(result[0].externalId).toBeNull();
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id, productId: product.id });
    }
  });
});
