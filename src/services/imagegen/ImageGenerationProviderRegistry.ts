import { ImageGenerationProvider } from './types';

/**
 * AI-first listing workflow — deliberately returns an EMPTY list today.
 * This project's own audit found no image-generation API configured and
 * no provider decided (OpenAI Images, Stability, etc.) — rather than
 * invent one, this registry exists purely as the interchangeable slot a
 * real provider will be added to later (one entry here, nothing else in
 * the app changes — the exact same pattern as
 * SourcingProviderRegistry/WebSearchProviderRegistry).
 *
 * No Agent tool is registered against this yet either (see
 * AiToolRegistry's own header comment: "only tools with a real backend
 * handler are registered... never registered with a fake handler that
 * pretends to work") — a tool that always returns "not configured" would
 * still reserve/bill AI Units for a call that can never provide value,
 * which this project's own AI Units audit ruled out.
 */
export class ImageGenerationProviderRegistry {
  static getAllProviders(): ImageGenerationProvider[] {
    return [];
  }

  static getConfiguredProviders(): ImageGenerationProvider[] {
    return this.getAllProviders().filter((provider) => provider.isConfigured());
  }
}

export default ImageGenerationProviderRegistry;
