import { ImageGenerationProvider } from './types';
import { OpenAIImageGenerationProvider } from './providers/OpenAIImageGenerationProvider';

/**
 * AI-first listing workflow — real, interchangeable provider registry,
 * same pattern as SourcingProviderRegistry/WebSearchProviderRegistry.
 *
 * OpenAI Images (dall-e-3) is the one real provider wired in (see
 * OpenAIImageGenerationProvider's own header for exactly why it was
 * chosen and how it was verified) — but OPENAI_API_KEY is NOT set
 * anywhere in this codebase or by any test, so isConfigured() reports
 * false until an operator sets it, exactly like TAVILY_API_KEY for web
 * sourcing. Adding a second provider later means adding one entry here,
 * nothing else in the app changes.
 */
export class ImageGenerationProviderRegistry {
  static getAllProviders(): ImageGenerationProvider[] {
    return [new OpenAIImageGenerationProvider()];
  }

  static getConfiguredProviders(): ImageGenerationProvider[] {
    return this.getAllProviders().filter((provider) => provider.isConfigured());
  }
}

export default ImageGenerationProviderRegistry;
