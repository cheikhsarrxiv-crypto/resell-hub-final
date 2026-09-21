/**
 * EtsySourcingProvider — Phase 2 of the Global Sourcing Engine, ADKSY's
 * first NEW international sourcing provider since eBay.
 *
 * WHY ETSY, SPECIFICALLY (see the Phase 2 audit — this session verified
 * the following before writing a single line of request code, since this
 * project forbids inventing API access):
 *
 * - ADKSY already holds a real, working Etsy credential: ETSY_CLIENT_ID
 *   (the Etsy "keystring", see .env.example and EtsyAdapter.ts, already
 *   used today for the seller OAuth connection flow).
 * - Etsy Open API v3 publishes a genuinely public, marketplace-wide
 *   search endpoint — GET /v3/application/listings/active — which,
 *   unlike every other endpoint EtsyAdapter.ts calls, requires ONLY the
 *   `x-api-key` header (the same keystring), NOT a per-seller OAuth
 *   Bearer token. This is the exact same shape of access as eBay's own
 *   Buy Browse API being separate from eBay's seller Sell API: a real,
 *   read-only, application-level credential, never a connected seller's
 *   own token, never workspace-specific.
 * - Confirmed via Etsy's own published OpenAPI-generated client
 *   documentation (developer.etsy.com/developers.etsy.com were both
 *   unreachable from this environment's network egress — the same
 *   limitation already documented in EbayBrowseSourcingProvider.ts —
 *   verified instead via a cached/indexed mirror of Etsy's own generated
 *   API reference, https://github.com/gordonturner/etsy-open-api-client,
 *   whose docs are machine-generated directly from Etsy's official
 *   OpenAPI spec, not third-party guesswork): endpoint path, parameter
 *   names, "API key authorization" (no OAuth) requirement, and the
 *   ShopListing/Money response shapes below are all taken from there.
 *
 * REUSES ETSY_CLIENT_ID ON PURPOSE (unlike eBay's deliberately SEPARATE
 * EBAY_BUY_API_CLIENT_ID/SECRET): eBay issues genuinely different
 * credential types for different OAuth grants (client_credentials vs
 * authorization_code), so keeping them apart avoids one grant's fix
 * affecting the other. Etsy has no such distinction — one registered
 * Etsy app has exactly one keystring, used identically as `x-api-key` for
 * both this public endpoint and every OAuth-gated one in EtsyAdapter.ts
 * (see that file's own callEtsyApi). Introducing a second, separately-
 * named env var for the exact same credential would not add any real
 * isolation — it would just be an invented distinction Etsy's own
 * architecture doesn't have.
 *
 * DELIBERATELY MINIMAL SCOPE — documented gaps, not silent ones:
 * - NO price filtering (`min_price`/`max_price`): Etsy's own docs were
 *   not reachable to confirm whether these parameters are currency-aware
 *   like eBay's confirmed `priceCurrency` filter, or whether they compare
 *   a raw number against each listing's own (varying) currency. Rather
 *   than risk silently wrong results for a cross-currency query, this
 *   provider does not forward price bounds to Etsy at all — every
 *   result's real, honest `normalizedPriceEur` (computed by
 *   SourcingService for every provider) is still the right way to filter
 *   for price after the fact. NOT declared as a capability.
 * - NO condition filtering: Etsy has no "new/used" concept comparable to
 *   eBay's (it is fundamentally a handmade/vintage/craft marketplace) —
 *   `query.condition` is ignored, never mapped to whoMade/whenMade/
 *   isSupply, which mean something different and would misrepresent the
 *   query.
 * - NO images: the confirmed ShopListing schema does not include images
 *   inline, and this session could not confirm the search endpoint
 *   supports an `includes=images` expansion (only shop-scoped listing
 *   endpoints were confirmed to). Rather than add an unverified second
 *   request per result, `images` stays `[]` — a real, honest "not
 *   fetched", exactly like EbayBrowseSourcingProvider's own undefined
 *   `brand` field.
 * - NO seller info: would require a separate `/shops/{shop_id}` call per
 *   result — same reasoning as images, left undefined.
 * - NO shippingCost: Etsy's ShopListing only carries a
 *   `shipping_profile_id` reference, not a resolved cost — resolving one
 *   needs a separate shipping-profile lookup this session did not verify.
 *   Left undefined, never defaulted to 0 or guessed.
 * - NO itemLocationCountry: not a field on ShopListing search results
 *   (Etsy's `shop_location` is a QUERY filter on the seller's declared
 *   location, not a response field on the returned listing itself).
 * - `worldwide` is a no-op here: Etsy has no eBay-style per-country
 *   marketplace split — GET /v3/application/listings/active already
 *   searches the whole Etsy marketplace in one call, so there is no
 *   narrower default to expand from. `supportedMarkets` is therefore
 *   empty (there is no per-market vocabulary), and 'worldwide_search' is
 *   NOT declared as a capability — not because Etsy can't search broadly,
 *   but because nothing about this provider's behavior actually changes
 *   based on that flag (the capability describes a real behavioral
 *   difference, not an already-maximal default).
 *
 * Etsy provides NO sandbox (confirmed already in EtsyAdapter.ts) — every
 * call this provider makes hits the real, production Etsy API.
 */

import { createLogger } from '@/lib/logger';
import {
  NormalizedSearchQuery,
  NormalizedSourcingResult,
  SourcingProvider,
  SourcingProviderCapability,
  SourcingProviderErrorInfo,
  SourcingProviderSearchOutcome,
} from '../types';

const logger = createLogger('sourcing-etsy-browse');

const SEARCH_ENDPOINT = 'https://api.etsy.com/v3/application/listings/active';
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50; // Etsy's own documented maximum for this endpoint's `limit` param.

/**
 * Confirmed real (Money model, see this file's own header): the actual
 * decimal price is amount/divisor, e.g. amount=1999, divisor=100 -> 19.99.
 * Never assumed to be cents (divisor is not always 100 for every
 * currency) — always divided, never hardcoded.
 */
function extractValidPrice(item: any): { amount: number; currency: string } | null {
  const amount = item?.price?.amount;
  const divisor = item?.price?.divisor;
  const currency = item?.price?.currency_code;

  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  if (typeof divisor !== 'number' || !Number.isFinite(divisor) || divisor <= 0) return null;
  if (typeof currency !== 'string' || currency.trim().length === 0) return null;

  return { amount: amount / divisor, currency };
}

function classifyFetchError(error: unknown): SourcingProviderErrorInfo {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return { provider: 'etsy', message: 'Request to Etsy timed out', kind: 'timeout' };
  }
  return { provider: 'etsy', message: 'Etsy search request failed', kind: 'unknown' };
}

/**
 * Same default reasoning as EbayBrowseSourcingProvider's own
 * determineAuthenticity: a normal listing with a real title is the
 * seller's own claim about what they're selling (real information, never
 * independently checked) -> 'claimed'. Etsy has NO institutional
 * authenticity program comparable to eBay's Authenticity Guarantee, so
 * 'verified' is never returned by this provider. 'unverified' is reserved
 * for the defensive edge case of a listing with no usable title at all.
 */
function determineAuthenticity(item: any): { status: NormalizedSourcingResult['authenticityStatus']; source?: string } {
  if (typeof item.title === 'string' && item.title.trim().length > 0) {
    return {
      status: 'claimed',
      source: 'Seller listing on Etsy — Etsy provides no institutional authenticity verification; not independently checked by Etsy or ADKSY',
    };
  }
  return { status: 'unverified' };
}

function normalizeItem(item: any): NormalizedSourcingResult | null {
  const validPrice = extractValidPrice(item);
  if (!validPrice) {
    // No exploitable price -> excluded entirely, never represented with a
    // fabricated 0/currency, same rule as EbayBrowseSourcingProvider.
    return null;
  }
  if (typeof item.listing_id !== 'number' && typeof item.listing_id !== 'string') return null;
  if (typeof item.url !== 'string' || item.url.trim().length === 0) return null;
  if (typeof item.title !== 'string') return null;

  const authenticity = determineAuthenticity(item);

  return {
    source: 'etsy',
    sourceId: String(item.listing_id),
    sourceUrl: item.url,
    title: item.title,
    // NOT populated: Etsy's ShopListing has no first-class "brand" field
    // (it is a handmade/vintage marketplace, not a branded-goods catalog)
    // — see this file's own header comment.
    brand: undefined,
    price: validPrice.amount,
    currency: validPrice.currency,
    // A constant, not a per-item field: Etsy has one unified marketplace
    // (see this file's header on `worldwide`) — this names what was
    // searched, exactly like EbayBrowseSourcingProvider's own
    // `marketplace` parameter names the eBay site that was queried.
    marketplace: 'ETSY',
    condition: undefined,
    availability: undefined,
    images: [],
    seller: undefined,
    authenticityStatus: authenticity.status,
    authenticitySource: authenticity.source,
    shippingCost: undefined,
    shippingCostCurrency: undefined,
    itemLocationCountry: undefined,
  };
}

export class EtsySourcingProvider implements SourcingProvider {
  readonly name = 'etsy';
  readonly displayName = 'Etsy';
  // No per-market vocabulary — see this file's own header on `worldwide`.
  readonly supportedMarkets: readonly string[] = [];
  // Deliberately NOT declared: a listing's currency varies by seller, no
  // fixed provider-wide set (same reasoning as eBay's own
  // supportedCurrencies).
  readonly capabilities: readonly SourcingProviderCapability[] = ['keyword_search'];

  isConfigured(): boolean {
    return Boolean(process.env.ETSY_CLIENT_ID);
  }

  async searchProducts(query: NormalizedSearchQuery): Promise<SourcingProviderSearchOutcome> {
    const clientId = process.env.ETSY_CLIENT_ID;
    if (!clientId) {
      return {
        results: [],
        error: { provider: 'etsy', message: 'ETSY_CLIENT_ID is not configured', kind: 'auth' },
      };
    }

    try {
      // query.category is deliberately folded into free-text keywords,
      // never sent as Etsy's own `taxonomy_id` — Etsy's taxonomy IDs are a
      // completely different numeric space from eBay's category_ids, and
      // this session has no confirmed mapping from a free-text or
      // eBay-shaped category value to a real Etsy taxonomy_id. Guessing
      // one could silently misfilter into the wrong category.
      const keywords = [query.query, query.brand, query.category].filter(Boolean).join(' ');

      const params = new URLSearchParams({
        keywords,
        limit: String(Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)),
        offset: String(query.offset ?? 0),
      });

      const response = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, {
        headers: { 'x-api-key': clientId },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const kind = response.status === 401 || response.status === 403 ? 'auth' : response.status === 429 ? 'rate_limit' : 'upstream_error';
        return {
          results: [],
          error: {
            provider: 'etsy',
            message: body.error || `Etsy search failed with status ${response.status}`,
            kind,
          },
        };
      }

      const data = await response.json();
      const items: any[] = Array.isArray(data.results) ? data.results : [];

      const results = items
        .map((item) => normalizeItem(item))
        .filter((result): result is NormalizedSourcingResult => result !== null);

      return { results };
    } catch (error) {
      logger.error('Etsy sourcing search failed', error instanceof Error ? error : String(error));
      return { results: [], error: classifyFetchError(error) };
    }
  }

  async getProductDetails(_sourceUrl: string): Promise<NormalizedSourcingResult | null> {
    // Honestly not implemented yet — same as EbayBrowseSourcingProvider's
    // own getProductDetails, never a fabricated item.
    return null;
  }
}

export default EtsySourcingProvider;
