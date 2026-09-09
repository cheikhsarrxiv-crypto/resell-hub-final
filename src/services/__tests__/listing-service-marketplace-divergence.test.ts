/**
 * Regression tests for Finding #4: ListingService.updateListing() and
 * deleteListing() used to call the marketplace adapter, swallow any
 * failure with only a console.error, and then unconditionally apply the
 * local DB mutation anyway — meaning a failed eBay/Etsy update or delete
 * still looked like a success in ADKSY, silently diverging from the real
 * marketplace state.
 *
 * The fix makes the marketplace call authoritative: the local DB is only
 * mutated once the marketplace call actually succeeds (or there was
 * nothing to call — no connection/externalId, unchanged prior behavior),
 * with one deliberate exception: a 404/NOT_FOUND from the marketplace on
 * delete is treated as an idempotent success (the item is already gone
 * there), using the existing ErrorNormalizer NOT_FOUND type rather than
 * inventing a new error model.
 *
 * No real eBay Sandbox network access is available in this environment,
 * and no database either (confirmed separately), so this mocks
 * '@/lib/prisma' and spies on EbayAdapter/MarketplaceConnectionService
 * prototypes — the same pattern already established in
 * cron-sync.test.ts for the same reasons. Everything else (the real
 * ListingService logic, the real toSafeMarketplaceErrorMessage mapping)
 * runs unmocked.
 */
import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    listing: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { ListingService } from '@/services/ListingService';
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService';
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter';
import { ErrorType } from '@/types/marketplace';

process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'test-client-id';
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-client-secret';
process.env.EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/ebay';
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

function makeListing(overrides: Partial<any> = {}) {
  return {
    id: 'listing-1',
    workspaceId: 'ws-1',
    productId: 'product-1',
    title: 'Old title',
    description: 'Old description',
    price: 10,
    quantity: 5,
    externalId: 'EBAY-SKU-1',
    status: 'active',
    syncStatus: 'synced',
    connection: {
      id: 'conn-1',
      marketplaceId: 'ebay',
      marketplace: { name: 'ebay', displayName: 'eBay' },
    },
    ...overrides,
  };
}

describe('ListingService.updateListing() — marketplace call is authoritative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-access-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marketplace update succeeds -> local DB adopts the new values', async () => {
    const listing = makeListing();
    (prisma.listing.findFirst as any).mockResolvedValue(listing);
    (prisma.listing.update as any).mockResolvedValue({ ...listing, title: 'New title', price: 20 });

    const updateListingSpy = vi.spyOn(EbayAdapter.prototype, 'updateListing').mockResolvedValue({} as any);

    const result = await ListingService.updateListing('listing-1', 'ws-1', { title: 'New title', price: 20 } as any);

    expect(updateListingSpy).toHaveBeenCalledWith(
      'EBAY-SKU-1',
      expect.objectContaining({ title: 'New title', price: 20 })
    );
    expect(prisma.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'listing-1' },
        data: expect.objectContaining({ title: 'New title', price: 20 }),
      })
    );
    expect(result).toMatchObject({ title: 'New title', price: 20 });
  });

  it('marketplace update fails -> local DB does NOT adopt the new values, and a safe error is thrown', async () => {
    const listing = makeListing();
    (prisma.listing.findFirst as any).mockResolvedValue(listing);

    vi.spyOn(EbayAdapter.prototype, 'updateListing').mockRejectedValue(
      new Error('Unexpected upstream failure: xyz-should-not-leak')
    );

    await expect(
      ListingService.updateListing('listing-1', 'ws-1', { title: 'New title', price: 20 } as any)
    ).rejects.toThrow("Couldn't update this listing on eBay. Please try again.");

    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it('does not leak the raw provider error text even when it matches a keyword-based safe-message branch', async () => {
    const listing = makeListing();
    (prisma.listing.findFirst as any).mockResolvedValue(listing);

    vi.spyOn(EbayAdapter.prototype, 'updateListing').mockRejectedValue(
      new Error('token=abc123-super-secret-should-not-leak')
    );

    let caught: any;
    try {
      await ListingService.updateListing('listing-1', 'ws-1', { title: 'New title' } as any);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe('Your eBay connection has expired. Reconnect it in Settings and try again.');
    expect(caught.message).not.toContain('abc123-super-secret-should-not-leak');
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it('missing externalId -> marketplace is never called, existing local-only update behavior preserved', async () => {
    const listing = makeListing({ externalId: null });
    (prisma.listing.findFirst as any).mockResolvedValue(listing);
    (prisma.listing.update as any).mockResolvedValue({ ...listing, title: 'New title' });

    const updateListingSpy = vi.spyOn(EbayAdapter.prototype, 'updateListing');

    await ListingService.updateListing('listing-1', 'ws-1', { title: 'New title' } as any);

    expect(updateListingSpy).not.toHaveBeenCalled();
    expect(prisma.listing.update).toHaveBeenCalled();
  });

  it('expired/invalid authentication (token refresh fails) -> no DB mutation at all', async () => {
    const listing = makeListing();
    (prisma.listing.findFirst as any).mockResolvedValue(listing);
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockRejectedValue(
      new Error('Connection status is expired')
    );
    const updateListingSpy = vi.spyOn(EbayAdapter.prototype, 'updateListing');

    await expect(
      ListingService.updateListing('listing-1', 'ws-1', { title: 'New title' } as any)
    ).rejects.toThrow('Connection status is expired');

    expect(updateListingSpy).not.toHaveBeenCalled();
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it('workspace isolation: a listingId not belonging to this workspace is never found or mutated', async () => {
    (prisma.listing.findFirst as any).mockResolvedValue(null); // simulates the where:{id, workspaceId} filter excluding it

    await expect(
      ListingService.updateListing('listing-1', 'someone-elses-ws', { title: 'New title' } as any)
    ).rejects.toThrow('Listing not found');

    expect(prisma.listing.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'listing-1', workspaceId: 'someone-elses-ws' } })
    );
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });
});

describe('ListingService.deleteListing() — marketplace call is authoritative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-access-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marketplace delete succeeds -> local DB becomes deleted/delisted', async () => {
    const listing = makeListing();
    (prisma.listing.findFirst as any).mockResolvedValue(listing);
    (prisma.listing.update as any).mockResolvedValue({ ...listing, deletedAt: new Date(), status: 'delisted' });

    const deleteListingSpy = vi.spyOn(EbayAdapter.prototype, 'deleteListing').mockResolvedValue(undefined);

    await ListingService.deleteListing('listing-1', 'ws-1');

    expect(deleteListingSpy).toHaveBeenCalledWith('EBAY-SKU-1');
    expect(prisma.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'listing-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date), status: 'delisted' }),
      })
    );
  });

  it('marketplace delete fails (non-404) -> local DB remains active, safe error thrown', async () => {
    const listing = makeListing();
    (prisma.listing.findFirst as any).mockResolvedValue(listing);

    vi.spyOn(EbayAdapter.prototype, 'deleteListing').mockRejectedValue({
      type: ErrorType.SERVER_ERROR,
      message: 'eBay server error. Will retry automatically.',
      statusCode: 500,
      retryable: true,
    });

    await expect(ListingService.deleteListing('listing-1', 'ws-1')).rejects.toThrow(
      "Couldn't remove this listing from eBay. Please try again."
    );

    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it('marketplace reports 404/NOT_FOUND (already gone) -> treated as idempotent success, DB becomes delisted', async () => {
    const listing = makeListing();
    (prisma.listing.findFirst as any).mockResolvedValue(listing);
    (prisma.listing.update as any).mockResolvedValue({ ...listing, deletedAt: new Date(), status: 'delisted' });

    vi.spyOn(EbayAdapter.prototype, 'deleteListing').mockRejectedValue({
      type: ErrorType.NOT_FOUND,
      message: 'eBay item not found',
      statusCode: 404,
      retryable: false,
    });

    await expect(ListingService.deleteListing('listing-1', 'ws-1')).resolves.toBeDefined();

    expect(prisma.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'delisted' }) })
    );
  });

  it('does not leak the raw provider error/status details in the thrown error', async () => {
    const listing = makeListing();
    (prisma.listing.findFirst as any).mockResolvedValue(listing);

    vi.spyOn(EbayAdapter.prototype, 'deleteListing').mockRejectedValue({
      type: ErrorType.AUTH_INVALID,
      message: 'eBay permission denied: internal-detail-should-not-leak',
      statusCode: 403,
      retryable: false,
    });

    let caught: any;
    try {
      await ListingService.deleteListing('listing-1', 'ws-1');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).not.toContain('internal-detail-should-not-leak');
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it('missing externalId -> marketplace is never called, existing local-only delete behavior preserved', async () => {
    const listing = makeListing({ externalId: null });
    (prisma.listing.findFirst as any).mockResolvedValue(listing);
    (prisma.listing.update as any).mockResolvedValue({ ...listing, deletedAt: new Date(), status: 'delisted' });

    const deleteListingSpy = vi.spyOn(EbayAdapter.prototype, 'deleteListing');

    await ListingService.deleteListing('listing-1', 'ws-1');

    expect(deleteListingSpy).not.toHaveBeenCalled();
    expect(prisma.listing.update).toHaveBeenCalled();
  });

  it('expired/invalid authentication (token refresh fails) -> no DB mutation at all', async () => {
    const listing = makeListing();
    (prisma.listing.findFirst as any).mockResolvedValue(listing);
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockRejectedValue(
      new Error('Connection status is expired')
    );
    const deleteListingSpy = vi.spyOn(EbayAdapter.prototype, 'deleteListing');

    await expect(ListingService.deleteListing('listing-1', 'ws-1')).rejects.toThrow('Connection status is expired');

    expect(deleteListingSpy).not.toHaveBeenCalled();
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });

  it('workspace isolation: a listingId not belonging to this workspace is never found or mutated', async () => {
    (prisma.listing.findFirst as any).mockResolvedValue(null);

    await expect(ListingService.deleteListing('listing-1', 'someone-elses-ws')).rejects.toThrow('Listing not found');

    expect(prisma.listing.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'listing-1', workspaceId: 'someone-elses-ws' } })
    );
    expect(prisma.listing.update).not.toHaveBeenCalled();
  });
});
