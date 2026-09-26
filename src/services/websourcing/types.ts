/**
 * Global Web Sourcing — Phase 2 PoC.
 *
 * Deliberately separate from src/services/sourcing/types.ts
 * (NormalizedSourcingResult, SourcingProvider, ...): that type already
 * carries a specific contract (authenticityStatus, estimatedKnownCostEur,
 * matchReasons, ...) built and audited around real marketplace listing
 * data (eBay Browse API, Etsy Open API v3). A raw web search result is a
 * different, weaker kind of evidence — a page a search engine found, not
 * a structured marketplace offer — and must never be silently upgraded
 * to look like one. This file's types are intentionally raw and minimal;
 * turning a WebSearchResult into a NormalizedSourcingResult (product,
 * price, condition, margin, authenticity, ...) is explicitly out of scope
 * for this phase and will be a separate, later step (extraction +
 * normalization), never done implicitly here.
 */

/** What the caller passes in — free-text only, no structured filters. A provider receives exactly this text; nothing here interprets or rewrites it. */
export interface WebSearchQuery {
  query: string;
  /** Max results requested. Providers may return fewer; never more than what they actually found. */
  maxResults?: number;
}

/**
 * One raw search hit, exactly as reported by the provider — never
 * enriched, never inferred, never merged with anything else.
 *
 * - `title`/`url`/`content`: as returned by the provider. `content` is a
 *   snippet/excerpt the provider itself extracted — not the full page,
 *   and not independently verified by ADKSY.
 * - `score`: the provider's own relevance score, in whatever scale it
 *   uses (Tavily: an unbounded relevance score, not a probability or a
 *   percentage) — never re-scaled or reinterpreted here. Optional: some
 *   real responses omit it; absent here means exactly that, never 0 (0
 *   would falsely claim "the provider scored this as irrelevant").
 * - `publishedDate`: the provider's own reported value, passed through
 *   unchanged when present and non-empty. Tavily commonly returns an
 *   empty string when it has no real publish date for a page — that is
 *   normalized to `undefined` here (an empty string is not a date and
 *   must never be displayed or parsed as one), which is the one, narrow
 *   exception to "never invent/alter a provider field": treating ""
 *   as "no date" is a factual, lossless simplification (nothing about
 *   the empty string carried information to begin with), not a guess.
 * - `domain`: NOT a provider field — mechanically derived from `url` via
 *   the URL parser's own `hostname`, nothing more. Kept as an explicitly
 *   separate, clearly-commented field so a caller can never confuse it
 *   with something the source itself reported (contrast with `title`/
 *   `content`/`score`/`publishedDate`, which are all provider-reported).
 *   Undefined only if `url` itself could not be parsed as a URL at all.
 * - `id`: the provider's own internal identifier for this hit, if any —
 *   for later deduplication, never used as a display field.
 */
export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
  domain?: string;
  id?: string;
}

export interface WebSearchProviderErrorInfo {
  provider: string;
  message: string;
  /** Mirrors SourcingProviderErrorInfo's own kind vocabulary (src/services/sourcing/types.ts) so the two systems stay easy to reconcile later. */
  kind: 'timeout' | 'auth' | 'rate_limit' | 'upstream_error' | 'invalid_response' | 'unknown';
}

export interface WebSearchOutcome {
  results: WebSearchResult[];
  error?: WebSearchProviderErrorInfo;
}

/**
 * Every web search provider implements this. Deliberately minimal for
 * Phase 2 — no capabilities/supportedMarkets declarative metadata yet
 * (unlike sourcing/types.ts's SourcingProvider), since there is exactly
 * one provider and no real second one to generalize against yet. Adding
 * that metadata later, if/when a second provider exists, is additive.
 */
export interface WebSearchProvider {
  readonly name: string;
  readonly displayName: string;
  isConfigured(): boolean;
  search(query: WebSearchQuery): Promise<WebSearchOutcome>;
}
