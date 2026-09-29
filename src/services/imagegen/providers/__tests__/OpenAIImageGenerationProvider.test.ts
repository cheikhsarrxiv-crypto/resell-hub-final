/**
 * Real behavioral tests for OpenAIImageGenerationProvider. Never calls
 * the real OpenAI endpoint: global.fetch is mocked (same convention as
 * EtsySourcingProvider.test.ts/TavilyWebSearchProvider's own tests).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIImageGenerationProvider } from '@/services/imagegen/providers/OpenAIImageGenerationProvider';

function generationResponse(urls: string[]) {
  return { ok: true, status: 200, json: async () => ({ data: urls.map((url) => ({ url })) }) } as any;
}

describe('OpenAIImageGenerationProvider.isConfigured', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('reflects whether OPENAI_API_KEY is set', () => {
    delete process.env.OPENAI_API_KEY;
    expect(new OpenAIImageGenerationProvider().isConfigured()).toBe(false);

    process.env.OPENAI_API_KEY = 'sk-real-key';
    expect(new OpenAIImageGenerationProvider().isConfigured()).toBe(true);
  });
});

describe('OpenAIImageGenerationProvider.generate', () => {
  let provider: OpenAIImageGenerationProvider;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'sk-real-key';
    provider = new OpenAIImageGenerationProvider();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('a successful generation returns the real image URL with full provenance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(generationResponse(['https://oaidalleapi.example/img1.png'])));

    const outcome = await provider.generate({ prompt: 'A black leather jacket, product photo, neutral background' });

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.image.url).toBe('https://oaidalleapi.example/img1.png');
      expect(outcome.image.provider).toBe('openai');
      expect(outcome.image.model).toBe('dall-e-3');
      expect(outcome.image.prompt).toBe('A black leather jacket, product photo, neutral background');
      expect(outcome.image.generatedAt).toBeTruthy();
    }
  });

  it('sends the exact prompt given, never a modified/embellished one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(generationResponse(['https://x.example/1.png']));
    vi.stubGlobal('fetch', fetchMock);

    await provider.generate({ prompt: 'exact prompt text' });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.prompt).toBe('exact prompt text');
  });

  it('sends the Bearer OPENAI_API_KEY header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(generationResponse(['https://x.example/1.png']));
    vi.stubGlobal('fetch', fetchMock);

    await provider.generate({ prompt: 'x' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sk-real-key');
  });

  it('OPENAI_API_KEY missing at call time -> structured not_configured error, no fetch attempted', async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await provider.generate({ prompt: 'x' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') expect(outcome.error.kind).toBe('not_configured');
  });

  it('a 401 from OpenAI is classified as not_configured (an invalid/revoked key), never a fabricated image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API key' } }) }));
    const outcome = await provider.generate({ prompt: 'x' });
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.error.kind).toBe('not_configured');
      expect(outcome.error.message).toBe('Invalid API key');
    }
  });

  it('a 429 from OpenAI is classified as rate_limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    const outcome = await provider.generate({ prompt: 'x' });
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') expect(outcome.error.kind).toBe('rate_limit');
  });

  it('a 500 from OpenAI is classified as upstream_error, never a fabricated image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const outcome = await provider.generate({ prompt: 'x' });
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') expect(outcome.error.kind).toBe('upstream_error');
  });

  it('a response with no usable image URL never fabricates one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{}] }) }));
    const outcome = await provider.generate({ prompt: 'x' });
    expect(outcome.status).toBe('error');
  });

  it('a request timeout is classified as timeout, never a fabricated image', async () => {
    const timeoutError = new Error('aborted');
    timeoutError.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

    const outcome = await provider.generate({ prompt: 'x' });

    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') expect(outcome.error.kind).toBe('timeout');
  });

  it('a malformed (non-JSON) response never fabricates an image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }));
    const outcome = await provider.generate({ prompt: 'x' });
    expect(outcome.status).toBe('error');
  });
});
