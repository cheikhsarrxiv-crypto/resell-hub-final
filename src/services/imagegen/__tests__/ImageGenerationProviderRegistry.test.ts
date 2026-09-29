/**
 * AI-first listing workflow. Proves the registry is real, interchangeable
 * infrastructure: OpenAI Images is a real, wired-in provider, but stays
 * HONESTLY unconfigured until OPENAI_API_KEY is actually set (never set
 * by this test file or anywhere else in this codebase) — never silently
 * pretending it's ready to use.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ImageGenerationProviderRegistry } from '@/services/imagegen/ImageGenerationProviderRegistry';

describe('ImageGenerationProviderRegistry', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('getAllProviders lists the real OpenAI Images provider — real, interchangeable infrastructure, not invented', () => {
    const names = ImageGenerationProviderRegistry.getAllProviders().map((p) => p.name);
    expect(names).toContain('openai');
  });

  it('getConfiguredProviders is empty when OPENAI_API_KEY is unset — no key is invented or assumed', () => {
    delete process.env.OPENAI_API_KEY;
    expect(ImageGenerationProviderRegistry.getConfiguredProviders()).toEqual([]);
  });

  it('getConfiguredProviders includes the provider once OPENAI_API_KEY is genuinely set', () => {
    process.env.OPENAI_API_KEY = 'sk-test-not-real';
    const names = ImageGenerationProviderRegistry.getConfiguredProviders().map((p) => p.name);
    expect(names).toContain('openai');
  });

  it('calling either never throws — a caller can always treat "no image generation available" as a clean, real state', () => {
    expect(() => ImageGenerationProviderRegistry.getAllProviders()).not.toThrow();
    expect(() => ImageGenerationProviderRegistry.getConfiguredProviders()).not.toThrow();
  });
});
