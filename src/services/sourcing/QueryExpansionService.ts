/**
 * Global Sourcing Engine — Query Expansion.
 *
 * Deliberately a pure, unwired structural stub. Nothing in this codebase
 * calls this service yet — SourcingService.search() and search_products
 * pass NormalizedSearchQuery.query straight through to each provider,
 * exactly as before this task. The task's own spec permits exactly this
 * ("pas d'implémentation automatique de traduction") when no safe minimal
 * implementation exists: real query expansion (translating "Nike" to
 * "ナイキ", or expanding brand synonyms) requires either a real
 * translation provider or a verified brand-name transliteration source —
 * this repo holds no credential for any translation API (checked: no
 * DeepL/Google Translate/Azure Translator env var exists anywhere in this
 * codebase), and a hand-maintained brand->script dictionary would itself
 * be a fabricated data source with no authoritative backing. Neither is
 * available today, so every expand() call stays a no-op.
 *
 * Phase 2 — the interface is now PROVIDER- and MARKET-aware (a real
 * translation should differ, e.g., by whether it is destined for a
 * Japanese-market provider vs a French one), so a real implementation can
 * be substituted later without SourcingService or any tool changing
 * shape again. This is purely a signature change — no provider currently
 * passes anything meaningful for `context`, and NoopQueryExpansionService
 * ignores it entirely.
 */
export interface QueryExpansionContext {
  /** SourcingProvider.name this expansion is being prepared for, e.g. 'ebay' — omitted means "provider-agnostic". */
  provider?: string;
  /** A provider-specific market/site identifier (the same vocabulary NormalizedSearchQuery.marketplaces uses for that provider), e.g. 'EBAY_FR' — omitted means "no specific market". */
  market?: string;
  /** BCP 47 locale the expansion should target, e.g. 'ja' or 'ja-JP' — omitted means "unspecified". */
  locale?: string;
}

export interface QueryExpansionResult {
  original: string;
  /** Always empty for NoopQueryExpansionService — see class comment. */
  variants: string[];
}

export interface QueryExpansionService {
  expand(query: string, context?: QueryExpansionContext): Promise<QueryExpansionResult>;
}

/**
 * The only implementation today. Returns the original query unchanged,
 * with no variants, regardless of `context` — never a guessed translation
 * or synonym, for any provider/market/locale.
 */
export class NoopQueryExpansionService implements QueryExpansionService {
  async expand(query: string, _context?: QueryExpansionContext): Promise<QueryExpansionResult> {
    return { original: query, variants: [] };
  }
}

export default NoopQueryExpansionService;
