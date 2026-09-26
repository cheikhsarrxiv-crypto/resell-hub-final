import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSearchProviderRegistry } from '@/services/websourcing/WebSearchProviderRegistry';

describe('WebSearchProviderRegistry', () => {
  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
  });

  afterEach(() => {
    delete process.env.TAVILY_API_KEY;
  });

  it('getAllProviders lists tavily, whether configured or not', () => {
    const providers = WebSearchProviderRegistry.getAllProviders();
    expect(providers.map((p) => p.name)).toEqual(['tavily']);
  });

  it('getConfiguredProviders is empty when TAVILY_API_KEY is unset', () => {
    expect(WebSearchProviderRegistry.getConfiguredProviders()).toEqual([]);
  });

  it('getConfiguredProviders includes tavily once TAVILY_API_KEY is set', () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const configured = WebSearchProviderRegistry.getConfiguredProviders();
    expect(configured.map((p) => p.name)).toEqual(['tavily']);
  });
});
