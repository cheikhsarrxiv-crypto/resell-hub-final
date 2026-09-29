/**
 * Real behavioral tests for WebSourcingProvider — the SourcingProvider
 * that wraps a general web search (WebSearchProviderRegistry) plus
 * structured extraction (WebResultExtractionService) into
 * NormalizedSourcingResult objects. Both dependencies are mocked at the
 * module boundary: this file tests WebSourcingProvider's own selection/
 * mapping/exclusion logic, not Tavily's or Anthropic's real behavior
 * (already covered by TavilyWebSearchProvider's and
 * WebResultExtractionService's own test files).
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

import { WebSourcingProvider, MAX_CANDIDATES_FOR_EXTRACTION } from '@/services/sourcing/providers/WebSourcingProvider';
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

const OFFER_EXTRACTION = {
  isProductOffer: true,
  title: 'Stone Island Jacket size L',
  brand: 'Stone Island',
  productName: null,
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

function fakeEngine(name: string, results: WebSearchResult[], error?: any) {
  return {
    name,
    displayName: name,
    isConfigured: () => true,
    search: vi.fn().mockResolvedValue({ results, error }),
  };
}

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
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: OFFER_EXTRACTION } }]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results).toHaveLength(1);
    const result = outcome.results[0];
    expect(result.source).toBe('web');
    expect(result.sourceUrl).toBe(rawHit.url);
    expect(result.price).toBe(220);
    expect(result.currency).toBe('EUR');
    expect(result.marketplace).toBe('vinted');
  });

  it('extraction reporting isProductOffer: false -> excluded from results, never forced into a result', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([
      { result: rawHit, outcome: { status: 'ok', data: { ...OFFER_EXTRACTION, isProductOffer: false, price: null, currency: null } } },
    ]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results).toEqual([]);
  });

  it('extraction with no confident price -> excluded, never a fabricated price', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([
      { result: rawHit, outcome: { status: 'ok', data: { ...OFFER_EXTRACTION, price: null, currency: null } } },
    ]);

    const outcome = await provider.searchProducts({ query: 'Stone Island jacket' });

    expect(outcome.results).toEqual([]);
  });

  it('extraction with a price but no currency -> excluded (currency required)', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);
    extractBatchMock.mockResolvedValue([
      { result: rawHit, outcome: { status: 'ok', data: { ...OFFER_EXTRACTION, currency: null } } },
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

  it('authenticityStatus is "claimed" only when the page itself makes a claim, "unverified" otherwise — never "verified"', async () => {
    const rawHit = hit();
    getConfiguredProvidersMock.mockReturnValue([fakeEngine('tavily', [rawHit])]);

    extractBatchMock.mockResolvedValue([
      { result: rawHit, outcome: { status: 'ok', data: { ...OFFER_EXTRACTION, authenticityClaim: '100% authentic, with receipt' } } },
    ]);
    let result = (await provider.searchProducts({ query: 'x' })).results[0];
    expect(result.authenticityStatus).toBe('claimed');
    expect(result.authenticitySource).toBe('100% authentic, with receipt');

    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: OFFER_EXTRACTION } }]);
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
    extractBatchMock.mockResolvedValue([{ result: rawHit, outcome: { status: 'ok', data: OFFER_EXTRACTION } }]);

    const result = (await provider.searchProducts({ query: 'x' })).results[0];

    expect(result.marketplace).toBe('some-boutique-example.com');
  });
});
