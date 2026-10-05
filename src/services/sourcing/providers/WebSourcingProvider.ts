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
 * A candidate's extraction reports zero, one, or several distinct OFFERS
 * (Global Web Sourcing, Option A — see WebResultExtractionService's own
 * header for the full rationale: a category/brand/search-results page can
 * legitimately list several items at several prices, never forced into
 * one combined/averaged entry, and never automatically discarded just for
 * listing more than one item). Each offer becomes its own
 * NormalizedSourcingResult ONLY when it has a real numeric price AND a
 * real currency — NormalizedSourcingResult.price/currency are REQUIRED,
 * non-optional fields (see ../types.ts), so an offer with no confidently
 * extracted price is dropped rather than forced into that shape with an
 * invented number. This is a deliberate, documented consequence of
 * "never invent a price", not an oversight: a real offer whose price
 * could not be confidently read is simply not exploitable as a sourcing
 * opportunity yet.
 *
 * Currency conversion, landed cost, margin preview, and the generic
 * "this is a web result" / "this source page lists several offers"
 * warnings are ALL handled by the existing, shared SourcingService/
 * OpportunityRankingService pipeline — never duplicated here (see
 * OpportunityRankingService.annotateResult's own `result.source === 'web'`
 * branch for both warnings).
 */
import crypto from 'crypto';
import { createLogger } from '@/lib/logger';
import {
  NormalizedSearchQuery,
  NormalizedSourcingResult,
  RejectedSample,
  SourcingProvider,
  SourcingProviderCapability,
  SourcingProviderErrorInfo,
  SourcingProviderSearchOutcome,
} from '../types';
import { WebSearchProviderRegistry } from '@/services/websourcing/WebSearchProviderRegistry';
import { WebSearchResult, WebSearchProviderErrorInfo } from '@/services/websourcing/types';
import { WebResultExtractionService, ExtractedWebOffer, ExtractedWebPageOffers } from '../WebResultExtractionService';
import { WebSearchQueryPlanner, PlannedQuery } from '../WebSearchQueryPlanner';

const logger = createLogger('sourcing-web');

/** How many raw hits are requested from the web search engine per search PASS — a ceiling on the candidate pool, not on how many get analyzed (see MAX_CANDIDATES_FOR_EXTRACTION below, which is the real cost bound). */
export const TAVILY_MAX_RAW_RESULTS = 10;

/**
 * Hard cap on how many raw hits from ONE pass ever get a real LLM
 * extraction call — the deliberate cost/latency bound this task's brief
 * asked for ("Ne fais PAS un appel LLM illimité"). Candidates are
 * pre-selected by the search engine's OWN relevance score (descending)
 * before this limit is applied, so the results that ARE analyzed are the
 * ones the engine itself ranked highest, not an arbitrary prefix. Also
 * bounded by MAX_TOTAL_EXTRACTION_CALLS_PER_SEARCH below across ALL
 * passes combined, so deep search can never multiply this per-pass cap
 * unboundedly.
 */
export const MAX_CANDIDATES_FOR_EXTRACTION = 5;

/**
 * Deep Web Sourcing Engine (mission section 18) — hard GLOBAL ceiling on
 * how many extraction LLM calls this provider makes across EVERY pass of
 * ONE searchProducts() invocation, regardless of how many passes
 * WebSearchQueryPlanner planned. Combined with MAX_WEB_SEARCH_PASSES (4),
 * this bounds one search_products tool call (fixed at 3 AI Units
 * regardless) to at most 4 Tavily searches + 11 extraction calls = 15
 * external calls, matching the mission's own "deep search: 8-15 queries
 * maximum" ceiling exactly. The default, non-deepSearch path only ever
 * consumes up to MAX_CANDIDATES_FOR_EXTRACTION (5) of this budget in its
 * one pass — unchanged from before this budget existed.
 */
export const MAX_TOTAL_EXTRACTION_CALLS_PER_SEARCH = 11;

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

// Location/region intent (e.g. "in France", "in Europe") is NEVER added
// independently to any pass's query text — there is no separate geo field
// on NormalizedSearchQuery for this, by design (see this task's own
// audit). If the reseller named a region, the model is expected to have
// already folded it into `query.query` itself. Query text construction
// itself now lives in WebSearchQueryPlanner.buildBaseQueryText (Deep Web
// Sourcing Engine) — moved there so every pass's text is built in exactly
// one place; behavior for the 'exact' pass is unchanged byte-for-byte.

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
 * Multi-offer extraction (Global Web Sourcing, Option A) — a deterministic
 * identifier for ONE offer within ONE page, built ONLY from real,
 * already-extracted fields (source, the page's own sourceUrl, and the
 * offer's own productName/price/currency/size/model) — never
 * `Math.random()`, never a counter, never anything that could differ
 * between two runs for the exact same offer. This is what lets
 * SourcingService.deduplicate() (keyed on `(source, sourceId)` whenever
 * sourceId is set) tell apart several distinct offers that all share the
 * same page's sourceUrl, instead of collapsing them into one. Two
 * genuinely different offers from the same page will, in the ordinary
 * case, differ in at least one of these fields (that's what makes them
 * distinct offers at all) and therefore hash differently; two identical
 * sets of fields are — by construction — not distinguishable from each
 * other by anything this provider actually knows, so they are treated as
 * the same offer, which is the correct, conservative outcome (never a
 * guessed difference).
 */
function buildOfferSourceId(source: string, sourceUrl: string, offer: ExtractedWebOffer): string {
  const key = [
    source,
    sourceUrl,
    offer.productName ?? offer.title ?? '',
    String(offer.price ?? ''),
    offer.currency ?? '',
    offer.size ?? '',
    offer.model ?? '',
  ].join('|');
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Deliberately narrow, curated vocabulary — never a guess about any
// specific listing's facts, only a generic "this text names a component/
// accessory, not the item itself" signal (mission section 4's own
// "Extra Lace Set Only" example). Extend only with another real,
// unambiguous accessory-only phrase, never a product name.
const ACCESSORY_ONLY_PATTERN = /\b(extra\s+)?laces?\s+(only|set)\b|\blace\s+set\b|\binsoles?\s+only\b|\bbox\s+only\b|\bsoles?\s+only\b|\bstrap\s+only\b|\bshoelaces?\s+only\b|\bkeychain\b|\bsticker\b/i;

/**
 * Opportunity Classification fix (demographic filter) — deliberately
 * narrow: whole-word matches only for the spelled-out vocabulary the
 * mission named (toddler/infant/baby/kids/children/boys/girls/preschool/
 * "grade school"), never a substring match that could false-positive on
 * an unrelated word. "GS"/"PS"/"TD" are NOT matched as bare whole words —
 * "PS" alone would false-positive on real, unrelated listings (e.g. a
 * "Nike x PlayStation" collab literally abbreviated "PS", or "PS5"); the
 * real, near-universal sneaker-marketplace convention for these
 * abbreviations is parenthesized ("Nike Dunk Low (GS)"), which is what
 * KIDS_SIZE_SUFFIX_PATTERN requires — a documented, deliberate precision
 * choice over recall (see this engine's own audit report).
 *
 * Web Sourcing smoke-test fix (section 1) — French vocabulary added
 * alongside the existing English one. The provider must not depend
 * entirely on the Agent having already translated a kids/toddler-intent
 * query to English before calling search_products: a reseller's own
 * French query ("Nike Air Force 1 enfant") must be recognized exactly
 * like its English equivalent, both when deciding to EXCLUDE a kids
 * variant from an adult search and when deciding NOT to (an explicit
 * French kids-intent query). Exactly the vocabulary requested, nothing
 * broader — "ado"/"junior" are real, narrow French words for this
 * segment, not generic enough to risk false-positiving on an unrelated
 * listing.
 *
 * Boundary note: plain `\b` treats an accented letter (é, ç, ...) as a
 * NON-word character (JS's `\b` is ASCII-only without a Unicode mode that
 * still supports this) — `\bbébé\b` silently fails to match "Bébé" at a
 * string/punctuation edge, which would have made half this French
 * vocabulary never actually match. WORD_BOUNDARY_BEFORE/AFTER below
 * reimplement the same "word vs non-word" test `\b` does, just extended
 * to include the Latin-1 accented letter range, so every word in this
 * list (English or French) gets the identical, real boundary guarantee.
 */
const WORD_CHARACTER_CLASS = 'a-zA-Z0-9_À-ÖØ-öø-ÿ';
const WORD_BOUNDARY_BEFORE = `(?<![${WORD_CHARACTER_CLASS}])`;
const WORD_BOUNDARY_AFTER = `(?![${WORD_CHARACTER_CLASS}])`;

const KIDS_SEGMENT_WORDS =
  'toddler|infants?|babies|baby|kids?|children|boys?|girls?|preschool|grade\\s*school|enfants?|bébé|bebe|nourrisson|fille|garçon|garcon|junior|ado|adolescente?|jeunesse';
const KIDS_SEGMENT_PATTERN = new RegExp(`${WORD_BOUNDARY_BEFORE}(${KIDS_SEGMENT_WORDS})${WORD_BOUNDARY_AFTER}`, 'i');
const KIDS_SIZE_SUFFIX_PATTERN = /\((?:gs|ps|td)\)/i;

function textNamesKidsSegment(text: string): boolean {
  return KIDS_SEGMENT_PATTERN.test(text) || KIDS_SIZE_SUFFIX_PATTERN.test(text);
}

/**
 * Web Sourcing smoke-test fix (section 1) — a demographic-intent word
 * (e.g. "enfant", "kids") is a SEGMENT signal, never a product-identifying
 * keyword a listing's own title would ever literally repeat ("Nike Air
 * Force 1 (GS)" never spells out "kids"/"enfant"). Stripped out before
 * isProductRelevant's token-overlap check builds its required-token set,
 * so putting such a word directly in `query.query` (a reseller's own free
 * text, e.g. "Nike Air Force 1 pour enfant") never blocks an otherwise
 * matching kids listing on an unrelated, impossible-to-satisfy token.
 * Never strips a real brand/model word — only the fixed, narrow
 * KIDS_SEGMENT_WORDS vocabulary above.
 */
function stripKidsSegmentWords(text: string): string {
  return text.replace(new RegExp(`${WORD_BOUNDARY_BEFORE}(${KIDS_SEGMENT_WORDS})${WORD_BOUNDARY_AFTER}`, 'gi'), ' ');
}

/**
 * True only when the RESELLER'S OWN query already names the kids/toddler/
 * infant segment — in that case the demographic filter never applies at
 * all (an explicit kids search must see kids results). Checked against
 * the same structured fields isProductRelevant itself uses (brand + model
 * + query + category — category included here since a reseller is more
 * likely to name "kids" there than in `query` itself).
 */
export function queryRequestsKidsSegment(query: NormalizedSearchQuery): boolean {
  const queryText = [query.brand, query.model, query.query, query.category].filter(Boolean).join(' ');
  return textNamesKidsSegment(queryText);
}

const RELEVANCE_STOPWORDS = new Set(['the', 'a', 'an', 'and', 'for', 'with', 'of', 'in', 'on']);

/** Lowercases, splits on non-alphanumeric, drops stopwords and single characters — deterministic, no inference. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !RELEVANCE_STOPWORDS.has(token));
}

/**
 * Deep Web Sourcing Engine fix (mission sections 1 & 4) — a DETERMINISTIC
 * check run AFTER LLM extraction, never relying on the model's own
 * judgment of "is this the right product". A general web search for
 * "Nike Air Max" can legitimately surface a page about a Jordan 1, a
 * Nike Dunk, or an accessory-only listing ("Extra Lace Set Only") simply
 * because the page also mentions "Nike" — this function rejects those
 * before they ever become a NormalizedSourcingResult.
 *
 * Rule (deliberately simple and auditable, never a fuzzy/ML match):
 * every significant token from the ORIGINAL structured query
 * (query.brand + query.model + query.query — never the pass's own
 * expanded text, which would already contain unrelated keywords like
 * "used"/"outlet") must appear, verbatim, somewhere in the offer's own
 * title/productName/brand/model. "Nike Air Max" requires "nike", "air"
 * AND "max" all present — "Nike Air Jordan 1" has "nike"/"air" but not
 * "max", so it is rejected without needing a hardcoded "Jordan" blocklist.
 * A query with no usable tokens at all (should not happen — query.query
 * is required/non-empty) never rejects anything on this basis, since
 * there would be nothing real to check against.
 *
 * Separately, an offer whose own text matches ACCESSORY_ONLY_PATTERN is
 * always rejected regardless of token overlap — "Nike Air Max 1/97 Sean
 * Wotherspoon (Extra Lace Set Only)" contains every required token but
 * the item actually sold is a lace set, not the shoe.
 */
export function isProductRelevant(offer: ExtractedWebOffer, query: NormalizedSearchQuery): boolean {
  const offerText = [offer.title, offer.productName, offer.brand, offer.model].filter(Boolean).join(' ');

  if (ACCESSORY_ONLY_PATTERN.test(offerText)) {
    return false;
  }

  // Opportunity Classification fix (demographic filter) — a kids/toddler/
  // infant variant is a genuinely DIFFERENT product than the adult one
  // searched for, even though it shares every brand/model token (a "Nike
  // Air Force 1 (GS)" contains "nike"/"air"/"force"/"1" just like the
  // adult version) — never caught by the token-overlap check below, so
  // checked explicitly here. Skipped entirely when the reseller's OWN
  // query already names this segment.
  if (textNamesKidsSegment(offerText) && !queryRequestsKidsSegment(query)) {
    return false;
  }

  const requiredTokens = tokenize(stripKidsSegmentWords([query.brand, query.model, query.query].filter(Boolean).join(' ')));
  if (requiredTokens.length === 0) {
    return true;
  }

  const offerTokens = new Set(tokenize(offerText));
  return requiredTokens.every((token) => offerTokens.has(token));
}

/**
 * Re-derives WHY isProductRelevant returned false, for a human-readable
 * RejectedSample.reason — never changes isProductRelevant's own boolean
 * contract (kept stable for its existing tests), just explains its
 * verdict after the fact. Returns null when the offer IS relevant (should
 * never be called in that case, but never throws if it is).
 */
function explainIrrelevance(offer: ExtractedWebOffer, query: NormalizedSearchQuery): string | null {
  const offerText = [offer.title, offer.productName, offer.brand, offer.model].filter(Boolean).join(' ');

  if (ACCESSORY_ONLY_PATTERN.test(offerText)) {
    return 'This listing is for an accessory/component only (e.g. laces, box, insoles), not the item itself.';
  }
  if (textNamesKidsSegment(offerText) && !queryRequestsKidsSegment(query)) {
    return 'This listing is for a kids/toddler/infant variant, excluded from an adult-intent search.';
  }
  const requiredTokens = tokenize(stripKidsSegmentWords([query.brand, query.model, query.query].filter(Boolean).join(' ')));
  const offerTokens = new Set(tokenize(offerText));
  const missing = requiredTokens.filter((token) => !offerTokens.has(token));
  if (missing.length > 0) {
    return `This listing's title does not contain the requested term(s): ${missing.join(', ')}.`;
  }
  return null;
}

/**
 * Converts one raw web hit + its (possibly multi-offer) extraction
 * outcome into zero, one, or several NormalizedSourcingResult objects —
 * never forces the whole page into a single, possibly-wrong entry, and
 * never discards a page just for genuinely listing more than one offer
 * (Global Web Sourcing, Option A). An individual offer is dropped,
 * on its own, when:
 *   - no confident numeric price, or no confident currency, was found for
 *     it specifically. This is what keeps this provider from ever
 *     inventing a price: NormalizedSourcingResult.price/currency are
 *     required fields, so an offer without both simply cannot become
 *     one — it is dropped, not forced into the shape with a fabricated
 *     number.
 *   - it fails the deterministic isProductRelevant() check above (Deep
 *     Web Sourcing Engine fix) — a real offer for a DIFFERENT product
 *     than what was searched for, never shown as if it matched.
 * Extraction itself (see WebResultExtractionService's own system prompt)
 * is where "never combine a price from one offer with a size/model from
 * another" and "never invent a correspondence when it's ambiguous which
 * price belongs to which item" are enforced — this function trusts each
 * already-returned offer's OWN fields as a self-contained unit, it never
 * re-pairs or re-derives anything across offers itself.
 */
interface NormalizationOutcome {
  results: NormalizedSourcingResult[];
  /** Opportunity Classification fix — real, counted/sampled rejections from THIS one page, merged by searchProducts across every pass/hit. */
  noConfidentPriceCount: number;
  irrelevantCount: number;
  rejectedSamples: RejectedSample[];
}

function toNormalizedResults(
  raw: WebSearchResult,
  extracted: ExtractedWebPageOffers,
  plannedQuery: PlannedQuery,
  query: NormalizedSearchQuery
): NormalizationOutcome {
  const rejectedSamples: RejectedSample[] = [];

  const noPriceOffers = extracted.offers.filter((offer) => offer.price === null || offer.currency === null);
  for (const offer of noPriceOffers) {
    rejectedSamples.push({
      title: offer.title ?? offer.productName ?? raw.title,
      url: raw.url,
      reason: 'No confident price and currency could be extracted for this offer.',
    });
  }

  const validOffers = extracted.offers.filter((offer) => offer.price !== null && offer.currency !== null);
  const relevantOffers: ExtractedWebOffer[] = [];
  for (const offer of validOffers) {
    if (isProductRelevant(offer, query)) {
      relevantOffers.push(offer);
      continue;
    }
    logger.warn('Dropped one extracted offer: not relevant to the requested product', {
      url: raw.url,
      offerTitle: offer.title ?? offer.productName ?? undefined,
    });
    rejectedSamples.push({
      title: offer.title ?? offer.productName ?? raw.title,
      url: raw.url,
      reason: explainIrrelevance(offer, query) ?? 'This listing does not match the requested product.',
    });
  }
  // extracted.pageType is always a real value from the real
  // WebResultExtractionService (defaulted to 'UNKNOWN' by its own schema
  // when the model didn't classify it) — the `?? 'UNKNOWN'` fallback here
  // only matters for a caller that bypasses that schema entirely (as this
  // provider's own unit tests do, mocking extractBatch directly).
  const pageType = extracted.pageType ?? 'UNKNOWN';
  // Provenance (Option A audit, point 3): when a page yields more than one
  // offer, every one of those results shares the SAME raw.url (Tavily
  // never gives this provider a distinct per-offer URL — see
  // WebSourcingProvider.ts's own file header) — OpportunityRankingService
  // turns this flag into an explicit warning that the source link may open
  // the general page rather than this exact offer. A page that happens to
  // yield exactly one valid offer gets no such warning: there is nothing
  // ambiguous about a single offer's own source link.
  const sharedSourcePage = relevantOffers.length > 1;

  const results: NormalizedSourcingResult[] = relevantOffers.map((offer) => ({
    source: 'web',
    sourceId: buildOfferSourceId('web', raw.url, offer),
    sharedSourcePage,
    sourceUrl: raw.url,
    title: offer.title ?? offer.productName ?? raw.title, // raw.title is itself real, provider-reported data — never invented — used only when extraction didn't separately confirm one for this offer.
    brand: offer.brand ?? undefined,
    price: offer.price as number,
    currency: (offer.currency as string).toUpperCase(),
    marketplace: deriveMarketplace(raw.domain),
    condition: offer.condition ?? undefined,
    // offer.imageUrl only exists on the real schema (default null) or a
    // mocked test fixture (undefined if omitted) — either way, a falsy
    // value here means "not reported", never a fabricated placeholder.
    images: offer.imageUrl ? [offer.imageUrl] : [],
    seller: offer.seller ? { name: offer.seller } : undefined,
    // Never 'verified': no institutional authenticity program exists for
    // a generic web result — only ever the page's own claim, or nothing.
    authenticityStatus: offer.authenticityClaim ? 'claimed' : 'unverified',
    authenticitySource: offer.authenticityClaim ?? undefined,
    shippingCost: offer.shippingCost ?? undefined,
    shippingCostCurrency: offer.shippingCost !== null ? (offer.currency as string).toUpperCase() : undefined,
    // Free text as extracted (e.g. "Paris, France"), NOT the ISO 3166-1
    // alpha-2 code EbayBrowseSourcingProvider reports here — a general
    // web page never states a clean country code, and this field has no
    // runtime format enforcement (see NormalizedSourcingResult's own
    // comment); SourcingResultCard only ever displays it as plain text,
    // never parses it as a code, so this stays honest rather than
    // guessing/normalizing into a code that wasn't really there.
    itemLocationCountry: offer.location ?? undefined,
    // Deep Web Sourcing Engine additions — all additive, all "absent
    // means not reported", never a guess.
    productUrl: offer.productUrl ?? undefined,
    material: offer.material ?? undefined,
    size: offer.size ?? undefined,
    // Opportunity Classification fix — extracted by WebResultExtractionService
    // since before this field existed on NormalizedSourcingResult, but
    // previously discarded right here. Exactly the source's own words,
    // never normalized/translated (comparison normalization lives
    // entirely in OpportunityRankingService.normalizeColorTokens).
    color: offer.color ?? undefined,
    availability: offer.availability ?? undefined,
    pageType,
    foundByQuery: plannedQuery.queryText,
    searchPass: plannedQuery.pass,
    // Deep Web Sourcing Engine (mission section 13) — the one, honest
    // default: no live second-confirmation request is ever made by this
    // provider. SourcingService's deduplicate step is the only place that
    // may ever upgrade this to 'conflicting', for the one narrow case it
    // actually detects (see that function's own comment).
    verificationStatus: 'unverified',
  }));

  return { results, noConfidentPriceCount: noPriceOffers.length, irrelevantCount: validOffers.length - relevantOffers.length, rejectedSamples };
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

    // Deep Web Sourcing Engine — deepSearch defaults to false, which
    // yields exactly one pass ('exact', the SAME query text as before
    // this feature existed) — a caller that never sets this field sees
    // byte-identical behavior.
    const deepSearch = query.deepSearch === true;
    const passes = WebSearchQueryPlanner.buildPasses(query, deepSearch);

    const errors: SourcingProviderErrorInfo[] = [];
    const results: NormalizedSourcingResult[] = [];
    const seenUrls = new Set<string>();
    let validOfferCount = 0;
    let remainingExtractionBudget = MAX_TOTAL_EXTRACTION_CALLS_PER_SEARCH;
    // Opportunity Classification fix — real, counted/sampled rejections,
    // merged by SourcingService into its own SourcingSearchDiagnostics.
    // rejectedSamples bounded here too (not just in SourcingService) so
    // one pathological page/search can never grow this unboundedly before
    // the final, global bound is even applied.
    let noConfidentPriceCount = 0;
    let irrelevantCount = 0;
    const rejectedSamples: RejectedSample[] = [];
    const MAX_REJECTED_SAMPLES_PER_PROVIDER = 20;

    for (const plannedQuery of passes) {
      // Recovery only ever runs as a last resort — never when an earlier
      // pass already found at least one real, priced offer.
      if (plannedQuery.pass === 'recovery' && validOfferCount > 0) break;
      // "Stop early once enough high-quality results are found" (mission
      // section 4) — only applies to escalation passes, never skips the
      // first ('exact') pass itself.
      if (plannedQuery.pass !== 'exact' && validOfferCount >= WebSearchQueryPlanner.SUFFICIENT_VALID_OFFERS_TO_STOP_EARLY) break;
      if (remainingExtractionBudget <= 0) break;

      const rawResultsThisPass: WebSearchResult[] = [];
      await Promise.all(
        engines.map(async (engine) => {
          try {
            const outcome = await engine.search({
              query: plannedQuery.queryText,
              maxResults: TAVILY_MAX_RAW_RESULTS,
              // Omitted entirely for 'basic' (Tavily's own default) —
              // only the recovery pass's 'advanced' depth is ever sent
              // explicitly, so the default path's request shape is
              // unchanged from before this feature existed.
              ...(plannedQuery.searchDepth === 'advanced' ? { searchDepth: 'advanced' as const } : {}),
            });
            rawResultsThisPass.push(...outcome.results);
            if (outcome.error) {
              errors.push(toSourcingErrorInfo(outcome.error));
            }
          } catch (error) {
            // A web search engine is expected to catch its own errors
            // (see TavilyWebSearchProvider) — this is a defensive
            // backstop against a provider bug, not the normal path.
            logger.error(
              `Web search engine "${engine.name}" threw instead of returning a structured error`,
              error instanceof Error ? error : String(error)
            );
            errors.push({ provider: 'web', message: `${engine.displayName} search failed unexpectedly`, kind: 'unknown' });
          }
        })
      );

      // A page already seen in an earlier pass this search is never
      // re-extracted (saves budget) and never produces a second,
      // duplicate set of results for the exact same URL.
      const newHits = rawResultsThisPass.filter((hit) => !seenUrls.has(hit.url));
      for (const hit of newHits) seenUrls.add(hit.url);
      if (newHits.length === 0) continue;

      const candidates = selectCandidates(newHits).slice(0, remainingExtractionBudget);
      if (candidates.length === 0) continue;
      remainingExtractionBudget -= candidates.length;

      const extractions = await WebResultExtractionService.extractBatch(candidates);
      for (const { result: raw, outcome } of extractions) {
        if (outcome.status === 'error') {
          // One failed extraction never fails the whole search — logged,
          // and simply not turned into a result (never a fabricated one).
          logger.warn('Skipped one web candidate: extraction failed', { url: raw.url, reason: outcome.reason });
          continue;
        }
        const normalized = toNormalizedResults(raw, outcome.data, plannedQuery, query);
        results.push(...normalized.results);
        validOfferCount += normalized.results.length;
        noConfidentPriceCount += normalized.noConfidentPriceCount;
        irrelevantCount += normalized.irrelevantCount;
        if (rejectedSamples.length < MAX_REJECTED_SAMPLES_PER_PROVIDER) {
          rejectedSamples.push(...normalized.rejectedSamples.slice(0, MAX_REJECTED_SAMPLES_PER_PROVIDER - rejectedSamples.length));
        }
      }
    }

    return {
      results,
      error: errors[0],
      rejectedCounts: { irrelevantProduct: irrelevantCount, noConfidentPrice: noConfidentPriceCount },
      rejectedSamples,
    };
  }

  async getProductDetails(_sourceUrl: string): Promise<NormalizedSourcingResult | null> {
    // Honestly not implemented yet — same as EbayBrowseSourcingProvider's
    // and EtsySourcingProvider's own getProductDetails, never a
    // fabricated item.
    return null;
  }
}

export default WebSourcingProvider;
