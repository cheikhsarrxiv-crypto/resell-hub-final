/**
 * Real behavioral tests for TavilyWebSearchProvider (Global Web Sourcing,
 * Phase 2 PoC). Never calls the real Tavily endpoint — global.fetch is
 * mocked throughout, matching the convention already used for
 * EbayApplicationTokenManager.test.ts / EbayBrowseSourcingProvider.test.ts.
 * Proves the provider only ever returns what a mocked response actually
 * contained (no fabricated field), fails cleanly when not configured, and
 * never leaks the API key into any log/error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TavilyWebSearchProvider } from '@/services/websourcing/providers/TavilyWebSearchProvider';

const FAKE_KEY = 'tvly-test-secret-do-not-leak-12345';

function jsonResponse(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as any;
}

describe('TavilyWebSearchProvider', () => {
  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.TAVILY_API_KEY;
  });

  describe('isConfigured', () => {
    it('is false when TAVILY_API_KEY is not set', () => {
      expect(new TavilyWebSearchProvider().isConfigured()).toBe(false);
    });

    it('is true once TAVILY_API_KEY is set', () => {
      process.env.TAVILY_API_KEY = FAKE_KEY;
      expect(new TavilyWebSearchProvider().isConfigured()).toBe(true);
    });
  });

  describe('search — provider not configured', () => {
    it('fails cleanly with an auth error, never throws, never calls fetch', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const outcome = await new TavilyWebSearchProvider().search({ query: 'Nike Tech Fleece' });

      expect(outcome.results).toEqual([]);
      expect(outcome.error).toEqual({
        provider: 'tavily',
        kind: 'auth',
        message: 'TAVILY_API_KEY is not configured',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('search — valid response', () => {
    beforeEach(() => {
      process.env.TAVILY_API_KEY = FAKE_KEY;
    });

    it('returns multiple results with every real field preserved, plus a derived domain', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          results: [
            {
              title: 'Louis Vuitton Nano Speedy - Vestiaire Collective',
              url: 'https://www.vestiairecollective.com/item/123',
              content: 'Louis Vuitton Nano Speedy handbag, excellent condition, 250 EUR.',
              score: 0.87,
              published_date: '2026-08-01',
              id: 'hit-1',
            },
            {
              title: 'LV Nano Speedy for sale',
              url: 'https://www.therealreal.com/products/456',
              content: 'Authentic Louis Vuitton Nano Speedy, priced at 275 EUR.',
              score: 0.81,
              published_date: '',
              id: 'hit-2',
            },
          ],
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      const outcome = await new TavilyWebSearchProvider().search({ query: 'Louis Vuitton Nano Speedy 200-300 EUR' });

      expect(outcome.error).toBeUndefined();
      expect(outcome.results).toHaveLength(2);

      expect(outcome.results[0]).toEqual({
        title: 'Louis Vuitton Nano Speedy - Vestiaire Collective',
        url: 'https://www.vestiairecollective.com/item/123',
        content: 'Louis Vuitton Nano Speedy handbag, excellent condition, 250 EUR.',
        score: 0.87,
        publishedDate: '2026-08-01',
        id: 'hit-1',
        domain: 'www.vestiairecollective.com',
      });

      // Empty published_date ("") is normalized to undefined — never
      // displayed/parsed as if it were a real date.
      expect(outcome.results[1].publishedDate).toBeUndefined();
      expect(outcome.results[1].domain).toBe('www.therealreal.com');
    });

    it('sends the query and maxResults in the real Tavily request shape, with Bearer auth', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
      vi.stubGlobal('fetch', fetchMock);

      await new TavilyWebSearchProvider().search({ query: 'Nike Tech Fleece black L', maxResults: 5 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.tavily.com/search');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
      expect(JSON.parse(init.body)).toEqual({ query: 'Nike Tech Fleece black L', max_results: 5 });
    });
  });

  describe('search — partial / incomplete responses', () => {
    beforeEach(() => {
      process.env.TAVILY_API_KEY = FAKE_KEY;
    });

    it('an empty results array is a valid, successful outcome — never an error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ results: [] })));

      const outcome = await new TavilyWebSearchProvider().search({ query: 'vintage designer leather jacket' });

      expect(outcome.error).toBeUndefined();
      expect(outcome.results).toEqual([]);
    });

    it('a result missing score/published_date/id keeps only the real fields — never invents them', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            results: [
              {
                title: 'Vintage leather jacket',
                url: 'https://example.com/listing/1',
                content: 'A vintage designer leather jacket.',
                // score, published_date, id all absent
              },
            ],
          })
        )
      );

      const outcome = await new TavilyWebSearchProvider().search({ query: 'vintage designer leather jacket' });

      expect(outcome.results).toHaveLength(1);
      const result = outcome.results[0];
      expect(result.title).toBe('Vintage leather jacket');
      expect(result.url).toBe('https://example.com/listing/1');
      expect(result.content).toBe('A vintage designer leather jacket.');
      expect(result.score).toBeUndefined();
      expect(result.publishedDate).toBeUndefined();
      expect(result.id).toBeUndefined();
      // domain is still mechanically derivable even with no other metadata.
      expect(result.domain).toBe('example.com');
    });

    it('a result missing a required field (title/url/content) is skipped, never replaced with an invented value — other valid results are still returned', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            results: [
              { title: 'Missing URL', content: 'no url here' },
              { url: 'https://example.com/no-title', content: 'no title here' },
              { title: 'Missing content field', url: 'https://example.com/no-content' },
              {
                title: 'Fully valid result',
                url: 'https://example.com/valid',
                content: 'This one has everything required.',
              },
            ],
          })
        )
      );

      const outcome = await new TavilyWebSearchProvider().search({ query: 'test' });

      expect(outcome.error).toBeUndefined();
      expect(outcome.results).toHaveLength(1);
      expect(outcome.results[0].title).toBe('Fully valid result');
    });
  });

  describe('search — HTTP errors', () => {
    beforeEach(() => {
      process.env.TAVILY_API_KEY = FAKE_KEY;
    });

    it('401 -> kind "auth", real message from the response body when present', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'Invalid API key' }, 401)));

      const outcome = await new TavilyWebSearchProvider().search({ query: 'test' });

      expect(outcome.results).toEqual([]);
      expect(outcome.error).toEqual({ provider: 'tavily', kind: 'auth', message: 'Invalid API key' });
    });

    it('429 -> kind "rate_limit"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 429)));

      const outcome = await new TavilyWebSearchProvider().search({ query: 'test' });

      expect(outcome.error?.kind).toBe('rate_limit');
    });

    it('500 -> kind "upstream_error", falls back to a generic status-based message when the body has none', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => {
            throw new Error('not json');
          },
        } as any)
      );

      const outcome = await new TavilyWebSearchProvider().search({ query: 'test' });

      expect(outcome.error).toEqual({
        provider: 'tavily',
        kind: 'upstream_error',
        message: 'Tavily search request failed with status 500',
      });
    });
  });

  describe('search — timeout', () => {
    beforeEach(() => {
      process.env.TAVILY_API_KEY = FAKE_KEY;
    });

    it('a request timeout -> kind "timeout", never throws', async () => {
      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'TimeoutError';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

      const outcome = await new TavilyWebSearchProvider().search({ query: 'test' });

      expect(outcome.results).toEqual([]);
      expect(outcome.error).toEqual({
        provider: 'tavily',
        kind: 'timeout',
        message: 'Tavily search request timed out',
      });
    });
  });

  describe('search — invalid JSON', () => {
    beforeEach(() => {
      process.env.TAVILY_API_KEY = FAKE_KEY;
    });

    it('a 200 response whose body is not valid JSON -> kind "invalid_response", never throws', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('Unexpected token in JSON');
          },
        } as any)
      );

      const outcome = await new TavilyWebSearchProvider().search({ query: 'test' });

      expect(outcome.results).toEqual([]);
      expect(outcome.error?.kind).toBe('invalid_response');
    });

    it('a 200 response with no "results" array at all -> kind "invalid_response"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ answer: 'something but no results field' })));

      const outcome = await new TavilyWebSearchProvider().search({ query: 'test' });

      expect(outcome.error?.kind).toBe('invalid_response');
    });
  });

  describe('secret handling', () => {
    beforeEach(() => {
      process.env.TAVILY_API_KEY = FAKE_KEY;
    });

    it('never includes the API key in a thrown/returned error message across every failure path', async () => {
      const scenarios: Array<() => Promise<any>> = [
        async () => {
          vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
          return new TavilyWebSearchProvider().search({ query: 'test' });
        },
        async () => {
          vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`failed near key ${FAKE_KEY}`)));
          return new TavilyWebSearchProvider().search({ query: 'test' });
        },
      ];

      for (const run of scenarios) {
        const outcome = await run();
        expect(JSON.stringify(outcome)).not.toContain(FAKE_KEY);
      }
    });

    it('never logs the API key via console output', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
      await new TavilyWebSearchProvider().search({ query: 'test' });

      const allCalls = [...consoleSpy.mock.calls, ...consoleWarnSpy.mock.calls, ...consoleLogSpy.mock.calls];
      for (const call of allCalls) {
        expect(JSON.stringify(call)).not.toContain(FAKE_KEY);
      }

      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
  });
});
