/**
 * Priority 2 fix: ListingService.createListing() had no protection at all
 * against publishing the same product to the same marketplace connection
 * twice — a double click, a client-side retry, or two near-simultaneous
 * requests could each create a separate, separately-live real marketplace
 * listing (billed/active on eBay/Etsy, not just a harmless duplicate DB row).
 *
 * Fixed with a two-step idempotency guard:
 *  1. Fast path: an existing, not-deleted Listing for (productId,
 *     marketplaceConnectionId) that is already 'synced' or 'syncing' is
 *     returned as-is — the real marketplace API is never called again.
 *  2. Race-safe reservation: before calling the marketplace, the intent
 *     is claimed by writing syncStatus 'syncing' to the DB first (a
 *     brand-new row via INSERT, or an existing 'failed' row reused via
 *     UPDATE). Once the corresponding partial unique index exists
 *     (@@... on (productId, marketplaceConnectionId) WHERE deletedAt IS
 *     NULL — migration pending a duplicate-check, not applied yet), two
 *     near-simultaneous INSERTs for a brand-new pair can only let one
 *     through; the loser here is proven to never reach
 *     adapter.createListing, so the real marketplace is never called
 *     twice — not just the local DB row.
 *  3. A legitimate republish after ListingService.deleteListing() (which
 *     sets deletedAt) must still work — the guard must never block that.
 *  4. A 'failed' listing (marketplace rejected it, or a real error) is a
 *     retryable slot, not a duplicate: retrying reuses that same row
 *     instead of creating a new one, and does call the marketplace again.
 *
 * No real eBay/DB access here — same convention as
 * listing-service-marketplace-divergence.test.ts: prisma is mocked,
 * EbayAdapter.createListing / MarketplaceConnectionService.getAccessToken
 * are spied on, everything else (the real ListingService logic) runs
 * unmocked.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findFirst: vi.fn() },
    marketplaceConnection: { findFirst: vi.fn() },
    listing: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { ListingService } from '@/services/ListingService';
import { SubscriptionService } from '@/services/SubscriptionService';
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService';
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter';

process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'test-client-id';
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-client-secret';
process.env.EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/ebay';
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const WORKSPACE_ID = 'ws-1';

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function makeProduct(overrides: Partial<any> = {}) {
  return { id: 'product-1', workspaceId: WORKSPACE_ID, sku: 'SKU-1', category: 'fashion', images: [], ...overrides };
}

function makeConnection(overrides: Partial<any> = {}) {
  return {
    id: 'conn-1',
    workspaceId: WORKSPACE_ID,
    marketplaceId: 'ebay',
    marketplace: { name: 'ebay', displayName: 'eBay' },
    ...overrides,
  };
}

function makeCreateInput(overrides: Partial<any> = {}) {
  return {
    productId: 'product-1',
    title: 'Test listing',
    description: 'A test listing description here',
    price: 10,
    quantity: 5,
    marketplaceIds: ['ebay'],
    fulfillmentType: 'self' as const,
    ...overrides,
  };
}

describe('ListingService.createListing() — duplicate-publish prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.product.findFirst as any).mockResolvedValue(makeProduct());
    (prisma.marketplaceConnection.findFirst as any).mockResolvedValue(makeConnection());
    vi.spyOn(SubscriptionService, 'isLimitReached').mockResolvedValue(false);
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-access-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a normal publish still succeeds: reserves, calls the marketplace once, finalizes to synced', async () => {
    (prisma.listing.findFirst as any).mockResolvedValue(null); // nothing exists yet
    (prisma.listing.create as any).mockResolvedValue({ id: 'listing-1', syncStatus: 'syncing' });
    (prisma.listing.update as any).mockResolvedValue({ id: 'listing-1', syncStatus: 'synced', externalId: 'EBAY-EXT-1' });
    const createSpy = vi.spyOn(EbayAdapter.prototype, 'createListing').mockResolvedValue({ externalId: 'EBAY-EXT-1' } as any);

    const result = await ListingService.createListing(WORKSPACE_ID, makeCreateInput());

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(prisma.listing.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ syncStatus: 'syncing' }) })
    );
    expect(prisma.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'listing-1' },
        data: { externalId: 'EBAY-EXT-1', syncStatus: 'synced' },
      })
    );
    expect(result).toEqual([{ id: 'listing-1', syncStatus: 'synced', externalId: 'EBAY-EXT-1' }]);
  });

  it('a second call for the same product+marketplace (already synced) never calls the marketplace again', async () => {
    (prisma.listing.findFirst as any).mockResolvedValue({
      id: 'listing-1',
      syncStatus: 'synced',
      externalId: 'EBAY-EXT-1',
      connection: makeConnection(),
    });
    const createSpy = vi.spyOn(EbayAdapter.prototype, 'createListing');

    const result = await ListingService.createListing(WORKSPACE_ID, makeCreateInput());

    expect(createSpy).not.toHaveBeenCalled();
    expect(prisma.listing.create).not.toHaveBeenCalled();
    expect(result[0].id).toBe('listing-1');
  });

  it('a second call while the first is still "syncing" never calls the marketplace again', async () => {
    (prisma.listing.findFirst as any).mockResolvedValue({
      id: 'listing-1',
      syncStatus: 'syncing',
      connection: makeConnection(),
    });
    const createSpy = vi.spyOn(EbayAdapter.prototype, 'createListing');

    await ListingService.createListing(WORKSPACE_ID, makeCreateInput());

    expect(createSpy).not.toHaveBeenCalled();
    expect(prisma.listing.create).not.toHaveBeenCalled();
  });

  it('losing the reservation race (unique constraint violation) never calls the marketplace, returns the race winner', async () => {
    (prisma.listing.findFirst as any)
      .mockResolvedValueOnce(null) // fast-path check: nothing yet
      .mockResolvedValueOnce({ id: 'listing-from-other-request', syncStatus: 'syncing', connection: makeConnection() }); // re-check after losing the race
    (prisma.listing.create as any).mockRejectedValue(uniqueConstraintError());
    const createSpy = vi.spyOn(EbayAdapter.prototype, 'createListing');

    const result = await ListingService.createListing(WORKSPACE_ID, makeCreateInput());

    expect(createSpy).not.toHaveBeenCalled(); // never reached the real marketplace call
    expect(result[0].id).toBe('listing-from-other-request');
  });

  it('a republish after a legitimate deleteListing (deletedAt set) is allowed and calls the marketplace again', async () => {
    // deleteListing sets deletedAt — the guard's query filters deletedAt: null,
    // so a soft-deleted listing must never be returned by it.
    (prisma.listing.findFirst as any).mockResolvedValue(null); // simulates: the only prior listing is soft-deleted, excluded by the where clause
    (prisma.listing.create as any).mockResolvedValue({ id: 'listing-2', syncStatus: 'syncing' });
    (prisma.listing.update as any).mockResolvedValue({ id: 'listing-2', syncStatus: 'synced', externalId: 'EBAY-EXT-2' });
    const createSpy = vi.spyOn(EbayAdapter.prototype, 'createListing').mockResolvedValue({ externalId: 'EBAY-EXT-2' } as any);

    await ListingService.createListing(WORKSPACE_ID, makeCreateInput());

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(prisma.listing.create).toHaveBeenCalledTimes(1);
  });

  it('retrying after a failed publish reuses the same row (update, not a new insert) and calls the marketplace again', async () => {
    (prisma.listing.findFirst as any).mockResolvedValue({
      id: 'listing-failed-1',
      syncStatus: 'failed',
      syncError: 'Previous failure',
      connection: makeConnection(),
    });
    (prisma.listing.update as any)
      .mockResolvedValueOnce({ id: 'listing-failed-1', syncStatus: 'syncing' }) // reservation update
      .mockResolvedValueOnce({ id: 'listing-failed-1', syncStatus: 'synced', externalId: 'EBAY-EXT-3' }); // finalize
    const createSpy = vi.spyOn(EbayAdapter.prototype, 'createListing').mockResolvedValue({ externalId: 'EBAY-EXT-3' } as any);

    const result = await ListingService.createListing(WORKSPACE_ID, makeCreateInput());

    expect(prisma.listing.create).not.toHaveBeenCalled(); // reused the existing row, never inserted a new one
    expect(prisma.listing.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'listing-failed-1' },
      data: { syncStatus: 'syncing', syncError: null },
    });
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(result[0].syncStatus).toBe('synced');
  });

  it('a failed marketplace call marks the reservation failed (never left stuck on "syncing")', async () => {
    (prisma.listing.findFirst as any).mockResolvedValue(null);
    (prisma.listing.create as any).mockResolvedValue({ id: 'listing-3', syncStatus: 'syncing' });
    (prisma.listing.update as any).mockResolvedValue({ id: 'listing-3', syncStatus: 'failed', syncError: expect.any(String) });
    vi.spyOn(EbayAdapter.prototype, 'createListing').mockRejectedValue(new Error('eBay rejected the listing'));

    const result = await ListingService.createListing(WORKSPACE_ID, makeCreateInput());

    expect(prisma.listing.update).toHaveBeenCalledWith({
      where: { id: 'listing-3' },
      data: { syncStatus: 'failed', syncError: expect.any(String) },
    });
    expect(result[0].syncStatus).toBe('failed');
  });
});
