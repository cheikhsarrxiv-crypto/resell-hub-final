import { WebSearchProvider } from './types';
import { TavilyWebSearchProvider } from './providers/TavilyWebSearchProvider';

/**
 * Global Web Sourcing — Phase 2 PoC. Same shape and same rule as
 * src/services/sourcing/SourcingProviderRegistry.ts: adding a provider
 * means adding one entry here, nothing else changes. Exactly one
 * provider today (Tavily) — this file exists now so a second provider
 * later is a one-line addition, not a refactor.
 */
export class WebSearchProviderRegistry {
  /** Every web search provider ADKSY knows about, real or not-yet-configured. */
  static getAllProviders(): WebSearchProvider[] {
    return [new TavilyWebSearchProvider()];
  }

  /** Subset of getAllProviders() whose isConfigured() is currently true. */
  static getConfiguredProviders(): WebSearchProvider[] {
    return this.getAllProviders().filter((provider) => provider.isConfigured());
  }
}

export default WebSearchProviderRegistry;
