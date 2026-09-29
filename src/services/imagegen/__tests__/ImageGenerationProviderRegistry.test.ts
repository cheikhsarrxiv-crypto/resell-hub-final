/**
 * AI-first listing workflow — Phase 1 (architecture only). Proves the
 * registry is real, interchangeable infrastructure that is HONESTLY empty
 * today (no image-generation API/key was invented — see this module's
 * own header comment) rather than silently pretending a provider exists.
 */
import { describe, it, expect } from 'vitest';
import { ImageGenerationProviderRegistry } from '@/services/imagegen/ImageGenerationProviderRegistry';

describe('ImageGenerationProviderRegistry', () => {
  it('getAllProviders returns an empty list — no provider is configured or invented in this version', () => {
    expect(ImageGenerationProviderRegistry.getAllProviders()).toEqual([]);
  });

  it('getConfiguredProviders is consequently also empty', () => {
    expect(ImageGenerationProviderRegistry.getConfiguredProviders()).toEqual([]);
  });

  it('calling either never throws — a caller can always treat "no image generation available" as a clean, real state', () => {
    expect(() => ImageGenerationProviderRegistry.getAllProviders()).not.toThrow();
    expect(() => ImageGenerationProviderRegistry.getConfiguredProviders()).not.toThrow();
  });
});
