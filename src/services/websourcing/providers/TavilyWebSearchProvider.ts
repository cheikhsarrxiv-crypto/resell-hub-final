import { createLogger } from '@/lib/logger';
import { WebSearchProvider, WebSearchProviderErrorInfo, WebSearchOutcome, WebSearchQuery, WebSearchResult } from '../types';

const logger = createLogger('tavily-web-search-provider');

/**
 * Global Web Sourcing — Phase 2 PoC.
 *
 * Verified directly against Tavily's own official JS SDK source
 * (@tavily/core, npm registry, v0.7.13 at the time of writing — docs.tavily.com
 * itself was unreachable from this environment's network, so the SDK's
 * real, shipped request-building code was read instead, not a
 * third-party summary):
 *   - Endpoint: POST https://api.tavily.com/search
 *   - Auth: header `Authorization: Bearer <TAVILY_API_KEY>`
 *   - Request body (snake_case): { query, search_depth, max_results, ... }
 *   - Response: { results: [{ title, url, content, score, published_date,
 *     raw_content?, favicon?, id }], ... }
 *
 * Deliberately calls the REST API directly via fetch() rather than
 * depending on the @tavily/core package — same pattern already used for
 * every other real HTTP-based provider in this codebase (see
 * EbayApplicationTokenManager.ts, EbayBrowseSourcingProvider.ts,
 * EtsySourcingProvider.ts): one fewer third-party dependency, and the
 * exact request/response shape stays fully visible and auditable here
 * rather than hidden behind an SDK's own internal mapping.
 *
 * Uses its OWN dedicated env var (TAVILY_API_KEY) — never shared with,
 * or confused with, any other provider's credentials.
 */
const SEARCH_ENDPOINT = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 15_000;

/** Raw shape Tavily's REST API actually returns for one result — read defensively, never trusted as fully present. */
interface RawTavilyResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
  published_date?: unknown;
  id?: unknown;
}

interface RawTavilyResponse {
  results?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * NOT a Tavily field — a mechanical, deterministic parse of `url`'s own
 * hostname, nothing inferred. Returns undefined only when `url` itself
 * cannot be parsed as a URL at all (never a guessed domain).
 */
function deriveDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Converts one raw Tavily result into WebSearchResult, or returns null
 * when the item is missing a field this PoC treats as the minimum
 * required to be a usable result at all (title/url/content — matching
 * Tavily's own documented type, where these are never optional). A
 * malformed/unusable item is skipped, never papered over with an
 * invented empty value — see the caller for how skipped items are
 * surfaced (never silently, and never by inflating the count of "real"
 * results).
 */
function toWebSearchResult(raw: RawTavilyResult): WebSearchResult | null {
  if (!isNonEmptyString(raw.title) || !isNonEmptyString(raw.url) || typeof raw.content !== 'string') {
    return null;
  }

  const result: WebSearchResult = {
    title: raw.title,
    url: raw.url,
    content: raw.content,
  };

  if (typeof raw.score === 'number' && Number.isFinite(raw.score)) {
    result.score = raw.score;
  }

  // Tavily reports "" for "no known publish date" — normalized to
  // undefined (see WebSearchResult's own comment); any other non-empty
  // string is passed through exactly as given, never parsed as a Date.
  if (isNonEmptyString(raw.published_date)) {
    result.publishedDate = raw.published_date;
  }

  if (isNonEmptyString(raw.id)) {
    result.id = raw.id;
  }

  const domain = deriveDomain(raw.url);
  if (domain) {
    result.domain = domain;
  }

  return result;
}

function errorOutcome(kind: WebSearchProviderErrorInfo['kind'], message: string): WebSearchOutcome {
  return { results: [], error: { provider: 'tavily', kind, message } };
}

export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly name = 'tavily';
  readonly displayName = 'Tavily';

  isConfigured(): boolean {
    return Boolean(process.env.TAVILY_API_KEY);
  }

  async search(query: WebSearchQuery): Promise<WebSearchOutcome> {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
      // Fails cleanly — never throws, never logs the (absent) key.
      return errorOutcome('auth', 'TAVILY_API_KEY is not configured');
    }

    let response: Response;
    try {
      response = await fetch(SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: query.query,
          max_results: query.maxResults,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        logger.warn('Tavily search request timed out');
        return errorOutcome('timeout', 'Tavily search request timed out');
      }
      // Never logs the raw error object as-is: a network error can, in
      // principle, echo request details. Only its message (never headers,
      // never the request body/key) is logged.
      logger.error(
        'Tavily search request failed before a response was received',
        error instanceof Error ? error.message : String(error)
      );
      return errorOutcome('unknown', 'Tavily search request failed unexpectedly');
    }

    if (!response.ok) {
      // Never reads/logs response headers (could echo request context) —
      // only the status code, and the body's own message field if JSON,
      // never the raw body text (which could, in principle, echo back
      // part of the request).
      const kind: WebSearchProviderErrorInfo['kind'] =
        response.status === 401 || response.status === 403
          ? 'auth'
          : response.status === 429
            ? 'rate_limit'
            : 'upstream_error';

      let message = `Tavily search request failed with status ${response.status}`;
      try {
        const body = (await response.json()) as { message?: unknown; detail?: unknown };
        const reported = body?.message ?? body?.detail;
        if (isNonEmptyString(reported)) {
          message = reported;
        }
      } catch {
        // Body wasn't valid JSON — the generic status-based message above
        // is kept, never a guess at what the body might have said.
      }

      logger.warn('Tavily search request was rejected', { status: response.status, kind });
      return errorOutcome(kind, message);
    }

    let parsed: RawTavilyResponse;
    try {
      parsed = (await response.json()) as RawTavilyResponse;
    } catch (error) {
      logger.error(
        'Tavily search returned a response that was not valid JSON',
        error instanceof Error ? error.message : String(error)
      );
      return errorOutcome('invalid_response', 'Tavily search returned a response that was not valid JSON');
    }

    if (!Array.isArray(parsed.results)) {
      logger.error('Tavily search response had no "results" array');
      return errorOutcome('invalid_response', 'Tavily search response did not contain a results array');
    }

    const results: WebSearchResult[] = [];
    for (const raw of parsed.results as RawTavilyResult[]) {
      const converted = toWebSearchResult(raw ?? {});
      if (converted) {
        results.push(converted);
      } else {
        // A single malformed item never fails the whole search — it is
        // dropped and logged (no secret, no request data, just the fact
        // that one item was unusable), and every other valid item is
        // still returned.
        logger.warn('Skipped one Tavily result missing a required field (title/url/content)');
      }
    }

    return { results };
  }
}

export default TavilyWebSearchProvider;
