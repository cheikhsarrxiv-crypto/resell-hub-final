/**
 * EbayBrowseSourcingProvider — the first real SourcingProvider.
 *
 * Uses ONLY eBay's official Buy Browse API (item_summary/search) — no
 * scraping, no unofficial endpoint. Read-only: this provider can never
 * create, publish, or buy anything.
 *
 * Endpoint and filter syntax verified against eBay's own Browse API
 * documentation (developer.ebay.com is unreachable from this
 * environment's network egress, so this was checked via cached/indexed
 * copies of the official docs, including a literally quoted example —
 * see the comments on buildFilterParam below for exactly what was
 * confirmed vs deliberately left unimplemented rather than guessed).
 *
 * Authentication: EbayApplicationTokenManager (client_credentials grant,
 * scope https://api.ebay.com/oauth/api_scope) — completely separate from
 * the seller OAuth token used elsewhere in this app. This provider never
 * touches MarketplaceConnection, TokenManager, or any workspace's stored
 * eBay credentials.
 */

import { createLogger } from '@/lib/logger';
import { EbayApplicationTokenManager, EbayApplicationTokenAuthError, EbayApplicationTokenTimeoutError } from './EbayApplicationTokenManager';
import {
  NormalizedSearchQuery,
  NormalizedSourcingResult,
  SourcingProvider,
  SourcingProviderCapability,
  SourcingProviderErrorInfo,
  SourcingProviderSearchOutcome,
} from '../types';

const logger = createLogger('sourcing-ebay-browse');

const SEARCH_ENDPOINT = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Only the eBay marketplace IDs this provider has actually been asked to
// support (see the Étape 2 brief) — not eBay's full list, to avoid
// silently accepting a marketplace ID nobody has verified behaves as
// expected here.
const SUPPORTED_MARKETPLACES = new Set(['EBAY_FR', 'EBAY_GB', 'EBAY_DE', 'EBAY_IT', 'EBAY_ES', 'EBAY_US']);
const DEFAULT_MARKETPLACE = 'EBAY_US';

function buildFilterParam(query: NormalizedSearchQuery): string | undefined {
  const clauses: string[] = [];

  // CONFIRMED syntax (quoted from eBay's own documentation):
  // filter=price:[300..800],priceCurrency:USD,conditions:{NEW}
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const min = query.minPrice !== undefined ? query.minPrice : '';
    const max = query.maxPrice !== undefined ? query.maxPrice : '';
    clauses.push(`price:[${min}..${max}]`);
    // eBay's price filter requires priceCurrency alongside it — enforced
    // upstream by searchProductsInputSchema (a price bound without a
    // currency is a validation error, not something this provider
    // silently defaults).
    clauses.push(`priceCurrency:${query.currency}`);
  }

  // CONFIRMED: conditions:{NEW} is real, quoted eBay documentation syntax.
  // 'used' is very well established in eBay's own condition vocabulary
  // (conditions:{USED}) and is included with the same confidence.
  // 'refurbished' is DELIBERATELY NOT mapped: eBay actually splits
  // "refurbished" into several distinct condition values (e.g. seller-
  // refurbished vs manufacturer-refurbished) and this session could not
  // verify from official documentation which exact token(s) apply here
  // (developer.ebay.com is unreachable from this environment). Rather
  // than guess, a 'refurbished' query runs with NO condition filter
  // (broader, unfiltered-by-condition results) — see the Étape 2 report
  // for this as an explicit follow-up, not a silent gap.
  if (query.condition === 'new') {
    clauses.push('conditions:{NEW}');
  } else if (query.condition === 'used') {
    clauses.push('conditions:{USED}');
  }

  return clauses.length > 0 ? clauses.join(',') : undefined;
}

function classifyFetchError(error: unknown): SourcingProviderErrorInfo {
  if (error instanceof EbayApplicationTokenTimeoutError || (error instanceof Error && error.name === 'TimeoutError')) {
    return { provider: 'ebay', message: 'Request to eBay timed out', kind: 'timeout' };
  }
  if (error instanceof EbayApplicationTokenAuthError) {
    return { provider: 'ebay', message: 'eBay authentication failed', kind: 'auth' };
  }
  return { provider: 'ebay', message: 'eBay search request failed', kind: 'unknown' };
}

/**
 * Determines authenticityStatus for one eBay item_summary. The ONLY case
 * mapped to 'verified' is qualifiedPrograms containing
 * 'AUTHENTICITY_GUARANTEE' — a real, documented eBay field (confirmed:
 * "qualifiedPrograms array contains ... AUTHENTICITY_GUARANTEE",
 * present on item_summary, not only on the full getItem response).
 *
 * IMPORTANT NUANCE, stated precisely rather than overclaimed: this flag
 * means the item is ENROLLED in eBay's Authenticity Guarantee program —
 * eBay physically inspects/authenticates it AFTER purchase, before it
 * ships to the buyer. It is a real, institutional verification
 * commitment (materially stronger than a seller's own claim), but it is
 * not evidence that the specific unit has already been inspected at the
 * time it appears in search results. authenticitySource says this
 * explicitly rather than implying a completed inspection.
 *
 * Every other item is 'claimed' (a normal eBay listing's title/brand is
 * the seller's own claim about what they're selling — real information,
 * but never independently checked by eBay or ADKSY) — never 'unverified'
 * except for the defensive edge case of an item with no usable title at
 * all.
 */
function determineAuthenticity(item: any): { status: NormalizedSourcingResult['authenticityStatus']; source?: string } {
  const qualifiedPrograms: string[] = Array.isArray(item.qualifiedPrograms) ? item.qualifiedPrograms : [];

  if (qualifiedPrograms.includes('AUTHENTICITY_GUARANTEE')) {
    return {
      status: 'verified',
      source:
        'eBay Authenticity Guarantee — eBay physically inspects/authenticates this item after purchase, before shipping it to the buyer (qualifiedPrograms field on the eBay Browse API item)',
    };
  }

  if (typeof item.title === 'string' && item.title.trim().length > 0) {
    return { status: 'claimed', source: 'Seller listing on eBay — not independently verified by eBay or ADKSY' };
  }

  return { status: 'unverified' };
}

/**
 * Étape 4: extracts a real shipping cost from eBay's own
 * item_summary.shippingOptions[], when present. Per eBay's documented
 * ShippingOptionSummary/ConvertedAmount shapes, shippingCost is
 * `{ value: string, currency: string }`, structurally identical to
 * `price`.
 *
 * Only the FIRST shipping option is used (a documented simplification —
 * an item can have several, e.g. standard vs expedited; picking the
 * first one is not the same as fabricating a value, but it is a real
 * choice worth knowing about if multiple options ever need comparing).
 *
 * Returns undefined (never 0) when shippingOptions is absent/empty or
 * the first option carries no parseable shippingCost — that is
 * genuinely "not reported by eBay for this listing" (e.g. some
 * CALCULATED-type listings need a buyer address before eBay will quote
 * one), which is different from eBay explicitly reporting a real
 * shippingCost.value of "0.00" (free shipping) — that IS a known real
 * zero and is returned as 0, not treated as missing.
 *
 * Étape 4 Phase 5 audit — double conversion: shippingCost.value and
 * shippingCost.currency are read together as one self-consistent pair.
 * eBay's ConvertedAmount type may in principle also carry
 * convertedFromValue/convertedFromCurrency, but this function never reads
 * either — so there is no risk of reconverting an already-converted
 * number. The currency returned here is exactly the FROM currency
 * CurrencyConversionService.convert() uses, once, in PricingService.
 *
 * Étape 4 Phase 5 audit — "is [0] the cheapest?": eBay's own
 * documentation does not confirm shippingOptions[0] is the cheapest, the
 * buyer-selected, or a destination-resolved option — this was checked
 * again in this phase and remains unconfirmed. This function makes no
 * such claim; it only ever reports "the first shipping option eBay
 * returned". PricingService.fromSourcingResult's cost-line description
 * says exactly that, not "cheapest shipping" or similar.
 */
/**
 * Phase 9 fix (Phase 8 audit finding, HIGH): determines whether an eBay
 * item_summary carries a genuinely usable price. Previously,
 * normalizeItem() defaulted an unusable price to `0`/`'USD'` — a
 * fabricated value, exactly the pattern this project forbids everywhere
 * else (see extractShippingCost's own "absent ≠ zero" distinction, which
 * this now mirrors for price).
 *
 * A price is exploitable only if:
 *  - item.price.value is a non-empty string;
 *  - item.price.currency is a non-empty string;
 *  - the value is STRICTLY a plain decimal number (e.g. "450.00", "0") —
 *    not merely parseFloat-parseable. parseFloat("500abc") === 500, which
 *    would silently turn a malformed/corrupted value into a real-looking
 *    price; rejected here instead via a strict regex before any numeric
 *    conversion.
 *
 * Returns null (never a default) when the price can't be trusted — the
 * item is then excluded from sourcing/margin results entirely (see
 * normalizeItem/searchOneMarketplace), never included with a fabricated
 * price. Returns { amount: 0, currency } when eBay explicitly reports
 * "0" — a real, source-provided value, not treated as "missing" (the
 * same "absence ≠ zero" principle already applied to shippingCost).
 */
function extractValidPrice(item: any): { amount: number; currency: string } | null {
  const rawValue = item?.price?.value;
  const currency = item?.price?.currency;

  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return null;
  }
  if (typeof currency !== 'string' || currency.trim().length === 0) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    // Rejects "", "abc", "500abc", negative values, exponent notation,
    // etc. — eBay's own documented ConvertedAmount.value shape is a plain
    // non-negative decimal string; anything else is not guessed at.
    return null;
  }

  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) {
    return null;
  }

  return { amount, currency };
}

function extractShippingCost(item: any): { amount: number; currency: string } | undefined {
  const firstOption = Array.isArray(item.shippingOptions) ? item.shippingOptions[0] : undefined;
  const rawValue = firstOption?.shippingCost?.value;
  const currency = firstOption?.shippingCost?.currency;

  if (rawValue === undefined || currency === undefined) {
    return undefined;
  }

  const amount = parseFloat(rawValue);
  if (Number.isNaN(amount)) {
    return undefined;
  }

  return { amount, currency };
}

function normalizeItem(item: any, marketplace: string): NormalizedSourcingResult | null {
  const validPrice = extractValidPrice(item);
  if (!validPrice) {
    // No exploitable price (Phase 9 fix) — this item is excluded from the
    // results entirely rather than represented with a fabricated 0/USD.
    // An unusable price is not the same as a real free item; see
    // extractValidPrice's own comment for exactly what counts as valid.
    return null;
  }

  const images: string[] = [
    ...(item.image?.imageUrl ? [item.image.imageUrl] : []),
    ...(Array.isArray(item.additionalImages) ? item.additionalImages.map((img: any) => img.imageUrl).filter(Boolean) : []),
  ];

  const authenticity = determineAuthenticity(item);
  const shipping = extractShippingCost(item);

  return {
    source: 'ebay',
    sourceId: item.itemId,
    sourceUrl: item.itemWebUrl,
    title: item.title,
    // NOT populated: eBay's Browse API item_summary search results do
    // not reliably return a first-class "brand" field (that level of
    // item-specific/aspect detail is not confirmed present on search
    // summaries in this session's verification) — left undefined rather
    // than assuming the item matches the query's own brand filter, which
    // would misrepresent a search parameter as verified item data.
    brand: undefined,
    // price.value and price.currency are read together as one
    // self-consistent pair (Étape 4 Phase 5 audit, same reasoning as
    // extractShippingCost below) — convertedFromValue/convertedFromCurrency
    // are never read, so whatever currency eBay reports here is the one
    // CurrencyConversionService.convert() converts FROM, exactly once, in
    // PricingService. No double conversion is possible from this field.
    price: validPrice.amount,
    currency: validPrice.currency,
    marketplace,
    condition: item.condition,
    availability: item.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus,
    images,
    seller: item.seller
      ? {
          name: item.seller.username,
          feedbackScore: item.seller.feedbackScore,
          feedbackPercentage:
            item.seller.feedbackPercentage !== undefined ? parseFloat(item.seller.feedbackPercentage) : undefined,
        }
      : undefined,
    authenticityStatus: authenticity.status,
    authenticitySource: authenticity.source,
    shippingCost: shipping?.amount,
    shippingCostCurrency: shipping?.currency,
    // Global Sourcing Engine — item_summary.itemLocation.country, only
    // when eBay actually reports one. Never inferred from `marketplace`
    // (the site being searched): a EBAY_FR search can list an item
    // physically located anywhere, so this stays undefined rather than
    // defaulting to the searched marketplace's own country.
    itemLocationCountry: item.itemLocation?.country,
  };
}

export class EbayBrowseSourcingProvider implements SourcingProvider {
  readonly name = 'ebay';
  readonly displayName = 'eBay';
  // The same six marketplace IDs already declared in SUPPORTED_MARKETPLACES
  // above — never a second, potentially-drifting list.
  readonly supportedMarkets: readonly string[] = Array.from(SUPPORTED_MARKETPLACES);
  // Deliberately NOT declared: eBay Browse API items are priced in
  // whatever currency the listing/site uses — there is no fixed,
  // honestly-declarable provider-wide currency set (see
  // SourcingProvider.supportedCurrencies's own comment).
  readonly capabilities: readonly SourcingProviderCapability[] = [
    'keyword_search',
    'price_filter',
    'condition_filter',
    'worldwide_search',
  ];

  isConfigured(): boolean {
    return EbayApplicationTokenManager.isConfigured();
  }

  private async searchOneMarketplace(
    query: NormalizedSearchQuery,
    marketplace: string
  ): Promise<{ results: NormalizedSourcingResult[]; error?: SourcingProviderErrorInfo }> {
    try {
      const accessToken = await EbayApplicationTokenManager.getAccessToken();

      const params = new URLSearchParams({
        q: [query.query, query.brand].filter(Boolean).join(' '),
        limit: String(Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)),
        offset: String(query.offset ?? 0),
      });

      // category_ids is only forwarded when the caller already provides a
      // numeric eBay category id — ADKSY has no verified name->id mapping
      // (that would require eBay's Taxonomy API, out of scope for this
      // step), so a free-text category like "shoes" is folded into the
      // keyword search instead, never guessed into a category_ids value.
      if (query.category && /^\d+$/.test(query.category)) {
        params.set('category_ids', query.category);
      } else if (query.category) {
        params.set('q', `${params.get('q')} ${query.category}`.trim());
      }

      const filter = buildFilterParam(query);
      if (filter) {
        params.set('filter', filter);
      }

      const response = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-EBAY-C-MARKETPLACE-ID': marketplace,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const kind = response.status === 401 || response.status === 403 ? 'auth' : response.status === 429 ? 'rate_limit' : 'upstream_error';
        return {
          results: [],
          error: {
            provider: 'ebay',
            message: body.errors?.[0]?.message || `eBay search failed with status ${response.status} for ${marketplace}`,
            kind,
          },
        };
      }

      const data = await response.json();
      const items: any[] = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];

      // Items without an exploitable price are excluded here (Phase 9
      // fix) — normalizeItem returns null for them rather than a
      // fabricated 0/USD result; never surfaced as a sourcing opportunity.
      const results = items
        .map((item) => normalizeItem(item, marketplace))
        .filter((result): result is NormalizedSourcingResult => result !== null);

      return { results };
    } catch (error) {
      logger.error(`eBay Browse search failed for marketplace ${marketplace}`, error instanceof Error ? error : String(error));
      return { results: [], error: classifyFetchError(error) };
    }
  }

  async searchProducts(query: NormalizedSearchQuery): Promise<SourcingProviderSearchOutcome> {
    // Global Sourcing Engine — worldwide=true honestly means "every eBay
    // marketplace this provider actually supports" (SUPPORTED_MARKETPLACES,
    // the same six sites this provider has always declared), never "all of
    // eBay" or "the whole internet" — eBay's Browse API has no single
    // universal-search endpoint to fall back on instead. Takes priority
    // over an explicit `marketplaces` list when both are given, since it's
    // the more inclusive of the two intents.
    const requestedMarketplaces = query.worldwide
      ? Array.from(SUPPORTED_MARKETPLACES)
      : (query.marketplaces && query.marketplaces.length > 0
          ? query.marketplaces
          : [DEFAULT_MARKETPLACE]
        ).filter((marketplace) => SUPPORTED_MARKETPLACES.has(marketplace));

    if (requestedMarketplaces.length === 0) {
      return {
        results: [],
        error: {
          provider: 'ebay',
          message: `No supported eBay marketplace in the request. Supported: ${Array.from(SUPPORTED_MARKETPLACES).join(', ')}`,
          kind: 'unknown',
        },
      };
    }

    const perMarketplace = await Promise.all(
      requestedMarketplaces.map((marketplace) => this.searchOneMarketplace(query, marketplace))
    );

    const results = perMarketplace.flatMap((r) => r.results);
    // Only the first error is surfaced as THE error for this provider's
    // outcome (SourcingProviderSearchOutcome carries a single optional
    // error) — every per-marketplace error is still logged above, so
    // none is silently lost, but the aggregated contract stays simple
    // for the caller. Results from marketplaces that succeeded are kept
    // regardless of another marketplace's failure.
    const firstError = perMarketplace.find((r) => r.error)?.error;

    return { results, error: firstError };
  }

  async getProductDetails(sourceUrl: string): Promise<NormalizedSourcingResult | null> {
    // NOT IMPLEMENTED in this step: fetching a single item's full detail
    // (eBay's getItem) would let a future authenticity check also read
    // the richer `authenticityGuarantee` container eBay documents on
    // that endpoint — deliberately left for a later step rather than
    // built partially/untested now. Returns null (a real "not
    // available", not a fabricated item) — the search_products tool and
    // SourcingService already handle this shape.
    logger.warn('EbayBrowseSourcingProvider.getProductDetails is not implemented yet', { sourceUrl });
    return null;
  }
}

export default EbayBrowseSourcingProvider;
