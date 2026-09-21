import { prisma } from '@/lib/prisma';

/**
 * Listing-reconciliation fix (audit finding CRITICAL, commit 3d4ec59's own
 * follow-up audit) — closes exactly one gap: a Listing stuck at
 * syncStatus='syncing' because the real marketplace call (eBay/Etsy
 * createListing) already succeeded, but the local DB write that should
 * have followed it (markListingSynced) then failed or crashed. Before
 * this fix, actionTools.ts's reserveListingForPublish treated ANY
 * non-'failed' existing Listing (including a stuck 'syncing' one with no
 * externalId) as already published — silently reporting
 * `alreadyPublished: true, externalId: null` forever, with no way to
 * recover the real externalId or to safely retry.
 *
 * Scope is deliberately narrow: this file only decides what to do with an
 * ALREADY-STUCK 'syncing' Listing. It never touches the normal
 * success/failure paths (reserveListingForPublish's 'synced'/'failed'
 * branches are unchanged), never creates a Product, never talks to
 * AiUsageService/AiEntitlementService, never touches OrdersSyncService.
 *
 * ABSOLUTE RULE this whole module exists to enforce: "not found" (the
 * marketplace positively confirms no matching published listing exists)
 * and "unable to verify" (the check itself failed or was inconclusive)
 * are NEVER the same outcome. Only a marketplace-confirmed "not found"
 * may ever unblock a retry; "unable to verify" always fails closed —
 * the Listing simply stays 'syncing' and the caller gets an explicit
 * error, never a silent republish.
 */

export type ReconciliationOutcome =
  /** The marketplace confirms a real, published listing exists — the local row now has a real externalId and is 'synced'. */
  | { outcome: 'synced'; listing: ReconciledListing }
  /**
   * The marketplace positively confirms no matching published listing
   * exists — the ONLY case where a retry is unblocked. The row is moved
   * to 'failed' (the same, already-existing "retryable slot" state
   * reserveListingForPublish already reuses for a normal publish
   * failure — no new status needed for this branch).
   */
  | { outcome: 'not_found_retryable'; listing: ReconciledListing }
  /**
   * Another concurrent request already resolved (or is actively
   * resolving) this exact stuck Listing. The caller must NOT check the
   * marketplace again for it — it reports whatever the concurrent
   * resolution already produced (or, if still in flight, an explicit
   * "in progress" refusal — never proceeds as if it owns the row).
   */
  | { outcome: 'already_published'; listing: ReconciledListing }
  | { outcome: 'in_progress' }
  /**
   * The marketplace check itself could not be completed (auth, network,
   * rate limit, or — for Etsy — no reliable check exists at all with the
   * data ADKSY stores today). Fail closed: the row is left exactly as it
   * was ('syncing'), nothing is concluded, no retry is ever unblocked.
   */
  | { outcome: 'unable_to_verify'; reason: string };

interface ReconciledListing {
  id: string;
  externalId: string | null;
  status: string;
  syncStatus: string;
}

export interface EbayOfferLookup {
  findPublishedOfferBySku(
    sku: string,
    marketplaceId: string
  ): Promise<{ status: 'found'; listingId: string; offerId: string } | { status: 'not_found' } | { status: 'unable_to_verify'; reason: string }>;
}

/**
 * Etsy has no reliable, bounded way to look up a previously created
 * listing by SKU with the data ADKSY stores today: Etsy's core Listing
 * resource carries no SKU field at all (see EtsyAdapter.ts's own header
 * comment and updateInventory — SKU only lives on the nested
 * /listings/{id}/inventory sub-resource, keyed BY an already-known
 * listing_id, which is exactly the value this reconciliation is trying to
 * recover). The only theoretical alternative — paging through every
 * active shop listing and fetching each one's /inventory to compare SKUs
 * — cannot honestly produce a marketplace-confirmed "not found" unless it
 * covers the ENTIRE shop without interruption; a partial/capped scan that
 * finds nothing is "unable to verify", not "not found", and a shop can be
 * arbitrarily large. Rather than build an expensive, unverified scan that
 * risks turning "we didn't look far enough" into a false "not found" (the
 * one outcome this whole fix exists to prevent — see this file's header),
 * Etsy reconciliation always fails closed, explicitly and immediately, no
 * network call made. This is a deliberate scope decision, not a missing
 * feature: revisit only if Etsy's API adds a real SKU-indexed listing
 * lookup.
 */
const ETSY_RECONCILIATION_UNAVAILABLE_REASON =
  'Etsy has no reliable SKU-indexed listing lookup with the data ADKSY stores today (SKU lives only on a per-listing inventory sub-resource, keyed by the very listing id this check is trying to recover) — Etsy reconciliation always fails closed rather than risk a false "not found".';

/**
 * Atomically claims a stuck 'syncing' Listing for reconciliation. Mirrors
 * the same conditional-update idiom already used elsewhere in this
 * codebase for exactly this purpose (AgentActionStateMachine's
 * `updateMany({ where: { id, status: from } })` transitions, and
 * AiUsageService's atomic reservation) — never two concurrent callers
 * allowed to both check the marketplace and both write a conclusion for
 * the same row. 'reconciling' is a new, transient syncStatus value
 * introduced strictly for this: it exists only for the moment between
 * "we own this check" and "we wrote the real conclusion", the same role
 * AgentAction's own EXECUTING status already plays for action confirmation.
 * Listing.syncStatus is a plain, unconstrained string column (no DB CHECK
 * constraint — verified against prisma/migrations/20260824064349_init),
 * so this requires no schema change or migration.
 */
async function claimForReconciliation(listingId: string): Promise<boolean> {
  const claimed = await prisma.listing.updateMany({
    where: { id: listingId, syncStatus: 'syncing' },
    data: { syncStatus: 'reconciling' },
  });
  return claimed.count === 1;
}

/** Reverts a claim back to 'syncing' without concluding anything — used only on the 'unable_to_verify' path. */
async function releaseClaim(listingId: string): Promise<void> {
  await prisma.listing.updateMany({
    where: { id: listingId, syncStatus: 'reconciling' },
    data: { syncStatus: 'syncing' },
  });
}

function toReconciledListing(row: { id: string; externalId: string | null; status: string; syncStatus: string }): ReconciledListing {
  return { id: row.id, externalId: row.externalId, status: row.status, syncStatus: row.syncStatus };
}

/**
 * Re-reads the current row when this caller lost the atomic claim to a
 * concurrent reconciliation, and reports whatever that concurrent
 * resolution already concluded — never re-checks the marketplace itself.
 */
async function reportConcurrentOutcome(listingId: string): Promise<ReconciliationOutcome> {
  const current = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!current) {
    return { outcome: 'unable_to_verify', reason: 'Listing no longer exists.' };
  }
  if (current.syncStatus === 'synced') {
    return { outcome: 'already_published', listing: toReconciledListing(current) };
  }
  if (current.syncStatus === 'failed') {
    return { outcome: 'not_found_retryable', listing: toReconciledListing(current) };
  }
  // Still 'syncing' or 'reconciling' — a concurrent reconciliation is in
  // flight (or finished and reverted to 'syncing' on an unable_to_verify
  // outcome an instant before this read). Never proceed as if this
  // caller owns the row.
  return { outcome: 'in_progress' };
}

/**
 * Reconciles a Listing stuck at syncStatus='syncing' with the real
 * marketplace state. Called ONLY when reserveListingForPublish
 * (actionTools.ts) finds an existing 'syncing' row for the
 * (productId, connectionId) pair being published — never for a fresh
 * publish or for an already-'synced'/'failed' row (those are unchanged,
 * normal paths).
 *
 * `marketplace`/`sku`/`ebayMarketplaceId` are exactly the values the
 * calling tool already resolved and workspace-verified before reaching
 * this point (real Product.sku, real target eBay marketplaceId from the
 * already-validated draft) — this function trusts them as given and adds
 * no new workspace lookup of its own; workspace isolation is inherited
 * from the caller already having resolved `listing` via a
 * workspace-scoped productId/connectionId pair (see actionTools.ts).
 */
export async function reconcileStuckListing(
  listing: { id: string },
  marketplace: 'ebay' | 'etsy',
  sku: string,
  ebayAdapter: EbayOfferLookup | null,
  ebayMarketplaceId: string | undefined
): Promise<ReconciliationOutcome> {
  const claimed = await claimForReconciliation(listing.id);
  if (!claimed) {
    return reportConcurrentOutcome(listing.id);
  }

  let lookup: { status: 'found'; listingId: string } | { status: 'not_found' } | { status: 'unable_to_verify'; reason: string };

  if (marketplace === 'etsy') {
    lookup = { status: 'unable_to_verify', reason: ETSY_RECONCILIATION_UNAVAILABLE_REASON };
  } else if (!ebayAdapter || !ebayMarketplaceId) {
    lookup = { status: 'unable_to_verify', reason: 'Missing eBay adapter or target marketplaceId for reconciliation.' };
  } else {
    try {
      lookup = await ebayAdapter.findPublishedOfferBySku(sku, ebayMarketplaceId);
    } catch {
      // Defensive backstop — findPublishedOfferBySku already catches its
      // own errors internally, but a reconciliation must NEVER let an
      // unexpected throw here be mistaken for "not found".
      lookup = { status: 'unable_to_verify', reason: 'eBay reconciliation check failed unexpectedly.' };
    }
  }

  if (lookup.status === 'found') {
    const updated = await prisma.listing.update({
      where: { id: listing.id },
      data: { syncStatus: 'synced', externalId: lookup.listingId, syncError: null },
    });
    return { outcome: 'synced', listing: toReconciledListing(updated) };
  }

  if (lookup.status === 'not_found') {
    const updated = await prisma.listing.update({
      where: { id: listing.id },
      data: {
        syncStatus: 'failed',
        syncError: 'A previous publish attempt could not be confirmed on the marketplace. Safe to retry.',
      },
    });
    return { outcome: 'not_found_retryable', listing: toReconciledListing(updated) };
  }

  // unable_to_verify — release the claim, change nothing about the
  // Listing's conclusion. Never converted into 'not_found'.
  await releaseClaim(listing.id);
  return { outcome: 'unable_to_verify', reason: lookup.reason };
}

export default reconcileStuckListing;
