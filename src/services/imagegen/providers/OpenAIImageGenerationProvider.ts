import { createLogger } from '@/lib/logger';
import { ImageGenerationProvider, ImageGenerationRequest, ImageGenerationOutcome, ImageGenerationErrorInfo } from '../types';

const logger = createLogger('openai-image-generation-provider');

/**
 * AI-first listing workflow — the real image-generation provider chosen
 * for this project's interchangeable ImageGenerationProvider slot (see
 * this project's own audit: no image-generation capability existed
 * anywhere before this, and no provider was invented — OpenAI's Images
 * API is a real, publicly documented, single-API-key REST endpoint,
 * chosen the same way Tavily was chosen for web sourcing).
 *
 * Endpoint/response verified against OpenAI's own published API
 * reference (platform.openai.com/docs/api-reference/images):
 *   - POST https://api.openai.com/v1/images/generations
 *   - Auth: header `Authorization: Bearer <OPENAI_API_KEY>`
 *   - Body: { model: "dall-e-3", prompt, n: 1, size, response_format: "url" }
 *   - Response: { data: [{ url }] }
 *
 * Deliberately calls the REST API directly via fetch() rather than
 * adding the `openai` npm package as a dependency — same "no SDK, one
 * fewer dependency, the real request/response shape stays fully visible
 * here" reasoning already applied to TavilyWebSearchProvider/
 * EbayBrowseSourcingProvider.
 *
 * dall-e-3 (not gpt-image-1) with response_format: "url" is used
 * specifically because it returns a real, provider-hosted URL directly
 * — gpt-image-1 only returns base64 image data, which would need this
 * project to download and re-host it before it could be used as a URL
 * at all. KNOWN LIMITATION (documented, not hidden): OpenAI's own docs
 * state a dall-e-3 image URL is only valid for about one hour — fine for
 * an immediate draft preview, but a real product would need to be
 * downloaded and re-hosted (e.g. via StorageService) before publishing
 * if more than an hour passes. That re-hosting step is intentionally
 * NOT built here (out of this phase's scope) — see this file's own
 * caller (generate_listing_draft_image) for how this is surfaced
 * honestly rather than silently.
 *
 * Uses its OWN dedicated env var (OPENAI_API_KEY) — never shared with
 * or confused with any other provider's credentials.
 */
const GENERATIONS_ENDPOINT = 'https://api.openai.com/v1/images/generations';
const REQUEST_TIMEOUT_MS = 60_000; // image generation is real work, slower than a text/search call
const MODEL = 'dall-e-3';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function errorOutcome(kind: ImageGenerationErrorInfo['kind'], message: string): ImageGenerationOutcome {
  return { status: 'error', error: { provider: 'openai', kind, message } };
}

export class OpenAIImageGenerationProvider implements ImageGenerationProvider {
  readonly name = 'openai';
  readonly displayName = 'OpenAI Images';

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationOutcome> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // Fails cleanly — never throws, never logs the (absent) key.
      return errorOutcome('not_configured', 'OPENAI_API_KEY is not configured');
    }

    let response: Response;
    try {
      response = await fetch(GENERATIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          prompt: request.prompt,
          n: 1,
          size: '1024x1024',
          response_format: 'url',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        logger.warn('OpenAI image generation request timed out');
        return errorOutcome('timeout', 'OpenAI image generation request timed out');
      }
      // Never logs the raw error object as-is — only its message, never
      // headers, never the request body/key/prompt.
      logger.error(
        'OpenAI image generation request failed before a response was received',
        error instanceof Error ? error.message : String(error)
      );
      return errorOutcome('unknown', 'OpenAI image generation request failed unexpectedly');
    }

    if (!response.ok) {
      const kind: ImageGenerationErrorInfo['kind'] =
        response.status === 401 || response.status === 403
          ? 'not_configured'
          : response.status === 429
            ? 'rate_limit'
            : 'upstream_error';

      let message = `OpenAI image generation request failed with status ${response.status}`;
      try {
        const body = (await response.json()) as { error?: { message?: unknown } };
        const reported = body?.error?.message;
        if (isNonEmptyString(reported)) {
          message = reported;
        }
      } catch {
        // Body wasn't valid JSON — the generic status-based message above is kept.
      }

      logger.warn('OpenAI image generation request was rejected', { status: response.status, kind });
      return errorOutcome(kind, message);
    }

    let parsed: { data?: unknown };
    try {
      parsed = (await response.json()) as { data?: unknown };
    } catch (error) {
      logger.error(
        'OpenAI image generation returned a response that was not valid JSON',
        error instanceof Error ? error.message : String(error)
      );
      return errorOutcome('upstream_error', 'OpenAI image generation returned a response that was not valid JSON');
    }

    const first = Array.isArray(parsed.data) ? (parsed.data[0] as { url?: unknown } | undefined) : undefined;
    if (!first || !isNonEmptyString(first.url)) {
      logger.error('OpenAI image generation response had no usable image URL');
      return errorOutcome('upstream_error', 'OpenAI image generation response contained no image URL');
    }

    return {
      status: 'ok',
      image: {
        url: first.url,
        provider: this.name,
        model: MODEL,
        prompt: request.prompt,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

export default OpenAIImageGenerationProvider;
