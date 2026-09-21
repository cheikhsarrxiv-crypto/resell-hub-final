/**
 * Listing-reconciliation fix — tests for ListingReconciliationService
 * itself: the atomic claim (race-safety), the three lookup outcomes
 * (found / not_found / unable_to_verify) and their DB effects, and the
 * Etsy always-fail-closed decision. End-to-end tests through the real
 * publish_listing/publish_etsy_listing tools (including the exact
 * "adapter.createListing succeeds, markListingSynced throws" crash
 * scenario) live in actionTools.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listingStore } = vi.hoisted(() => ({ listingStore: new Map<string, any>() }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    listing: {
      // Race-safe conditional transition — the same idiom
      // AgentActionStateMachine already uses (updateMany with a `where`
      // status guard), mocked faithfully here: only counts as a match
      // (and only then mutates) when the row's CURRENT syncStatus equals
      // what `where` demands, exactly like a real SQL
      // `UPDATE ... WHERE id = ? AND syncStatus = ?` would.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = listingStore.get(where.id);
        if (!row || row.syncStatus !== where.syncStatus) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = listingStore.get(where.id);
        if (!row) throw new Error('Listing not found');
        Object.assign(row, data);
        return { ...row };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const row = listingStore.get(where.id);
        return row ? { ...row } : null;
      }),
    },
  },
}));

import { reconcileStuckListing, type EbayOfferLookup } from '@/services/listing/ListingReconciliationService';

type LookupResult = Awaited<ReturnType<EbayOfferLookup['findPublishedOfferBySku']>>;

function seedStuckListing(id: string, overrides: Record<string, any> = {}) {
  listingStore.set(id, { id, externalId: null, status: 'active', syncStatus: 'syncing', syncError: null, ...overrides });
}

beforeEach(() => {
  listingStore.clear();
});

describe('reconcileStuckListing — eBay (real lookup)', () => {
  it('found: adopts the real externalId, moves to synced, never re-publishes', async () => {
    seedStuckListing('listing-1');
    const ebayAdapter = { findPublishedOfferBySku: vi.fn(async () => ({ status: 'found' as const, listingId: 'LISTING-REAL-1', offerId: 'OFFER-1' })) };

    const result = await reconcileStuckListing({ id: 'listing-1' }, 'ebay', 'SKU-1', ebayAdapter, 'EBAY_GB');

    expect(result.outcome).toBe('synced');
    if (result.outcome === 'synced') {
      expect(result.listing.externalId).toBe('LISTING-REAL-1');
      expect(result.listing.syncStatus).toBe('synced');
    }
    expect(ebayAdapter.findPublishedOfferBySku).toHaveBeenCalledWith('SKU-1', 'EBAY_GB');
    expect(listingStore.get('listing-1').syncStatus).toBe('synced');
    expect(listingStore.get('listing-1').externalId).toBe('LISTING-REAL-1');
  });

  it('not_found: marketplace-confirmed absence moves the row to failed (the existing retryable-slot state) — never republishes itself', async () => {
    seedStuckListing('listing-1');
    const ebayAdapter = { findPublishedOfferBySku: vi.fn(async () => ({ status: 'not_found' as const })) };

    const result = await reconcileStuckListing({ id: 'listing-1' }, 'ebay', 'SKU-1', ebayAdapter, 'EBAY_GB');

    expect(result.outcome).toBe('not_found_retryable');
    expect(listingStore.get('listing-1').syncStatus).toBe('failed');
    expect(listingStore.get('listing-1').externalId).toBeNull();
    expect(listingStore.get('listing-1').syncError).toMatch(/retry/i);
  });

  it('unable_to_verify: an inconclusive check reverts the row to syncing — never marks failed, never marks synced', async () => {
    seedStuckListing('listing-1');
    const ebayAdapter = { findPublishedOfferBySku: vi.fn(async () => ({ status: 'unable_to_verify' as const, reason: 'eBay rate limited the check' })) };

    const result = await reconcileStuckListing({ id: 'listing-1' }, 'ebay', 'SKU-1', ebayAdapter, 'EBAY_GB');

    expect(result).toEqual({ outcome: 'unable_to_verify', reason: 'eBay rate limited the check' });
    expect(listingStore.get('listing-1').syncStatus).toBe('syncing');
    expect(listingStore.get('listing-1').externalId).toBeNull();
  });

  it('unable_to_verify: an unexpected throw from the adapter is never mistaken for not_found', async () => {
    seedStuckListing('listing-1');
    const ebayAdapter = { findPublishedOfferBySku: vi.fn(async () => { throw new Error('boom'); }) };

    const result = await reconcileStuckListing({ id: 'listing-1' }, 'ebay', 'SKU-1', ebayAdapter, 'EBAY_GB');

    expect(result.outcome).toBe('unable_to_verify');
    expect(listingStore.get('listing-1').syncStatus).toBe('syncing');
  });

  it('unable_to_verify: missing ebayMarketplaceId is never silently treated as not_found', async () => {
    seedStuckListing('listing-1');
    const ebayAdapter = { findPublishedOfferBySku: vi.fn() };

    const result = await reconcileStuckListing({ id: 'listing-1' }, 'ebay', 'SKU-1', ebayAdapter, undefined);

    expect(result.outcome).toBe('unable_to_verify');
    expect(ebayAdapter.findPublishedOfferBySku).not.toHaveBeenCalled();
    expect(listingStore.get('listing-1').syncStatus).toBe('syncing');
  });
});

describe('reconcileStuckListing — Etsy (documented fail-closed, no reliable lookup)', () => {
  it('always returns unable_to_verify, makes no lookup call, and leaves the row exactly as syncing', async () => {
    seedStuckListing('listing-etsy-1');

    const result = await reconcileStuckListing({ id: 'listing-etsy-1' }, 'etsy', 'SKU-ETSY-1', null, undefined);

    expect(result.outcome).toBe('unable_to_verify');
    if (result.outcome === 'unable_to_verify') {
      expect(result.reason).toMatch(/Etsy/);
    }
    expect(listingStore.get('listing-etsy-1').syncStatus).toBe('syncing');
    expect(listingStore.get('listing-etsy-1').externalId).toBeNull();
  });

  it('never concludes "not_found" for Etsy, whatever adapter is passed — the Etsy branch never even inspects it', async () => {
    seedStuckListing('listing-etsy-2');
    const ebayShapedAdapterThatShouldNeverBeCalled = { findPublishedOfferBySku: vi.fn(async () => ({ status: 'not_found' as const })) };

    const result = await reconcileStuckListing({ id: 'listing-etsy-2' }, 'etsy', 'SKU-ETSY-2', ebayShapedAdapterThatShouldNeverBeCalled as any, 'EBAY_GB');

    expect(result.outcome).toBe('unable_to_verify');
    expect(ebayShapedAdapterThatShouldNeverBeCalled.findPublishedOfferBySku).not.toHaveBeenCalled();
  });
});

describe('reconcileStuckListing — concurrency (race-safety)', () => {
  it('two concurrent reconciliations of the SAME listing: only one claims it and calls the marketplace; the other reports the outcome, never re-checks', async () => {
    seedStuckListing('listing-race-1');
    let resolveLookup!: (v: LookupResult) => void;
    const lookupPromise = new Promise<LookupResult>((resolve) => { resolveLookup = resolve; });
    const ebayAdapter: EbayOfferLookup = { findPublishedOfferBySku: vi.fn(() => lookupPromise) };

    // First call claims the row (synchronously, via the mocked
    // updateMany) and then awaits the still-pending lookup.
    const first = reconcileStuckListing({ id: 'listing-race-1' }, 'ebay', 'SKU-1', ebayAdapter, 'EBAY_GB');
    // Give the first call's microtasks a tick to perform its claim before the second one starts.
    await Promise.resolve();
    await Promise.resolve();

    const second = await reconcileStuckListing({ id: 'listing-race-1' }, 'ebay', 'SKU-1', ebayAdapter, 'EBAY_GB');
    expect(second.outcome).toBe('in_progress');
    expect(ebayAdapter.findPublishedOfferBySku).toHaveBeenCalledTimes(1); // never called twice for the same row

    resolveLookup({ status: 'found', listingId: 'LISTING-REAL-1', offerId: 'OFFER-1' });
    const firstResult = await first;
    expect(firstResult.outcome).toBe('synced');
    expect(listingStore.get('listing-race-1').syncStatus).toBe('synced');
  });

  it('a reconciliation attempted on a row that a concurrent one already resolved to synced reports already_published, never re-checks the marketplace', async () => {
    seedStuckListing('listing-race-2', { syncStatus: 'synced', externalId: 'LISTING-ALREADY-DONE' });
    const ebayAdapter = { findPublishedOfferBySku: vi.fn() };

    const result = await reconcileStuckListing({ id: 'listing-race-2' }, 'ebay', 'SKU-1', ebayAdapter, 'EBAY_GB');

    expect(result.outcome).toBe('already_published');
    if (result.outcome === 'already_published') {
      expect(result.listing.externalId).toBe('LISTING-ALREADY-DONE');
    }
    expect(ebayAdapter.findPublishedOfferBySku).not.toHaveBeenCalled();
  });

  it('a reconciliation attempted on a row a concurrent one already resolved to failed (not_found) reports not_found_retryable, never re-checks', async () => {
    seedStuckListing('listing-race-3', { syncStatus: 'failed', syncError: 'Publication could not be confirmed on the marketplace. Safe to retry.' });
    const ebayAdapter = { findPublishedOfferBySku: vi.fn() };

    const result = await reconcileStuckListing({ id: 'listing-race-3' }, 'ebay', 'SKU-1', ebayAdapter, 'EBAY_GB');

    expect(result.outcome).toBe('not_found_retryable');
    expect(ebayAdapter.findPublishedOfferBySku).not.toHaveBeenCalled();
  });

  it('never lets a concurrent unable_to_verify reversion cause an externalId to be overwritten by null on the winning branch', async () => {
    seedStuckListing('listing-race-4');
    const ebayAdapter = { findPublishedOfferBySku: vi.fn(async () => ({ status: 'found' as const, listingId: 'LISTING-WON', offerId: 'OFFER-1' })) };

    await reconcileStuckListing({ id: 'listing-race-4' }, 'ebay', 'SKU-1', ebayAdapter, 'EBAY_GB');
    expect(listingStore.get('listing-race-4').externalId).toBe('LISTING-WON');

    // A second, later reconciliation attempt on the now-synced row must
    // never touch externalId again.
    const second = await reconcileStuckListing({ id: 'listing-race-4' }, 'ebay', 'SKU-1', ebayAdapter, 'EBAY_GB');
    expect(second.outcome).toBe('already_published');
    expect(listingStore.get('listing-race-4').externalId).toBe('LISTING-WON');
  });
});
