/**
 * Real behavioral tests for SourcingProviderRegistry — the explicit
 * provider list SourcingService now depends on (Phase 2), extracted out
 * of what was a private function inside SourcingService.ts. No mocking:
 * these are the real provider classes, real metadata.
 */
import { describe, it, expect } from 'vitest';
import { SourcingProviderRegistry } from '@/services/sourcing/SourcingProviderRegistry';

describe('SourcingProviderRegistry', () => {
  it('getAllProviders returns every provider ADKSY knows about, real or not-yet-configured', () => {
    const providers = SourcingProviderRegistry.getAllProviders();
    const names = providers.map((p) => p.name);
    expect(names).toContain('ebay');
    expect(names).toContain('etsy');
  });

  it('real, honest, non-empty metadata for every provider (name/displayName/capabilities) — never a placeholder', () => {
    for (const provider of SourcingProviderRegistry.getAllProviders()) {
      expect(provider.name.length).toBeGreaterThan(0);
      expect(provider.displayName.length).toBeGreaterThan(0);
      expect(Array.isArray(provider.capabilities)).toBe(true);
      // isConfigured must never throw just from being asked, regardless
      // of whether credentials are actually present in this environment.
      expect(() => provider.isConfigured()).not.toThrow();
    }
  });

  it('never declares a capability twice for the same provider (a real, deliberate set, not an accidental duplicate)', () => {
    for (const provider of SourcingProviderRegistry.getAllProviders()) {
      expect(new Set(provider.capabilities).size).toBe(provider.capabilities.length);
    }
  });

  it('getConfiguredProviders is a strict subset of getAllProviders, filtered by isConfigured()', () => {
    const all = SourcingProviderRegistry.getAllProviders();
    const configured = SourcingProviderRegistry.getConfiguredProviders();

    for (const provider of configured) {
      expect(all.map((p) => p.name)).toContain(provider.name);
      expect(provider.isConfigured()).toBe(true);
    }
  });

  it('is not workspace-scoped: takes no arguments, returns the exact same provider set on every call — provider configuration is global (operator env vars), never per-workspace', () => {
    const first = SourcingProviderRegistry.getAllProviders().map((p) => p.name);
    const second = SourcingProviderRegistry.getAllProviders().map((p) => p.name);
    expect(first).toEqual(second);
  });
});
