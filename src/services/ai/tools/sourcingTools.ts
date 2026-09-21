import { z } from 'zod';
import { SourcingService } from '@/services/sourcing/SourcingService';
import { AgentToolDefinition } from './types';

// Only marketplace IDs EbayBrowseSourcingProvider actually supports today
// (see its SUPPORTED_MARKETPLACES) — kept here too so an invalid value is
// rejected by Zod before the tool ever calls SourcingService, rather than
// silently dropped deeper in the stack.
const SUPPORTED_EBAY_MARKETPLACES = ['EBAY_FR', 'EBAY_GB', 'EBAY_DE', 'EBAY_IT', 'EBAY_ES', 'EBAY_US'] as const;

const searchProductsInputSchema = z
  .object({
    query: z.string().min(1, 'query is required').max(200),
    brand: z.string().max(100).optional(),
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
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .refine((data) => (data.minPrice === undefined && data.maxPrice === undefined) || data.currency !== undefined, {
    message: 'currency is required whenever minPrice or maxPrice is set',
    path: ['currency'],
  });

export const searchProductsTool: AgentToolDefinition<z.infer<typeof searchProductsInputSchema>> = {
  name: 'search_products',
  description:
    'Search for sourcing opportunities across configured external providers (currently: eBay, via its official Browse API — read-only, public listings). ' +
    'Can search multiple eBay marketplaces (countries) at once for price comparison, or set worldwide=true to search every marketplace ADKSY has real, ' +
    'configured access to for that provider — this means "every source ADKSY can currently, legitimately reach", never literally the entire internet; ' +
    'the response\'s providersSearched/providersUnavailable fields say exactly which sources were actually queried. ' +
    "Returns real listings only — never a fabricated result. If no provider is configured, returns status SOURCE_NOT_CONFIGURED. " +
    "Each result's authenticityStatus is 'verified' only when eBay's own Authenticity Guarantee program covers the item; " +
    "otherwise 'claimed' (the seller's own listing, not independently checked), 'unverified' (no usable content), or 'unknown'. Never upgrade this yourself. " +
    "Each result's normalizedPriceEur (when present) is a real currency conversion, not the authoritative price — always prefer the original price/currency; " +
    'normalizedPriceEur is absent whenever no reliable exchange rate was available, never a guessed value. ' +
    'This tool does NOT calculate margin — margin requires a resale price and cost inputs this version does not have.',
  category: 'read',
  inputSchema: searchProductsInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text search keywords, e.g. "Prada sneakers".' },
      brand: { type: 'string', description: 'Optional brand to narrow the search, e.g. "Prada".' },
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
      limit: { type: 'number', description: 'Max results per marketplace (1-50).' },
      offset: { type: 'number', description: 'Pagination offset.' },
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
      totalResults: response.totalResults,
      note: "Prices are in each result's own original currency, not converted; normalizedPriceEur (when present) is a supplementary conversion, not the authoritative price. No margin is calculated — a real margin needs a resale price and cost inputs this tool does not have yet.",
    };
  },
};
