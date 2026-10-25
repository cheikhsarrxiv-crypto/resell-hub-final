/**
 * Single source of truth for which eBay environment the Browse sourcing
 * path (EbayApplicationTokenManager + EbayBrowseSourcingProvider) talks to.
 *
 * Sandbox by default: Production is selected ONLY when EBAY_SANDBOX_MODE
 * is the exact string 'false'. Absent, empty, 'FALSE', '0', or any other
 * value all resolve to Sandbox — the same sandbox-by-default rule already
 * used by the seller flow (EbayAdapter/AdapterFactory) and
 * describeEbayEnvironment() in ebayPublishGuard.ts.
 *
 * Read on every call (never cached at module load) so a process can never
 * keep using a host chosen under a previous configuration.
 *
 * Kept in its own module (rather than inside EbayApplicationTokenManager)
 * so tests that mock the token manager still exercise the real host
 * selection in EbayBrowseSourcingProvider.
 */

export type EbayEnvironment = 'sandbox' | 'production';

const API_HOSTS: Record<EbayEnvironment, string> = {
  sandbox: 'https://api.sandbox.ebay.com',
  production: 'https://api.ebay.com',
};

export function getEbayEnvironment(): EbayEnvironment {
  return process.env.EBAY_SANDBOX_MODE === 'false' ? 'production' : 'sandbox';
}

export function getEbayApiHost(environment: EbayEnvironment): string {
  return API_HOSTS[environment];
}
