/**
 * The Etsy equivalent of ebayPublishGuard.ts — the single choke point
 * deciding whether publish_etsy_listing's handler may ever proceed past
 * building the real Etsy payload and attempt an actual authenticated
 * call. Defaults to disabled: a real Etsy call requires this to be the
 * exact string 'true', set explicitly — never inferred, never defaulted
 * to "on".
 *
 * Deliberately a SEPARATE flag from ENABLE_REAL_EBAY_PUBLISH — enabling
 * real eBay publishing must never accidentally enable real Etsy
 * publishing, or vice versa.
 *
 * Note (see EtsyAdapter.ts's own header comment): Etsy has no sandbox API
 * at all — any real call this guard allows goes straight to Etsy's real
 * production API. This makes the flag even more load-bearing for Etsy
 * than for eBay (which at least has a genuine Sandbox to fall back on).
 * In this session's environment it is never set, and no code path here
 * ever sets it either.
 */
export function isRealEtsyPublishEnabled(): boolean {
  return process.env.ENABLE_REAL_ETSY_PUBLISH === 'true';
}

/**
 * For display only — never used to decide whether a call is allowed (see
 * isRealEtsyPublishEnabled). Always 'production': Etsy provides no
 * sandbox environment, so unlike describeEbayEnvironment there is no
 * sandbox/production distinction to make here.
 */
export function describeEtsyEnvironment(): 'production' {
  return 'production';
}
