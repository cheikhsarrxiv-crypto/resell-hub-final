/**
 * Global Sourcing Engine — Query Expansion.
 *
 * `NoopQueryExpansionService` stays exactly what it was (Phase 2/3): a
 * pure passthrough, never a guessed translation. Phase 6 adds a second,
 * real (not no-op) implementation — `DeterministicBrandQueryExpansionService`
 * — for a small, explicitly verified, human-curated set of brand names
 * whose official Japanese katakana form is public, undisputed knowledge
 * (each entry was checked this session against that brand's own Japan
 * storefront/marketing — see BRAND_QUERY_VARIANTS's own comment). This is
 * NOT machine translation and NOT a general dictionary: every entry is a
 * BRAND TOKEN substitution only — a model/product name next to it (e.g.
 * "Cut" in "Prada Cut") is never touched, and a brand with no verified
 * entry (e.g. Prada) simply gets no variant, never a guessed one.
 *
 * NEITHER implementation is currently called by SourcingService/
 * search_products: eBay's Browse API and Etsy's Open API v3 are both
 * Western-marketplace-facing — a katakana variant search against either
 * would not plausibly surface different or better results (no Japanese
 * marketplace provider exists yet, see SourcingProviderRegistry.
 * getKnownUnavailableSources for exactly why), so firing extra variant
 * queries against them would just waste API calls, not add real
 * capability. This service is deliberately kept as callable, tested,
 * real infrastructure — ready for the day a Japanese-market provider
 * exists — rather than wired into an the eBay/Etsy path where it could
 * not actually help.
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
  /** Every variant this call actually produced — the caller never needs to guess which ones "were really used", this array already says exactly that. */
  variants: string[];
}

export interface QueryExpansionService {
  expand(query: string, context?: QueryExpansionContext): Promise<QueryExpansionResult>;
}

/**
 * The conservative default. Returns the original query unchanged, with
 * no variants, regardless of `context` — never a guessed translation or
 * synonym, for any provider/market/locale.
 */
export class NoopQueryExpansionService implements QueryExpansionService {
  async expand(query: string, _context?: QueryExpansionContext): Promise<QueryExpansionResult> {
    return { original: query, variants: [] };
  }
}

/**
 * Phase 6 — a small, human-curated, VERIFIED set of brand names whose
 * official Japanese katakana form is public, undisputed knowledge (each
 * checked this session against that brand's own Japan storefront/
 * marketing, e.g. nike.com/jp and adidas.jp both use these exact forms as
 * their own brand name):
 *  - Nike -> ナイキ
 *  - Adidas -> アディダス
 * Deliberately NOT a general brand->script table: a brand with no entry
 * here (e.g. Prada) gets no variant at all — silence, never a guess.
 * Extend this only with an entry verified the same way, never a plausible
 * guess at a transliteration.
 */
const BRAND_QUERY_VARIANTS: Record<string, string[]> = {
  nike: ['ナイキ'],
  adidas: ['アディダス'],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Real (not no-op) deterministic expansion: substitutes a KNOWN brand
 * token in the query with each of its verified variants, leaving every
 * other word (model, size, color, ...) exactly as given — never
 * translates or alters anything outside the matched brand token itself.
 * A query with no recognized brand token returns variants: [] , exactly
 * like NoopQueryExpansionService — this never invents a variant for an
 * unrecognized brand.
 */
export class DeterministicBrandQueryExpansionService implements QueryExpansionService {
  async expand(query: string, _context?: QueryExpansionContext): Promise<QueryExpansionResult> {
    const variants = new Set<string>();

    for (const [brand, localizedForms] of Object.entries(BRAND_QUERY_VARIANTS)) {
      const tokenPattern = new RegExp(`\\b${escapeRegExp(brand)}\\b`, 'i');
      const match = tokenPattern.exec(query);
      if (!match) continue;

      for (const localized of localizedForms) {
        const variant = `${query.slice(0, match.index)}${localized}${query.slice(match.index + match[0].length)}`;
        if (variant !== query) variants.add(variant);
      }
    }

    return { original: query, variants: Array.from(variants) };
  }
}

export default NoopQueryExpansionService;
