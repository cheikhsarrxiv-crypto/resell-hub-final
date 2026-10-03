/**
 * Deep Web Sourcing Engine — multi-pass query planning for
 * WebSourcingProvider (mission sections 2, 3, 4, 18).
 *
 * GENERAL mechanism, never hardcoded to one product: every query variant
 * is built ONLY from NormalizedSearchQuery's own structured fields
 * (brand/model/category/condition/maxPrice/currency) plus a small, fixed,
 * documented list of generic English intent keywords ("used", "outlet",
 * ...) — never a product-name-specific template. The mission brief's own
 * example queries ("Nike Air Max second hand 50 EUR", "Nike Air Max
 * outlet", ...) are illustrative; nothing here is keyed off "Nike" or
 * "Air Max" specifically.
 *
 * Compressed from the brief's 7 conceptual passes down to 4 REAL ones
 * (exact / secondhand / outlet / recovery) to stay inside a small, fixed
 * cost budget (mission section 18) — "synonyms/variants" (brief's PASS 2)
 * and "localized search" (PASS 6) are deliberately not separate passes
 * here: a synonym/translation pass would require guessing a word this
 * service has no verified source for (the one real, verified exception,
 * QueryExpansionService's brand-katakana substitution, is not relevant to
 * this provider's own target markets — see that file's own header), and
 * are documented as an explicit limitation in the final report rather
 * than implemented with a guess.
 *
 * FAST vs DEEP (section 3): only the 'exact' pass ever runs by default.
 * Every other pass requires NormalizedSearchQuery.deepSearch === true,
 * decided by the Agent — this module never infers that from free text.
 */
import { NormalizedSearchQuery } from './types';

export type SearchPassName = 'exact' | 'secondhand' | 'outlet' | 'recovery';

export interface PlannedQuery {
  pass: SearchPassName;
  queryText: string;
  /** 'advanced' only for the recovery pass (last resort, broader net justifies the extra cost) — every other pass stays 'basic'. */
  searchDepth: 'basic' | 'advanced';
}

/** Hard ceiling on how many Tavily search calls one search_products invocation may ever make for the "web" provider — see WebSourcingProvider's own budget wiring. */
export const MAX_WEB_SEARCH_PASSES = 4;

/**
 * If the 'exact' pass alone already returns at least this many valid
 * (priced) offers, no further pass runs even when deepSearch is true —
 * "stop early once enough high-quality results are found" (section 4's
 * own closing instruction), never spending extra queries once the search
 * is already well-served.
 */
export const SUFFICIENT_VALID_OFFERS_TO_STOP_EARLY = 5;

/**
 * A single, small, documented, generic vocabulary — never a per-product
 * guess, never machine-translated. Each list is deliberately short: this
 * is a cost-bounded hint folded into free text for a web search engine's
 * OWN relevance ranking, not a semantic expansion a model performs.
 */
const SECONDHAND_KEYWORDS = 'used second hand pre-owned';
const OUTLET_KEYWORDS = 'outlet clearance discounted resale';
const RECOVERY_KEYWORDS = 'for sale buy';

/**
 * Folds the query's own structured fields into free-text keywords — the
 * SAME treatment brand/model/size/color/category already get for every
 * provider in this codebase (see NormalizedSearchQuery's own comments).
 * Moved here from WebSourcingProvider.ts (Deep Web Sourcing Engine) so
 * every pass's query text is built in exactly one place; WebSourcingProvider
 * itself no longer constructs query text directly.
 */
export function buildBaseQueryText(query: NormalizedSearchQuery): string {
  const parts = [query.query, query.brand, query.model, query.size, query.color, query.category].filter(
    (part): part is string => Boolean(part && part.trim().length > 0)
  );

  if (query.maxPrice !== undefined) {
    parts.push(`under ${query.maxPrice} ${query.currency ?? ''}`.trim());
  }
  if (query.minPrice !== undefined) {
    parts.push(`over ${query.minPrice} ${query.currency ?? ''}`.trim());
  }
  if (query.condition === 'used') {
    parts.push('used');
  }

  return parts.join(' ');
}

/**
 * Deep Web Sourcing Engine fix (mission section 6) — appends `keywords`
 * to `base`, but never repeats a whole word `base` already contains
 * (case-insensitive). Fixes the observed "Nike Air Max under 50 EUR used
 * used second hand pre-owned" noise: buildBaseQueryText already appends
 * "used" for condition: 'used', and the secondhand pass's own keyword
 * list also starts with "used" — this collapses the duplicate instead of
 * sending a visibly broken query to the search engine. Purely textual
 * deduplication, never drops a keyword that isn't genuinely already
 * present.
 */
function appendKeywords(base: string, keywords: string): string {
  const existingWords = new Set(base.toLowerCase().split(/\s+/).filter(Boolean));
  const newWords = keywords.split(/\s+/).filter((word) => word && !existingWords.has(word.toLowerCase()));
  return [base, ...newWords].join(' ').trim();
}

/**
 * Builds the ordered list of passes WebSourcingProvider should ATTEMPT,
 * in order — the caller (WebSourcingProvider) decides, after each pass's
 * real results come back, whether to actually run the next one (early
 * stop / recovery-only-on-zero), this function only prepares the
 * candidate query texts and never executes anything itself.
 *
 * - `deepSearch` false/omitted: returns exactly one entry ('exact') —
 *   byte-identical query text to this provider's pre-Deep-Web-Sourcing
 *   behavior, so a caller that never sets deepSearch sees no change at
 *   all.
 * - `deepSearch` true: returns up to MAX_WEB_SEARCH_PASSES entries
 *   (exact, secondhand, outlet, recovery) — still capped, never
 *   unbounded.
 */
export function buildPasses(query: NormalizedSearchQuery, deepSearch: boolean): PlannedQuery[] {
  const base = buildBaseQueryText(query);
  const passes: PlannedQuery[] = [{ pass: 'exact', queryText: base, searchDepth: 'basic' }];

  if (!deepSearch) {
    return passes;
  }

  passes.push({ pass: 'secondhand', queryText: appendKeywords(base, SECONDHAND_KEYWORDS), searchDepth: 'basic' });
  passes.push({ pass: 'outlet', queryText: appendKeywords(base, OUTLET_KEYWORDS), searchDepth: 'basic' });
  passes.push({ pass: 'recovery', queryText: appendKeywords(base, RECOVERY_KEYWORDS), searchDepth: 'advanced' });

  return passes.slice(0, MAX_WEB_SEARCH_PASSES);
}

export const WebSearchQueryPlanner = {
  buildBaseQueryText,
  buildPasses,
  MAX_WEB_SEARCH_PASSES,
  SUFFICIENT_VALID_OFFERS_TO_STOP_EARLY,
};

export default WebSearchQueryPlanner;
