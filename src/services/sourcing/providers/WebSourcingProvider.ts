/**
 * WebSourcingProvider — Global Web Sourcing.
 *
 * A SourcingProvider that searches the general Web (via
 * WebSearchProviderRegistry -> Tavily today) rather than one specific
 * marketplace's own official API. This is the provider that lets
 * search_products go beyond eBay/Etsy: a general web search can surface
 * pages hosted on Vinted, Vestiaire Collective, Depop, Grailed, or any
 * other site a search engine indexes — but this is fundamentally
 * different from having an official API for those sites (ADKSY still has
 * none — see SourcingProviderRegistry.getKnownUnavailableSources, which
 * remains accurate and unchanged by this provider). A web search finds
 * SOME pages that happen to be indexed; it is never a complete or
 * authoritative listing of any one site's inventory, and this provider
 * must never be described or treated as if it were.
 *
 * Two-step pipeline, both documented and bounded:
 *   1. Ask the configured web search engine(s) for up to
 *      TAVILY_MAX_RAW_RESULTS raw hits (title/url/content/score/domain —
 *      see websourcing/types.ts's WebSearchResult; never itself a
 *      structured product).
 *   2. Select the top MAX_CANDIDATES_FOR_EXTRACTION hits by the engine's
 *      own relevance score, and run WebResultExtractionService (one LLM
 *      call per candidate, in parallel) ONLY on those — never on every
 *      raw hit. This is the deliberate cost/latency bound this task's
 *      brief asked for: a search can return many raw hits, but only a
 *      small, fixed number of them are ever actually analyzed by the
 *      extraction model.
 *
 * A candidate is converted into a NormalizedSourcingResult ONLY when
 * extraction reports isProductOffer: true AND a real numeric price AND a
 * real currency — NormalizedSourcingResult.price/currency are REQUIRED,
 * non-optional fields (see ../types.ts), so a candidate with no
 * confidently extracted price is dropped rather than forced into that
 * shape with an invented number. This is a deliberate, documented
 * consequence of "never invent a price", not an oversight: a real product
 * page whose price could not be confidently read is simply not
 * exploitable as a sourcing opportunity yet.
 *
 * Currency conversion, landed cost, margin preview, and the generic
 * "this is a web result" warning are ALL handled by the existing,
 * shared SourcingService/OpportunityRankingService pipeline — never
 * duplicated here (see OpportunityRankingService.annotateResult's own
 * `result.source === 'web'` branch for the warning).
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
import { WebSearchProviderRegistry } from '@/services/websourcing/WebSearchProviderRegistry';
import { WebSearchResult, WebSearchProviderErrorInfo } from '@/services/websourcing/types';
import { WebResultExtractionService, ExtractedWebProductInfo } from '../WebResultExtractionService';

const logger = createLogger('sourcing-web');

/** How many raw hits are requested from the web search engine per search — a ceiling on the candidate pool, not on how many get analyzed (see MAX_CANDIDATES_FOR_EXTRACTION below, which is the real cost bound). */
export const TAVILY_MAX_RAW_RESULTS = 10;

/**
 * Hard cap on how many of those raw hits ever get a real LLM extraction
 * call — the deliberate cost/latency bound this task's brief asked for
 * ("Ne fais PAS un appel LLM illimité"). Candidates are pre-selected by
 * the search engine's OWN relevance score (descending) before this limit
 * is applied, so the results that ARE analyzed are the ones the engine
 * itself ranked highest, not an arbitrary prefix.
 */
export const MAX_CANDIDATES_FOR_EXTRACTION = 5;

/**
 * A small, honest, curated map from a known marketplace's own domain to
 * its real display name — used ONLY to make `marketplace` friendlier when
 * the domain is one ADKSY already knows about. Any other domain falls
 * back to the literal domain itself (see deriveMarketplace below) —
 * never a guessed/invented site name.
 */
const KNOWN_DOMAIN_MARKETPLACE_NAMES: Record<string, string> = {
  'vinted.fr': 'vinted', 'vinted.com': 'vinted', 'vinted.co.uk': 'vinted', 'vinted.de': 'vinted',
  'ebay.com': 'ebay', 'ebay.co.uk': 'ebay', 'ebay.fr': 'ebay', 'ebay.de': 'ebay',
  'etsy.com': 'etsy',
  'depop.com': 'depop',
  'grailed.com': 'grailed',
  'vestiairecollective.com': 'vestiaire_collective',
  'therealreal.com': 'the_realreal',
  'stockx.com': 'stockx',
};

/** Mechanical lookup/fallback only — never a guess. See KNOWN_DOMAIN_MARKETPLACE_NAMES's own comment. */
function deriveMarketplace(domain: string | undefined): string {
  if (!domain) return 'web';
  const bare = domain.replace(/^www\./, '');
  return KNOWN_DOMAIN_MARKETPLACE_NAMES[bare] ?? bare;
}

/**
 * Folds the query's own structured fields into free-text keywords, the
 * exact same treatment brand/model/size/color already get for EVERY
 * provider in this codebase (see NormalizedSearchQuery's own comments) —
 * a general web search engine has no structured filter API at all, so
 * this is the ONLY way any of these constraints can reach it. A price
 * bound is folded in as a plain text hint ("under 300 EUR") to help the
 * engine's own relevance ranking surface pages that mention that range —
 * the REAL price filtering/exclusion still happens downstream, in
 * SourcingService's shared pipeline, exactly like it already does for
 * Etsy (which also has no native price filter).
 *
 * Location/region intent (e.g. "in France", "in Europe") is NEVER added
 * here independently — there is no separate geo field on
 * NormalizedSearchQuery for this, by design (see this task's own audit).
 * If the reseller named a region, the model is expected to have already
 * folded it into `query.query` itself, the same free-text field every
 * other constraint with no structured equivalent goes through. This
 * function never invents or infers a location that was not already part
 * of the caller-supplied query text.
 */
function buildWebSearchQueryText(query: NormalizedSearchQuery): string {
  const parts = [query.query, query.brand, query.model, query.size, query.color, query.category].filter(
    (part): part is string => Boolean(part && part.trim().length > 0)
  );

  if (query.maxPrice !== undefined) {
    parts.push(`under ${query.maxPrice} ${query.currency ?? ''}`.trim());
  }
  if (query.minPrice !== undefined) {
    parts.push(`over ${query.minPrice} ${query.currency ?? ''}`.trim());
  }

  return parts.join(' ');
}

function toSourcingErrorInfo(error: WebSearchProviderErrorInfo): SourcingProviderErrorInfo {
  return {
    provider: 'web',
    message: error.message,
    // WebSearchProviderErrorInfo has one kind ('invalid_response') that
    // SourcingProviderErrorInfo's own vocabulary doesn't — mapped to the
    // closest real category rather than adding a new one just for this
    // provider (see SourcingProviderErrorInfo's own fixed kind union).
    kind: error.kind === 'invalid_response' ? 'upstream_error' : error.kind,
  };
}

/**
 * Picks the top `MAX_CANDIDATES_FOR_EXTRACTION` raw hits by the engine's
 * own relevance score, descending. A hit with no reported score sorts
 * after every hit that has one — a SELECTION heuristic only, for THIS
 * function's own purpose of picking which candidates are worth an LLM
 * call; it is never displayed, stored, or claimed as a real score of 0
 * (see WebSearchResult.score's own comment on why an absent score must
 * never be treated as "scored as irrelevant").
 */
function selectCandidates(results: WebSearchResult[]): WebSearchResult[] {
  const sorted = [...results].sort((a, b) => {
    if (a.score === undefined && b.score === undefined) return 0;
    if (a.score === undefined) return 1;
    if (b.score === undefined) return -1;
    return b.score - a.score;
  });
  return sorted.slice(0, MAX_CANDIDATES_FOR_EXTRACTION);
}

/**
 * Converts one raw web hit + its extraction outcome into a
 * NormalizedSourcingResult, or null when it isn't (yet) a real,
 * exploitable sourcing opportunity:
 *   - extraction failed outright (network/model/schema error), or
 *   - the model reported isProductOffer: false (an article, guide, forum
 *     post, category page, ... never a concrete offer), or
 *   - no confident numeric price, or no confident currency, was found.
 * The last rule is what keeps this provider from ever inventing a price:
 * NormalizedSourcingResult.price/currency are required fields, so a
 * candidate without both simply cannot become one — it is dropped, not
 * forced into the shape with a fabricated number.
 */
function toNormalizedResult(raw: WebSearchResult, extracted: ExtractedWebProductInfo): NormalizedSourcingResult | null {
  if (!extracted.isProductOffer) return null;
  if (extracted.price === null || extracted.currency === null) return null;

  return {
    source: 'web',
    sourceId: raw.id,
    sourceUrl: raw.url,
    title: extracted.title ?? raw.title, // raw.title is itself real, provider-reported data — never invented — used only when extraction didn't separately confirm one.
    brand: extracted.brand ?? undefined,
    price: extracted.price,
    currency: extracted.currency.toUpperCase(),
    marketplace: deriveMarketplace(raw.domain),
    condition: extracted.condition ?? undefined,
    images: [], // Tavily's WebSearchResult carries no image field today — never fabricated.
    seller: extracted.seller ? { name: extracted.seller } : undefined,
    // Never 'verified': no institutional authenticity program exists for
    // a generic web result — only ever the page's own claim, or nothing.
    authenticityStatus: extracted.authenticityClaim ? 'claimed' : 'unverified',
    authenticitySource: extracted.authenticityClaim ?? undefined,
    shippingCost: extracted.shippingCost ?? undefined,
    shippingCostCurrency: extracted.shippingCost !== null ? extracted.currency.toUpperCase() : undefined,
    // Free text as extracted (e.g. "Paris, France"), NOT the ISO 3166-1
    // alpha-2 code EbayBrowseSourcingProvider reports here — a general
    // web page never states a clean country code, and this field has no
    // runtime format enforcement (see NormalizedSourcingResult's own
    // comment); SourcingResultCard only ever displays it as plain text,
    // never parses it as a code, so this stays honest rather than
    // guessing/normalizing into a code that wasn't really there.
    itemLocationCountry: extracted.location ?? undefined,
  };
}

export class WebSourcingProvider implements SourcingProvider {
  readonly name = 'web';
  readonly displayName = 'General Web Search';
  // No fixed provider-specific market vocabulary — a general web search
  // is not scoped to a declared list of sites the way eBay's marketplace
  // IDs are (see SourcingProvider.supportedMarkets's own comment).
  readonly supportedMarkets: readonly string[] = [];
  // Deliberately NOT declared: 'price_filter'/'condition_filter' would
  // claim this provider itself applies a structured filter, which it
  // never does (a price bound is only folded into free text, see
  // buildWebSearchQueryText — the REAL filtering happens downstream in
  // SourcingService, same as for Etsy). 'worldwide_search' is also not
  // declared: unlike eBay (where `worldwide` genuinely switches which
  // marketplaces are queried), this provider is already unscoped by
  // construction regardless of that flag — declaring it would claim a
  // behavioral difference that doesn't exist (see
  // SourcingProviderCapability's own rule: never declared unless
  // searchProducts genuinely does something with it).
  readonly capabilities: readonly SourcingProviderCapability[] = ['keyword_search'];

  isConfigured(): boolean {
    return WebSearchProviderRegistry.getConfiguredProviders().length > 0;
  }

  async searchProducts(query: NormalizedSearchQuery): Promise<SourcingProviderSearchOutcome> {
    const engines = WebSearchProviderRegistry.getConfiguredProviders();

    // Defensive: SourcingService already filters by isConfigured() before
    // ever calling this, so this should not be reachable with zero
    // engines — but never throws or fabricates a result if it somehow is.
    if (engines.length === 0) {
      return { results: [] };
    }

    const queryText = buildWebSearchQueryText(query);
    const errors: SourcingProviderErrorInfo[] = [];
    const rawResults: WebSearchResult[] = [];

    await Promise.all(
      engines.map(async (engine) => {
        try {
          const outcome = await engine.search({ query: queryText, maxResults: TAVILY_MAX_RAW_RESULTS });
          rawResults.push(...outcome.results);
          if (outcome.error) {
            errors.push(toSourcingErrorInfo(outcome.error));
          }
        } catch (error) {
          // A web search engine is expected to catch its own errors (see
          // TavilyWebSearchProvider) — this is a defensive backstop
          // against a provider bug, not the normal path.
          logger.error(
            `Web search engine "${engine.name}" threw instead of returning a structured error`,
            error instanceof Error ? error : String(error)
          );
          errors.push({ provider: 'web', message: `${engine.displayName} search failed unexpectedly`, kind: 'unknown' });
        }
      })
    );

    // No raw hits at all (every engine returned zero, or every engine
    // failed) — a clean, honest empty result, never a fabricated one.
    if (rawResults.length === 0) {
      return { results: [], error: errors[0] };
    }

    const candidates = selectCandidates(rawResults);
    const extractions = await WebResultExtractionService.extractBatch(candidates);

    const results: NormalizedSourcingResult[] = [];
    for (const { result: raw, outcome } of extractions) {
      if (outcome.status === 'error') {
        // One failed extraction never fails the whole search — logged,
        // and simply not turned into a result (never a fabricated one).
        logger.warn('Skipped one web candidate: extraction failed', { url: raw.url, reason: outcome.reason });
        continue;
      }
      const normalized = toNormalizedResult(raw, outcome.data);
      if (normalized) results.push(normalized);
    }

    return { results, error: errors[0] };
  }

  async getProductDetails(_sourceUrl: string): Promise<NormalizedSourcingResult | null> {
    // Honestly not implemented yet — same as EbayBrowseSourcingProvider's
    // and EtsySourcingProvider's own getProductDetails, never a
    // fabricated item.
    return null;
  }
}

export default WebSourcingProvider;
