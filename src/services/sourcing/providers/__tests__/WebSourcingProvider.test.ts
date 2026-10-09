/**
 * Real behavioral tests for WebSourcingProvider — the SourcingProvider
 * that wraps a general web search (WebSearchProviderRegistry) plus
 * structured extraction (WebResultExtractionService) into
 * NormalizedSourcingResult objects. Both dependencies are mocked at the
 * module boundary: this file tests WebSourcingProvider's own selection/
 * mapping/exclusion logic, not Tavily's or Anthropic's real behavior
 * (already covered by TavilyWebSearchProvider's and
 * WebResultExtractionService's own test files).
 *
 * Global Web Sourcing, Option A (multi-offer extraction): a single raw
 * hit's extraction can now report zero, one, or several distinct offers
 * (ExtractedWebPageOffers = {offers: ExtractedWebOffer[]}) — this file's
 * fixtures/tests were updated for that shape; see
 * WebResultExtractionService's own test file for the extraction service's
 * own multi-offer behavior (there, not duplicated here).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConfiguredProvidersMock, extractBatchMock } = vi.hoisted(() => ({
  getConfiguredProvidersMock: vi.fn(),
  extractBatchMock: vi.fn(),
}));

vi.mock('@/services/websourcing/WebSearchProviderRegistry', () => ({
  WebSearchProviderRegistry: { getConfiguredProviders: getConfiguredProvidersMock },
}));

vi.mock('@/services/sourcing/WebResultExtractionService', () => ({
  WebResultExtractionService: { extractBatch: extractBatchMock },
}));

import {
  WebSourcingProvider,
  MAX_CANDIDATES_FOR_EXTRACTION,
  MAX_TOTAL_EXTRACTION_CALLS_PER_SEARCH,
  isProductRelevant,
  parseSourceDate,
} from '@/services/sourcing/providers/WebSourcingProvider';
import { ExtractedWebOffer } from '@/services/sourcing/WebResultExtractionService';
import { NormalizedSearchQuery } from '@/services/sourcing/types';
import { MAX_WEB_SEARCH_PASSES } from '@/services/sourcing/WebSearchQueryPlanner';
import { WebSearchResult } from '@/services/websourcing/types';

function hit(overrides: Partial<WebSearchResult> = {}): WebSearchResult {
  return {
    title: 'Stone Island Jacket size L',
    url: 'https://vinted.fr/items/123-stone-island-jacket',
    content: 'Stone Island jacket, size L, 220€, used.',
    domain: 'vinted.fr',
    score: 0.9,
    ...overrides,
  };
}

const FULL_OFFER = {
  title: 'Stone Island Jacket size L',
  brand: 'Stone Island',
  productName: null,
  model: null,
  price: 220,
  currency: 'eur',
  condition: 'used',
  size: 'L',
  color: null,
  seller: null,
  shippingCost: null,
  location: null,
  category: null,
  authenticityClaim: null,
};

function offers(...list: Record<string, unknown>[]) {
  return { offers: list };
}

function fakeEngine(name: string, results: WebSearchResult[], error?: any) {
  return {
    name,
    displayName: name,
    isConfigured: () => true,
    search: vi.fn().mockResolvedValue({ results, error }),
  };
}

/** A minimal ExtractedWebOffer with only the given fields set, every other field null — matches the real extraction schema's shape. */
function offer(overrides: Partial<ExtractedWebOffer> = {}): ExtractedWebOffer {
  return {
    title: null,
    brand: null,
    productName: null,
    model: null,
    price: null,
    currency: null,
    condition: null,
    size: null,
    color: null,
    seller: null,
    shippingCost: null,
    location: null,
    category: null,
    authenticityClaim: null,
    availability: null,
    material: null,
    imageUrl: null,
    productUrl: null,
    ...overrides,
  };
}

// Deep Web Sourcing Engine fix (mission sections 1 & 4) — deterministic
// product-relevance filter, run AFTER extraction, before an offer ever
// becomes a NormalizedSourcingResult. Exact acceptance table from the
// mission brief.
describe('isProductRelevant (Deep Web Sourcing Engine fix)', () => {
  const query: NormalizedSearchQuery = { query: 'Nike Air Max' };

  it('ACCEPT — Nike Air Max 90', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Max 90' }), query)).toBe(true);
  });

  it('ACCEPT — Nike Air Max 97', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Max 97' }), query)).toBe(true);
  });

  it('REJECT — Nike Air Jordan 1 (has "nike"/"air" but not "max")', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Jordan 1' }), query)).toBe(false);
  });

  it('REJECT — Jordan 1 (a different product line entirely)', () => {
    expect(isProductRelevant(offer({ title: 'Jordan 1 Retro High OG SP Fragment x Union LA' }), query)).toBe(false);
  });

  it('REJECT — Nike Dunk (a different Nike product line)', () => {
    expect(isProductRelevant(offer({ title: 'Nike Dunk Low Retro' }), query)).toBe(false);
  });

  it('REJECT — Nike Air Max laces only (accessory, not the shoe)', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Max laces only' }), query)).toBe(false);
  });

  it('REJECT — "Nike Air Max 1/97 Sean Wotherspoon (Extra Lace Set Only)" — the real false-positive observed in production', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Max 1/97 Sean Wotherspoon (Extra Lace Set Only)' }), query)).toBe(false);
  });

  it('ACCEPT when the matching tokens are spread across brand/model/productName instead of title', () => {
    expect(isProductRelevant(offer({ brand: 'Nike', model: 'Air Max 95', productName: 'Air Max' }), query)).toBe(true);
  });

  it('never rejects on insufficient information — a query with no usable tokens checks nothing', () => {
    expect(isProductRelevant(offer({ title: 'anything at all' }), { query: 'x' })).toBe(true);
  });

  it('uses query.brand/model when the free-text query is more generic — "sneakers" + brand "Nike" + model "Air Max" still requires all three', () => {
    const structuredQuery: NormalizedSearchQuery = { query: 'sneakers', brand: 'Nike', model: 'Air Max' };
    expect(isProductRelevant(offer({ title: 'Nike Air Max 90 sneakers' }), structuredQuery)).toBe(true);
    expect(isProductRelevant(offer({ title: 'Adidas sneakers' }), structuredQuery)).toBe(false);
  });
});

describe('isProductRelevant — demographic filter (Opportunity Classification fix)', () => {
  const adultQuery: NormalizedSearchQuery = { query: 'Nike Air Force 1' };

  it('REJECT — adult search, offer is a kids (GS) variant', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 (GS) Grade School' }), adultQuery)).toBe(false);
  });

  it('REJECT — adult search, offer is a toddler variant', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 Toddler' }), adultQuery)).toBe(false);
  });

  it('REJECT — adult search, offer is an infant/baby variant', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 Infant' }), adultQuery)).toBe(false);
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 Baby' }), adultQuery)).toBe(false);
  });

  it('REJECT — adult search, offer named "kids" or "children"', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 Kids' }), adultQuery)).toBe(false);
    expect(isProductRelevant(offer({ title: "Nike Air Force 1 Children's Shoe" }), adultQuery)).toBe(false);
  });

  it('REJECT — adult search, offer is a (PS)/(TD) preschool/toddler variant', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 (PS)' }), adultQuery)).toBe(false);
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 (TD)' }), adultQuery)).toBe(false);
  });

  it('ACCEPT — explicitly kids-intent query is never filtered out', () => {
    // "kids" named via `category` (also checked by queryRequestsKidsSegment)
    // rather than folded into `query.query` itself, so it never becomes a
    // REQUIRED token the offer's own title would also have to contain —
    // this test is about the demographic filter being skipped, not about
    // the unrelated token-overlap check.
    const kidsQuery: NormalizedSearchQuery = { query: 'Nike Air Force 1', category: 'kids' };
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 (GS) Grade School' }), kidsQuery)).toBe(true);
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 Toddler' }), kidsQuery)).toBe(true);
  });

  it('never false-positives on an unrelated bare "PS"/"GS" substring (e.g. not parenthesized) — precision over recall by design', () => {
    // "PS5"/a loose "GS" mention never gets the kids treatment unless it's the
    // real, parenthesized sneaker-marketplace convention "(PS)"/"(GS)"/"(TD)".
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 PS5 Collab' }), adultQuery)).toBe(true);
  });

  it('ACCEPT — a plain adult listing with none of these words', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 White Men\'s' }), adultQuery)).toBe(true);
  });
});

describe('isProductRelevant — demographic filter, French vocabulary (Web Sourcing smoke-test fix, section 1)', () => {
  const adultQuery: NormalizedSearchQuery = { query: 'Nike Air Force 1' };

  it('REJECT — adult search, offer is a (GS) variant, regardless of query language', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 (GS)' }), adultQuery)).toBe(false);
  });

  it('ACCEPT — category="kids" (English) + (GS) offer is never filtered out', () => {
    const kidsQuery: NormalizedSearchQuery = { query: 'Nike Air Force 1', category: 'kids' };
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 (GS)' }), kidsQuery)).toBe(true);
  });

  it('ACCEPT — category="enfant" (French) + (GS) offer is never filtered out — the provider must not depend on the Agent having translated it', () => {
    const enfantQuery: NormalizedSearchQuery = { query: 'Nike Air Force 1', category: 'enfant' };
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 (GS)' }), enfantQuery)).toBe(true);
  });

  it('ACCEPT — an explicit French kids-intent free-text query + (GS) offer is never filtered out', () => {
    // Exactly the real-world phrasing from the smoke test that found this
    // gap ("Nike Air Force 1 enfant") — a filler word like "pour" would
    // itself become a required token no offer could ever literally
    // contain (same class of issue as English "for"/"the", already
    // handled for English by RELEVANCE_STOPWORDS; out of this fix's
    // narrower scope to extend that stopword list to French).
    const frenchQuery: NormalizedSearchQuery = { query: 'Nike Air Force 1 enfant' };
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 (GS)' }), frenchQuery)).toBe(true);
  });

  it('ACCEPT — an explicit English kids-intent free-text query + (GS) offer is never filtered out', () => {
    const englishQuery: NormalizedSearchQuery = { query: 'Nike Air Force 1 for kids' };
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 (GS)' }), englishQuery)).toBe(true);
  });

  it('REJECT — a plain adult query (no kids intent in any language) still rejects a (GS) variant', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 (GS)' }), adultQuery)).toBe(false);
  });

  it('REJECT — French demographic words on the offer itself, adult query', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 Enfant' }), adultQuery)).toBe(false);
    expect(isProductRelevant(offer({ title: 'Chaussure Nike Air Force 1 Bébé' }), adultQuery)).toBe(false);
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 Nourrisson' }), adultQuery)).toBe(false);
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 Junior' }), adultQuery)).toBe(false);
  });

  it('still never false-positives on an unrelated bare "PS5" — the French additions do not widen this', () => {
    expect(isProductRelevant(offer({ title: 'Nike Air Force 1 PS5 Collab' }), adultQuery)).toBe(true);
  });
});

describe('WebSourcingProvider.isConfigured', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reflects WebSearchProviderRegistry.getConfiguredProviders()', () => {
    getConfiguredProvidersMock.mockReturnValue([]);
    expect(new WebSourcingProvider().isConfigured()).toBe(false);

    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [])]);
    expect(new WebSourcingProvider().isConfigured()).toBe(true);
  });
});

describe('WebSourcingProvider — static declarative metadata', () => {
  const provider = new WebSourcingProvider();

  it('name is "web"', () => expect(provider.name).toBe('web'));
  it('declares only keyword_search — never price_filter/condition_filter/worldwide_search', () => {
    expect(provider.capabilities).toEqual(['keyword_search']);
  });
  it('supportedMarkets is empty — not scoped to a fixed provider-declared vocabulary', () => {
    expect(provider.supportedMarkets).toEqual([]);
  });
});

describe('WebSourcingProvider.getProductDetails', () => {
  it('is honestly not implemented — returns null, never a fabricated item', async () => {
    const result = await new WebSourcingProvider().getProductDetails('https://vinted.fr/items/123');
    expect(result).toBeNull();
  });
});

// Source freshness (Phase 1) — deterministic, mechanical parsing of
// Tavily's own reported publishedDate. No guessing, no default to "now".
describe('parseSourceDate (source freshness)', () => {
  it('a real, parseable past date -> "known", with a normalized ISO value', () => {
    const result = parseSourceDate('2024-03-15T00:00:00Z');
    expect(result.status).toBe('known');
    expect(result.iso).toBe(new Date('2024-03-15T00:00:00Z').toISOString());
  });

  it('undefined (no date reported at all) -> "unknown", never defaulted to today', () => {
    const result = parseSourceDate(undefined);
    expect(result.status).toBe('unknown');
    expect(result.iso).toBeUndefined();
  });

  it('a malformed, non-date string -> "invalid", never silently treated as unknown or as a real date', () => {
    const result = parseSourceDate('not-a-real-date');
    expect(result.status).toBe('invalid');
    expect(result.iso).toBeUndefined();
  });

  it('a date further in the future than this engine could trust -> "invalid" (a page cannot honestly be "published" in the future)', () => {
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const result = parseSourceDate(farFuture);
    expect(result.status).toBe('invalid');
    expect(result.iso).toBeUndefined();
  });

  it('a date essentially "now" (within clock-skew tolerance) is still "known", never incorrectly rejected as future/invalid', () => {
    const justNow = new Date().toISOString();
    const result = parseSourceDate(justNow);
    expect(result.status).toBe('known');
  });
});

describe('WebSourcingProvider.searchProducts', () => {
  let provider: WebSourcingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new WebSourcingProvider();
  });

  it('no configured web search engine -> empty results, no extraction attempted', async () => {
    getConfiguredProvidersMock.mockReturnValue([]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results).toEqual([]);
    expect(extractBatchMock).not.toHaveBeenCalled();
  });

  it('a real offer with a confident price/currency -> mapped to a NormalizedSourcingResult with source "web"', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers(FULL_OFFER) } }]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results).toHaveLength(1);
    const result = outcome.results[0];
    expect(result.source).toBe('web');
    expect(result.sourceUrl).toBe(rawHit.url);
    expect(result.price).toBe(220);
    expect(result.currency).toBe('EUR');
    expect(result.marketplace).toBe('vinted');
  });

  it('source freshness — the raw hit\'s own publishedDate becomes a real, parsed sourcePublishedAt and sourceDateStatus "known" on the result', async () => {
    const rawHit = hit({ publishedDate: '2024-06-01T00:00:00Z' });
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers(FULL_OFFER) } }]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results[0].sourceDateStatus).toBe('known');
    expect(outcome.results[0].sourcePublishedAt).toBe(new Date('2024-06-01T00:00:00Z').toISOString());
  });

  it('source freshness — a raw hit with no publishedDate at all becomes sourceDateStatus "unknown", never a guessed date', async () => {
    const rawHit = hit({ publishedDate: undefined });
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers(FULL_OFFER) } }]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results[0].sourceDateStatus).toBe('unknown');
    expect(outcome.results[0].sourcePublishedAt).toBeUndefined();
  });

  it('source freshness — a raw hit with an unparseable publishedDate becomes sourceDateStatus "invalid", never coerced', async () => {
    const rawHit = hit({ publishedDate: 'sometime last year maybe' });
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers(FULL_OFFER) } }]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results[0].sourceDateStatus).toBe('invalid');
    expect(outcome.results[0].sourcePublishedAt).toBeUndefined();
  });

  it('source freshness — several distinct offers extracted from the SAME raw page all share that one page\'s own sourceDateStatus/sourcePublishedAt (one page, one publish date)', async () => {
    const rawHit = hit({ publishedDate: '2024-01-10T00:00:00Z' });
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([
      {
        result: rawHit,
        outcome: { status: 'ok', data: offers({ ...FULL_OFFER, price: 100 }, { ...FULL_OFFER, price: 150, size: 'M' }) },
      },
    ]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0].sourceDateStatus).toBe('known');
    expect(outcome.results[1].sourceDateStatus).toBe('known');
    expect(outcome.results[0].sourcePublishedAt).toBe(outcome.results[1].sourcePublishedAt);
  });

  it('never sets authenticityStatus "verified" or any priceVerifiedAt for a web result, no matter how fresh/recent its publish date is — no institutional program and no real re-verification exist for this provider', async () => {
    const rawHit = hit({ publishedDate: new Date().toISOString() });
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([
      { result: rawHit, outcome: { status: 'ok', data: offers({ ...FULL_OFFER, authenticityClaim: '100% authentic, with receipt' }) } },
    ]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results[0].authenticityStatus).not.toBe('verified');
    expect(outcome.results[0].authenticityStatus).toBe('claimed');
    expect((outcome.results[0] as any).priceVerifiedAt).toBeUndefined();
  });

  it('extraction reporting offers: [] (e.g. a non-offer page) -> excluded from results, never forced into a result', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers() } }]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results).toEqual([]);
  });

  it('extraction with no confident price -> excluded, never a fabricated price', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([
      { result: rawHit, outcome: { status: 'ok', data: offers({ ...FULL_OFFER, price: null, currency: null }) } },
    ]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results).toEqual([]);
  });

  it('extraction with a price but no currency -> excluded (currency required)', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([
      { result: rawHit, outcome: { status: 'ok', data: offers({ ...FULL_OFFER, currency: null }) } },
    ]);

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
  });

  it('extraction failure for one candidate -> excluded, never fails the whole search', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'error', reason: 'boom' } }]);

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.results).toEqual([]);
    expect(outcome.error).toBeUndefined();
  });

  it('Opportunity Classification fix — offer.color is reported onto the result.color field, never discarded', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers({ ...FULL_OFFER, color: 'Black/White' }) } }]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results[0].color).toBe('Black/White');
  });

  it('a result with no reported color leaves color undefined, never a fabricated value', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers(FULL_OFFER) } }]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results[0].color).toBeUndefined();
  });

  it('Opportunity Classification fix — aggregates real rejection counts/samples: no confident price', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([
      { result: rawHit, outcome: { status: 'ok', data: offers({ ...FULL_OFFER, price: null, currency: null }) } },
    ]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.rejectedCounts?.noConfidentPrice).toBe(1);
    expect(outcome.rejectedCounts?.irrelevantProduct).toBe(0);
    expect(outcome.rejectedSamples).toEqual([
      expect.objectContaining({ title: 'Stone Island Jacket size L', url: rawHit.url, reason: expect.stringContaining('confident price') }),
    ]);
  });

  it('Opportunity Classification fix — aggregates real rejection counts/samples: irrelevant product (incl. demographic)', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([
      { result: rawHit, outcome: { status: 'ok', data: offers({ ...FULL_OFFER, title: 'Nike Air Force 1 (GS)' }) } },
    ]);

    const outcome = await provider.searchProducts({ query: 'Nike Air Force 1' });

    expect(outcome.rejectedCounts?.irrelevantProduct).toBe(1);
    expect(outcome.rejectedCounts?.noConfidentPrice).toBe(0);
    expect(outcome.rejectedSamples?.[0]).toMatchObject({ title: 'Nike Air Force 1 (GS)', url: rawHit.url });
    expect(outcome.rejectedSamples?.[0].reason).toMatch(/kids|toddler|infant/i);
  });

  it('authenticityStatus is "claimed" only when the page itself makes a claim, "unverified" otherwise — never "verified"', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);

    extractBatchMock.mockResolvedValue([
      { result: rawHit, outcome: { status: 'ok', data: offers({ ...FULL_OFFER, authenticityClaim: '100% authentic, with receipt' }) } },
    ]);
    let result = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(result.authenticityStatus).toBe('claimed');
    expect(result.authenticitySource).toBe('100% authentic, with receipt');

    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers(FULL_OFFER) } }]);
    result = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(result.authenticityStatus).toBe('unverified');
  });

  it('selects at most MAX_CANDIDATES_FOR_EXTRACTION raw hits, by descending score, for extraction', async () => {
    const hits = Array.from({ length: MAX_CANDIDATES_FOR_EXTRACTION + 3 }, (_, i) =>
      hit({ url: `https://vinted.fr/items/${i}`, score: i })
    );
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', hits)]);
    extractBatchMock.mockResolvedValue([]);

    await provider.searchProducts({ query: 'x' });

    const [passedCandidates] = extractBatchMock.mock.calls[0];
    expect(passedCandidates).toHaveLength(MAX_CANDIDATES_FOR_EXTRACTION);
    const scores = passedCandidates.map((c: WebSearchResult) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('a candidate with no reported score sorts after every scored candidate — never treated as score 0', async () => {
    const scored = hit({ url: 'https://a.example/1', score: 0.1 });
    const unscored = hit({ url: 'https://a.example/2', score: undefined });
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [unscored, scored])]);
    extractBatchMock.mockResolvedValue([]);

    await provider.searchProducts({ query: 'x' });

    const [passedCandidates] = extractBatchMock.mock.calls[0];
    expect(passedCandidates[0].url).toBe('https://a.example/1');
    expect(passedCandidates[1].url).toBe('https://a.example/2');
  });

  it('one engine erroring -> a structured providerErrors entry, but does not block the other engine\'s real hits', async () => {
    const rawHit = hit();
    const failingEngine = fakeEngine('tavily', [], { provider: 'tavily', message: 'upstream down', kind: 'upstream_error' });
    failingEngine.search = vi.fn().mockResolvedValue({ results: [], error: { provider: 'tavily', message: 'upstream down', kind: 'upstream_error' } });
    getConfiguredProvidersMock.mockReturnValue([failingEngine]);
    extractBatchMock.mockResolvedValue([]);

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.error?.kind).toBe('upstream_error');
    expect(outcome.error?.provider).toBe('web');
  });

  it('maps a WebSearchProviderErrorInfo "invalid_response" kind to the closest real SourcingProviderErrorInfo kind ("upstream_error")', async () => {
    const failingEngine = fakeEngine('tavily', [], undefined);
    failingEngine.search = vi.fn().mockResolvedValue({ results: [], error: { provider: 'tavily', message: 'bad shape', kind: 'invalid_response' } });
    getConfiguredProvidersMock.mockReturnValue([failingEngine]);

    const outcome = await provider.searchProducts({ query: 'x' });

    expect(outcome.error?.kind).toBe('upstream_error');
  });

  it('folds brand/model/size/color/category into the free-text query sent to the web engine, same as other providers', async () => {
    const engine = fakeEngine('tavily', []);
    getConfiguredProvidersMock.mockReturnValue([engine]);
    extractBatchMock.mockResolvedValue([]);

    await provider.searchProducts({ query: 'jacket', brand: 'Stone Island', model: 'Ghost', size: 'L', color: 'black', category: 'coats' });

    const [queryArg] = engine.search.mock.calls[0];
    expect(queryArg.query).toContain('jacket');
    expect(queryArg.query).toContain('Stone Island');
    expect(queryArg.query).toContain('Ghost');
    expect(queryArg.query).toContain('L');
    expect(queryArg.query).toContain('black');
    expect(queryArg.query).toContain('coats');
  });

  it('never invents a location — location intent not already in query.query is not added on its own', async () => {
    const engine = fakeEngine('tavily', []);
    getConfiguredProvidersMock.mockReturnValue([engine]);
    extractBatchMock.mockResolvedValue([]);

    await provider.searchProducts({ query: 'Stone Island jacket', brand: 'Stone Island' });

    const [queryArg] = engine.search.mock.calls[0];
    expect(queryArg.query).toBe('Stone Island jacket Stone Island');
  });

  it('an unknown domain falls back to the literal domain, never a guessed marketplace name', async () => {
    const rawHit = hit({ domain: 'some-boutique-example.com' });
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers(FULL_OFFER) } }]);

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.marketplace).toBe('some-boutique-example.com');
  });

  // Global Web Sourcing, Option A — multi-offer extraction from one page.
  describe('multi-offer extraction (Option A)', () => {
    const SELLPY_HIT = hit({
      title: 'Buy second hand Nike Air Max online at Sellpy',
      url: 'https://www.sellpy.com/store/brand/Nike%20Air%20Max',
      content: 'Nike Air Max Running shoes, Size: 39 24,00 EUR Trainers\nNike Air Max Trainers, Size: 37 1/2 50,50 EUR\n41,00 EUR Trainers. Size: 40 34,00 EUR',
      domain: 'sellpy.com',
    });

    function sellpyOffer(size: string, price: number) {
      return { ...FULL_OFFER, title: 'Nike Air Max Trainers', brand: 'Nike', size, price, currency: 'eur' };
    }

    it('TEST B — a category page containing 3 explicit offers -> 3 distinct results', async () => {
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [SELLPY_HIT])]);
      extractBatchMock.mockResolvedValue([
        { result: SELLPY_HIT, outcome: { status: 'ok', data: offers(sellpyOffer('39', 24), sellpyOffer('37 1/2', 50.5), sellpyOffer('40', 34)) } },
      ]);

      const outcome = await provider.searchProducts({ query: 'Nike Air Max' });

      expect(outcome.results).toHaveLength(3);
    });

    it('TEST C — three offers with three different prices -> each result keeps its own price', async () => {
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [SELLPY_HIT])]);
      extractBatchMock.mockResolvedValue([
        { result: SELLPY_HIT, outcome: { status: 'ok', data: offers(sellpyOffer('39', 24), sellpyOffer('37 1/2', 50.5), sellpyOffer('40', 34)) } },
      ]);

      const outcome = await provider.searchProducts({ query: 'Nike Air Max' });

      expect(outcome.results.map((r) => r.price).sort((a, b) => a - b)).toEqual([24, 34, 50.5]);
    });

    it('TEST G/H — two offers from the same page URL get DIFFERENT, deterministic sourceIds, so they are never fused by SourcingService.deduplicate()', async () => {
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [SELLPY_HIT])]);
      extractBatchMock.mockResolvedValue([
        { result: SELLPY_HIT, outcome: { status: 'ok', data: offers(sellpyOffer('39', 24), sellpyOffer('40', 34)) } },
      ]);

      const outcome = await provider.searchProducts({ query: 'Nike Air Max' });

      expect(outcome.results).toHaveLength(2);
      expect(outcome.results[0].sourceUrl).toBe(outcome.results[1].sourceUrl); // same page
      expect(outcome.results[0].sourceId).toBeDefined();
      expect(outcome.results[1].sourceId).toBeDefined();
      expect(outcome.results[0].sourceId).not.toBe(outcome.results[1].sourceId); // distinct offers
    });

    it('sourceId is deterministic — the exact same offer, extracted again, hashes to the exact same id (never Math.random)', async () => {
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [SELLPY_HIT])]);
      extractBatchMock.mockResolvedValue([{ result: SELLPY_HIT, outcome: { status: 'ok', data: offers(sellpyOffer('39', 24)) } }]);
      const first = (await provider.searchProducts({ query: 'Nike Air Max' })).results[0].sourceId;

      extractBatchMock.mockResolvedValue([{ result: SELLPY_HIT, outcome: { status: 'ok', data: offers(sellpyOffer('39', 24)) } }]);
      const second = (await provider.searchProducts({ query: 'Nike Air Max' })).results[0].sourceId;

      expect(first).toBe(second);
    });

    it('sharedSourcePage is true when a page yields more than one offer, undefined/false for a single-offer page', async () => {
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [SELLPY_HIT])]);
      extractBatchMock.mockResolvedValue([
        { result: SELLPY_HIT, outcome: { status: 'ok', data: offers(sellpyOffer('39', 24), sellpyOffer('40', 34)) } },
      ]);
      const multi = (await provider.searchProducts({ query: 'x' })).results;
      expect(multi.every((r) => r.sharedSourcePage === true)).toBe(true);

      const singleHit = hit();
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [singleHit])]);
      extractBatchMock.mockResolvedValue([{ result: singleHit, outcome: { status: 'ok', data: offers(FULL_OFFER) } }]);
      const single = (await provider.searchProducts({ query: 'x' })).results;
      expect(single[0].sharedSourcePage).not.toBe(true);
    });

    it('TEST J — no image is ever fabricated for a multi-offer page, same as a single-offer page', async () => {
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [SELLPY_HIT])]);
      extractBatchMock.mockResolvedValue([
        { result: SELLPY_HIT, outcome: { status: 'ok', data: offers(sellpyOffer('39', 24), sellpyOffer('40', 34)) } },
      ]);

      const outcome = await provider.searchProducts({ query: 'Nike Air Max' });

      expect(outcome.results.every((r) => r.images.length === 0)).toBe(true);
    });

    it('an offer within a multi-offer page still gets excluded on its own if it has no confident price/currency', async () => {
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [SELLPY_HIT])]);
      extractBatchMock.mockResolvedValue([
        {
          result: SELLPY_HIT,
          outcome: {
            status: 'ok',
            data: offers(sellpyOffer('39', 24), { ...sellpyOffer('37 1/2', 0), price: null, currency: null }, sellpyOffer('40', 34)),
          },
        },
      ]);

      const outcome = await provider.searchProducts({ query: 'Nike Air Max' });

      expect(outcome.results).toHaveLength(2); // the price-less offer is dropped, the other two survive
    });
  });

  // Deep Web Sourcing Engine — multi-pass orchestration, budget, and the
  // new per-result provenance/quality fields.
  describe('Deep Web Sourcing Engine — multi-pass search (deepSearch)', () => {
    /** An engine whose search() result depends on which pass's query text it receives — lets a test simulate "pass 1 found nothing, pass 2 found something" realistically. */
    function routedEngine(byQueryText: Record<string, { results: WebSearchResult[]; error?: any }>) {
      return {
        name: 'tavily',
        displayName: 'Tavily',
        isConfigured: () => true,
        search: vi.fn(async (q: { query: string }) => byQueryText[q.query] ?? { results: [] }),
      };
    }

    it('deepSearch omitted/false: exactly one engine.search call, tagged with searchPass "exact" and foundByQuery equal to the base query text', async () => {
      const rawHit = hit();
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
      extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers(FULL_OFFER) } }]);

      const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

      expect(outcome.results).toHaveLength(1);
      expect(outcome.results[0].searchPass).toBe('exact');
      expect(outcome.results[0].foundByQuery).toBe('Stone Island jacket');
      expect(outcome.results[0].verificationStatus).toBe('unverified');
      expect(outcome.results[0].pageType).toBe('UNKNOWN'); // mocked extraction omits pageType -> honest default
    });

    it('deepSearch=true, exact pass finds zero valid offers -> escalates through secondhand/outlet, then recovery, until one finally finds a priced offer', async () => {
      const exactHit = hit({ url: 'https://a.example/exact' });
      const recoveryHit = hit({ url: 'https://a.example/recovery' });
      const engine = routedEngine({
        'Stone Island jacket': { results: [exactHit] },
        'Stone Island jacket used second hand pre-owned': { results: [] },
        'Stone Island jacket outlet clearance discounted resale': { results: [] },
        'Stone Island jacket for sale buy': { results: [recoveryHit] },
      });
      getConfiguredProvidersMock.mockReturnValue([engine]);
      extractBatchMock.mockImplementation(async (candidates: WebSearchResult[]) =>
        candidates.map((c) => ({
          result: c,
          outcome: c.url === recoveryHit.url ? { status: 'ok', data: offers(FULL_OFFER) } : { status: 'ok', data: offers() },
        }))
      );

      const outcome = await provider.searchProducts({ query: 'Stone Island jacket', deepSearch: true });

      expect(engine.search).toHaveBeenCalledTimes(4); // exact, secondhand, outlet, recovery — all ran since nothing valid was found until the last one
      expect(outcome.results).toHaveLength(1);
      expect(outcome.results[0].searchPass).toBe('recovery');
    });

    it('deepSearch=true, exact pass already finds >= SUFFICIENT_VALID_OFFERS_TO_STOP_EARLY valid offers -> stops immediately, never escalates', async () => {
      const hits = Array.from({ length: 5 }, (_, i) => hit({ url: `https://a.example/${i}` }));
      const engine = routedEngine({ 'Nike Air Max': { results: hits } });
      getConfiguredProvidersMock.mockReturnValue([engine]);
      extractBatchMock.mockImplementation(async (candidates: WebSearchResult[]) =>
        // title/brand overridden to match the "Nike Air Max" query — this
        // test is about escalation/budget, not the relevance filter (see
        // its own dedicated describe block), so the fixture must pass that
        // filter to exercise what it's actually testing.
        candidates.map((c) => ({ result: c, outcome: { status: 'ok', data: offers({ ...FULL_OFFER, title: 'Nike Air Max 90', brand: 'Nike', price: 10 }) } }))
      );

      const outcome = await provider.searchProducts({ query: 'Nike Air Max', deepSearch: true });

      expect(engine.search).toHaveBeenCalledTimes(1);
      expect(outcome.results.length).toBeGreaterThanOrEqual(5);
    });

    it('deepSearch=true, exact pass finds exactly ONE valid offer (non-zero, below the stop-early threshold) -> escalates to secondhand/outlet but NEVER runs recovery (recovery is reserved for zero, not "few")', async () => {
      const exactHit = hit({ url: 'https://a.example/exact' });
      const engine = routedEngine({
        'Nike Air Max': { results: [exactHit] },
        'Nike Air Max used second hand pre-owned': { results: [] },
        'Nike Air Max outlet clearance discounted resale': { results: [] },
      });
      getConfiguredProvidersMock.mockReturnValue([engine]);
      extractBatchMock.mockImplementation(async (candidates: WebSearchResult[]) =>
        // title/brand overridden to match the "Nike Air Max" query — see
        // the previous test's own comment for why.
        candidates.map((c) => ({ result: c, outcome: { status: 'ok', data: offers({ ...FULL_OFFER, title: 'Nike Air Max 90', brand: 'Nike' }) } }))
      );

      await provider.searchProducts({ query: 'Nike Air Max', deepSearch: true });

      expect(engine.search).toHaveBeenCalledTimes(3); // exact, secondhand, outlet — never "Nike Air Max for sale buy" (recovery)
      const queriesSent = engine.search.mock.calls.map((c: any[]) => c[0].query);
      expect(queriesSent).not.toContain('Nike Air Max for sale buy');
    });

    it('the SAME url found again in a later pass is never re-extracted (deduplicated across passes before extraction)', async () => {
      const sharedHit = hit({ url: 'https://a.example/shared' });
      const engine = routedEngine({
        'Nike Air Max': { results: [sharedHit] },
        'Nike Air Max used second hand pre-owned': { results: [sharedHit] },
        'Nike Air Max outlet clearance discounted resale': { results: [] },
        'Nike Air Max for sale buy': { results: [] },
      });
      getConfiguredProvidersMock.mockReturnValue([engine]);
      extractBatchMock.mockImplementation(async (candidates: WebSearchResult[]) =>
        candidates.map((c) => ({ result: c, outcome: { status: 'ok', data: offers() } }))
      );

      await provider.searchProducts({ query: 'Nike Air Max', deepSearch: true });

      const allExtractedUrls = extractBatchMock.mock.calls.flatMap((call: any[]) => (call[0] as WebSearchResult[]).map((c) => c.url));
      expect(allExtractedUrls).toEqual(['https://a.example/shared']); // only once, even though 2 passes returned it
    });

    it('the extraction budget is shared GLOBALLY across passes (5 per pass cap still applies) — once MAX_TOTAL_EXTRACTION_CALLS_PER_SEARCH is spent, the recovery pass never even calls engine.search', async () => {
      // 5 fresh (never-before-seen) hits per pass, every offer empty so
      // validOfferCount stays 0 and escalation never stops early for any
      // other reason — this isolates the budget itself as the limiter.
      // exact(5) + secondhand(5) = 10 consumed; outlet can only take the
      // last 1 of the 11 budget; recovery then finds remainingBudget<=0
      // and never calls engine.search at all.
      const hitsFor = (label: string) => Array.from({ length: 5 }, (_, i) => hit({ url: `https://a.example/${label}-${i}`, score: 10 - i }));
      const engine = routedEngine({
        'Nike Air Max': { results: hitsFor('exact') },
        'Nike Air Max used second hand pre-owned': { results: hitsFor('secondhand') },
        'Nike Air Max outlet clearance discounted resale': { results: hitsFor('outlet') },
        'Nike Air Max for sale buy': { results: hitsFor('recovery') },
      });
      getConfiguredProvidersMock.mockReturnValue([engine]);
      extractBatchMock.mockImplementation(async (candidates: WebSearchResult[]) =>
        candidates.map((c) => ({ result: c, outcome: { status: 'ok', data: offers() } }))
      );

      await provider.searchProducts({ query: 'Nike Air Max', deepSearch: true });

      const totalExtracted = extractBatchMock.mock.calls.reduce((sum: number, call: any[]) => sum + (call[0] as WebSearchResult[]).length, 0);
      expect(totalExtracted).toBe(MAX_TOTAL_EXTRACTION_CALLS_PER_SEARCH);
      expect(engine.search).toHaveBeenCalledTimes(3); // exact, secondhand, outlet — recovery's engine.search is never reached once the budget hits 0
      const queriesSent = engine.search.mock.calls.map((c: any[]) => c[0].query);
      expect(queriesSent).not.toContain('Nike Air Max for sale buy');
    });

    it('never runs more than MAX_WEB_SEARCH_PASSES engine.search calls even in the worst case (everything empty, forcing every pass to run)', async () => {
      const engine = routedEngine({}); // every query text -> { results: [] }
      getConfiguredProvidersMock.mockReturnValue([engine]);
      extractBatchMock.mockResolvedValue([]);

      await provider.searchProducts({ query: 'Nike Air Max', deepSearch: true });

      expect(engine.search).toHaveBeenCalledTimes(MAX_WEB_SEARCH_PASSES);
    });

    it('availability/material/productUrl/images(from imageUrl) are propagated from a real extraction onto the NormalizedSourcingResult', async () => {
      const rawHit = hit();
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
      extractBatchMock.mockResolvedValue([
        {
          result: rawHit,
          outcome: {
            status: 'ok',
            data: {
              pageType: 'PRODUCT_PAGE',
              offers: [
                {
                  ...FULL_OFFER,
                  availability: 'IN_STOCK',
                  material: 'cotton',
                  imageUrl: 'https://a.example/photo.jpg',
                  productUrl: 'https://a.example/exact-item',
                },
              ],
            },
          },
        },
      ]);

      const result = (await provider.searchProducts({ query: 'x' })).results[0];

      expect(result.availability).toBe('IN_STOCK');
      expect(result.material).toBe('cotton');
      expect(result.productUrl).toBe('https://a.example/exact-item');
      expect(result.images).toEqual(['https://a.example/photo.jpg']);
      expect(result.pageType).toBe('PRODUCT_PAGE');
    });

    it('a result with no imageUrl/availability/material/productUrl extracted keeps the old, honest absence (empty images array, undefined fields) — never fabricated', async () => {
      const rawHit = hit();
      getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
      extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: offers(FULL_OFFER) } }]);

      const result = (await provider.searchProducts({ query: 'x' })).results[0];

      expect(result.images).toEqual([]);
      expect(result.availability).toBeUndefined();
      expect(result.material).toBeUndefined();
      expect(result.productUrl).toBeUndefined();
    });
  });
});
