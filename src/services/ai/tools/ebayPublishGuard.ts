/**
 * Phase 12C-Offline — the single choke point deciding whether
 * publish_listing's handler may ever proceed past building the real eBay
 * payload and attempt an actual authenticated call. Defaults to disabled:
 * a real eBay call requires this to be the exact string 'true', set
 * explicitly — never inferred, never defaulted to "on" ("aucune valeur
 * par défaut dangereuse ne doit sélectionner Production", per the
 * Phase 12C-Offline brief).
 *
 * Deliberately separate from EBAY_SANDBOX_MODE, which only decides WHICH
 * eBay host a real call would hit (sandbox vs production) — this flag
 * decides WHETHER a real call happens AT ALL. In this session's
 * environment it is never set, and no code path here ever sets it either
 * — see the Phase 12C-Offline report's own "zero real eBay call"
 * confirmation.
 */
export function isRealEbayPublishEnabled(): boolean {
  return process.env.ENABLE_REAL_EBAY_PUBLISH === 'true';
}

/** For display only — never used to decide whether a call is allowed (see isRealEbayPublishEnabled). Mirrors ListingService.getMarketplaceConfig's own sandbox-by-default logic. */
export function describeEbayEnvironment(): 'sandbox' | 'production' {
  return process.env.EBAY_SANDBOX_MODE !== 'false' ? 'sandbox' : 'production';
}
