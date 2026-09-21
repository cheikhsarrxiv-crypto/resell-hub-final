import { z } from 'zod';
import { SourcingService } from '@/services/sourcing/SourcingService';
import { AgentToolDefinition } from './types';

// Only marketplace IDs EbayBrowseSourcingProvider actually supports today
// (see its SUPPORTED_MARKETPLACES) — kept here too so an invalid value is
// rejected by Zod before the tool ever calls SourcingService, rather than
// silently dropped deeper in the stack.
const SUPPORTED_EBAY_MARKETPLACES = ['EBAY_FR', 'EBAY_GB', 'EBAY_DE', 'EBAY_IT', 'EBAY_ES', 'EBAY_US'] as const;

// Every SourcingProvider.name SourcingProviderRegistry currently knows
// about (real or not-yet-configured) — kept in sync with
// SourcingProviderRegistry.getAllProviders() manually, same pattern as
// SUPPORTED_EBAY_MARKETPLACES above, so an invalid provider name is
// rejected by Zod before ever reaching SourcingService.
const SUPPORTED_PROVIDER_NAMES = ['ebay', 'etsy'] as const;

const searchProductsInputSchema = z
  .object({
    query: z.string().min(1, 'query is required').max(200),
    brand: z.string().max(100).optional(),
    // Phase 3 — free text, folded into the keyword search by every
    // provider (like brand/category) — no provider has a confirmed
    // structured filter for any of these.
    model: z.string().max(100).optional(),
    size: z.string().max(50).optional(),
    color: z.string().max(50).optional(),
    // Free text OR a numeric eBay category id — see
    // EbayBrowseSourcingProvider for exactly how each is handled.
    category: z.string().max(100).optional(),
    minPrice: z.number().min(0).optional(),
    maxPrice: z.number().min(0).optional(),
    currency: z.string().length(3).optional(),
    condition: z.enum(['new', 'used', 'refurbished']).optional(),
    marketplaces: z.array(z.enum(SUPPORTED_EBAY_MARKETPLACES)).min(1).max(6).optional(),
    // Global Sourcing Engine — "search everywhere ADKSY currently has
    // real access to", never "search the entire internet". Passed
    // through unchanged to SourcingService/each provider; see
    // NormalizedSearchQuery.worldwide's own comment for exactly what
    // this does and does not promise. When set, a provider MAY ignore
    // `marketplaces` in favor of its own full supported set.
    worldwide: z.boolean().optional(),
    // Phase 2 — restricts the search to specific sourcing providers, e.g.
    // ["ebay"] to skip Etsy for this one search. Omitted (the default)
    // means every configured provider is queried, unchanged from before
    // this field existed.
    providers: z.array(z.enum(SUPPORTED_PROVIDER_NAMES)).min(1).max(SUPPORTED_PROVIDER_NAMES.length).optional(),
    // Phase 3 — deterministic final ordering of the combined result set;
    // see NormalizedSearchQuery.sort's own comment for exactly what each
    // option means. Omitted = 'normalized_price_asc' (unchanged default).
    sort: z.enum(['price_asc', 'price_desc', 'normalized_price_asc', 'known_cost_asc', 'match']).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
    // Phase 3 — ONLY when set, a margin preview (estimatedMargin/
    // estimatedMarginPercent) is attached to results whose landed cost is
    // computable. Never invented: omitted means no margin preview at all.
    targetResalePrice: z.number().min(0).optional(),
  })
  .refine((data) => (data.minPrice === undefined && data.maxPrice === undefined) || data.currency !== undefined, {
    message: 'currency is required whenever minPrice or maxPrice is set',
    path: ['currency'],
  });

export const searchProductsTool: AgentToolDefinition<z.infer<typeof searchProductsInputSchema>> = {
  name: 'search_products',
  description:
    'Search for sourcing opportunities across configured external providers (currently: eBay via its official Browse API, and Etsy via its official Open API v3 ' +
    'public marketplace-wide listings search — both read-only, public listings). ' +
    'Can search multiple eBay marketplaces (countries) at once for price comparison, or set worldwide=true to search every marketplace ADKSY has real, ' +
    'configured access to for that provider — this means "every source ADKSY can currently, legitimately reach", never literally the entire internet; ' +
    'the response\'s providersSearched/providersUnavailable/providersSkipped fields say exactly which sources were actually queried, unavailable, or excluded. ' +
    'Use `providers` (e.g. ["ebay"]) to restrict the search to specific providers instead of all configured ones. ' +
    "Returns real listings only — never a fabricated result. If no provider is configured, returns status SOURCE_NOT_CONFIGURED. " +
    "Each result's authenticityStatus is 'verified' only when a provider's own institutional program covers the item (currently only eBay's Authenticity Guarantee — Etsy has no such program, so Etsy results are never 'verified'); " +
    "otherwise 'claimed' (the seller's own listing, not independently checked), 'unverified' (no usable content), or 'unknown'. Never upgrade this yourself. " +
    "Each result's normalizedPriceEur (when present) is a real currency conversion, not the authoritative price — always prefer the original price/currency; " +
    'normalizedPriceEur is absent whenever no reliable exchange rate was available, never a guessed value. Combined multi-provider results are sorted by ' +
    'normalizedPriceEur ascending (results with no available rate are listed last), so this doubles as the price comparison the query implies. ' +
    "estimatedKnownCostEur (when present) sums every cost ADKSY actually knows a real amount for (price + shipping + known fees) — it is undefined whenever ANY " +
    "relevant cost (e.g. shipping) was never reported at all, not just when a conversion failed; see each result's own unknownCostFactors/warnings for exactly why. " +
    'Never present it to the user as a complete all-in total when warnings mention missing cost data. ' +
    'A requested minPrice/maxPrice is honored for EVERY provider, even one with no native price filter (e.g. Etsy) — results are filtered against the real, ' +
    'currency-converted price after the fact; a result whose price comparison could not be confidently resolved is NEVER silently dropped, it is kept with a warning instead. ' +
    "Each result's matchReasons/warnings are real, computed explanations (never generic marketing text) — matchReasons says exactly why it fits the request " +
    "(e.g. price within range, requested brand found), warnings names real caveats (e.g. authenticity only seller-claimed, landed cost incomplete). " +
    "Use `sort` to control ordering: 'match' orders by real constraint matches first, then known landed cost, then authenticity evidence, then price — never an opaque score. " +
    'Set `targetResalePrice` to get a margin PREVIEW (estimatedMargin/estimatedMarginPercent) on results whose landed cost is known — this never includes a future ' +
    'marketplace selling fee (none has been chosen yet) and is never computed without an explicit targetResalePrice; never invent one on the reseller\'s behalf. ' +
    'providerLatencyMs reports real per-provider search time, for transparency only — never used to rank results.',
  category: 'read',
  inputSchema: searchProductsInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text search keywords, e.g. "Prada sneakers".' },
      brand: { type: 'string', description: 'Optional brand to narrow the search, e.g. "Prada".' },
      model: { type: 'string', description: 'Optional model/line, e.g. "Cut" (as in "Prada Cut"). Folded into the keyword search, not a structured filter.' },
      size: { type: 'string', description: 'Optional size, e.g. "42". Folded into the keyword search, not a structured filter.' },
      color: { type: 'string', description: 'Optional color. Folded into the keyword search, not a structured filter.' },
      category: { type: 'string', description: 'Optional category — free text, or a numeric eBay category id if known.' },
      minPrice: { type: 'number', description: 'Minimum price. Requires currency to be set.' },
      maxPrice: { type: 'number', description: 'Maximum price. Requires currency to be set.' },
      currency: { type: 'string', description: 'ISO 4217 currency code, required whenever minPrice/maxPrice is set, e.g. "EUR".' },
      condition: { type: 'string', enum: ['new', 'used', 'refurbished'], description: 'Item condition. Note: "refurbished" is currently not filtered by eBay (broader results returned).' },
      marketplaces: {
        type: 'array',
        items: { type: 'string', enum: SUPPORTED_EBAY_MARKETPLACES as unknown as string[] },
        description: 'Which eBay country marketplaces to search, e.g. ["EBAY_FR", "EBAY_GB"]. Defaults to EBAY_US if omitted. Ignored if worldwide=true.',
      },
      worldwide: {
        type: 'boolean',
        description: 'Search every marketplace ADKSY currently has real access to for each configured provider, instead of just `marketplaces`. Not a promise to search "everywhere" — see the tool description.',
      },
      providers: {
        type: 'array',
        items: { type: 'string', enum: SUPPORTED_PROVIDER_NAMES as unknown as string[] },
        description: 'Restrict the search to these sourcing providers only, e.g. ["ebay"]. Omit to search every configured provider (default).',
      },
      sort: {
        type: 'string',
        enum: ['price_asc', 'price_desc', 'normalized_price_asc', 'known_cost_asc', 'match'],
        description: "Final ordering of the combined result set. Defaults to 'normalized_price_asc'. 'match' orders by real constraint matches, then known landed cost, then authenticity evidence, then price.",
      },
      limit: { type: 'number', description: 'Max combined results returned overall (1-50), balanced fairly across providers when more candidates than this were found.' },
      offset: { type: 'number', description: 'Pagination offset.' },
      targetResalePrice: {
        type: 'number',
        description: 'Optional real resale price the reseller has in mind. When set, results whose landed cost is known get a margin preview (estimatedMargin/estimatedMarginPercent). Never invented — omit to skip margin entirely.',
      },
    },
    required: ['query'],
  },
  async handler(_workspaceId, input) {
    const response = await SourcingService.search(input);

    if (response.status === 'SOURCE_NOT_CONFIGURED') {
      return {
        status: 'SOURCE_NOT_CONFIGURED',
        message: 'No sourcing provider is configured yet — this ADKSY instance cannot search for products right now.',
        results: [],
        providersUnavailable: response.providersUnavailable,
      };
    }

    return {
      status: 'ok',
      results: response.results,
      providerErrors: response.providerErrors,
      // Global Sourcing Engine — real, structured provenance of the
      // search itself, passed through unchanged so the agent never
      // claims to have searched a source it didn't actually query.
      providersSearched: response.providersSearched,
      providersFailed: response.providersFailed,
      providersUnavailable: response.providersUnavailable,
      providersSkipped: response.providersSkipped,
      totalResults: response.totalResults,
      // Phase 3 — observability only, never used to rank/filter results.
      providerLatencyMs: response.providerLatencyMs,
      note: "Prices are in each result's own original currency, not converted; normalizedPriceEur/estimatedKnownCostEur (when present) are supplementary conversions, not the authoritative price. estimatedMargin/estimatedMarginPercent (when present) are a landed-cost-only preview, never including a marketplace selling fee, and only ever computed when targetResalePrice was explicitly given — never invented.",
    };
  },
};
