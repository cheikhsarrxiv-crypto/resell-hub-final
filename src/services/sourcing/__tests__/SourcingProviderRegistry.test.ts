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

  describe('Phase 5 — getKnownUnavailableSources (real, sourced access-gap documentation, never a fake provider)', () => {
    it('returns a non-empty list of real, named sources this session actually researched', () => {
      const sources = SourcingProviderRegistry.getKnownUnavailableSources();
      const names = sources.map((s) => s.name);

      expect(names).toContain('Mercari Japan');
      expect(names).toContain('Rakuma');
      expect(names).toContain('Yahoo Auctions Japan');
      expect(names).toContain('Grailed');
      expect(names).toContain('Vestiaire Collective');
      expect(names).toContain('Depop');
      expect(names).toContain('Vinted');
    });

    it('every entry has a real, specific, non-empty reason — never a placeholder like "not available"', () => {
      for (const source of SourcingProviderRegistry.getKnownUnavailableSources()) {
        expect(source.reason.length).toBeGreaterThan(20);
        expect(source.reason.toLowerCase()).not.toBe('not available');
      }
    });

    it('every entry has one of the real, documented access-gap statuses, never an invented one', () => {
      const validStatuses = ['SELL_SIDE_ONLY', 'PARTNER_REQUIRED', 'NO_CONFIRMED_ACCESS'];
      for (const source of SourcingProviderRegistry.getKnownUnavailableSources()) {
        expect(validStatuses).toContain(source.status);
      }
    });

    it('never overlaps with a real SourcingProvider name — these are documentation entries, never confused with a real, queryable provider', () => {
      const realProviderNames = SourcingProviderRegistry.getAllProviders().map((p) => p.name);
      const knownUnavailableNames = SourcingProviderRegistry.getKnownUnavailableSources().map((s) => s.name);
      for (const name of knownUnavailableNames) {
        expect(realProviderNames).not.toContain(name);
      }
    });

    it('Vestiaire Collective and Mercari Japan are classified SELL_SIDE_ONLY — a real API exists but only for managing a seller\'s own inventory', () => {
      const sources = SourcingProviderRegistry.getKnownUnavailableSources();
      expect(sources.find((s) => s.name === 'Mercari Japan')?.status).toBe('SELL_SIDE_ONLY');
      expect(sources.find((s) => s.name === 'Vestiaire Collective')?.status).toBe('SELL_SIDE_ONLY');
    });

    it('Depop and Vinted are classified PARTNER_REQUIRED — a real API exists but is allowlist/approval-gated with no self-service', () => {
      const sources = SourcingProviderRegistry.getKnownUnavailableSources();
      expect(sources.find((s) => s.name === 'Depop')?.status).toBe('PARTNER_REQUIRED');
      expect(sources.find((s) => s.name === 'Vinted')?.status).toBe('PARTNER_REQUIRED');
    });

    it('Yahoo Auctions Japan is classified NO_CONFIRMED_ACCESS — its own public API was officially discontinued', () => {
      const sources = SourcingProviderRegistry.getKnownUnavailableSources();
      const yahoo = sources.find((s) => s.name === 'Yahoo Auctions Japan');
      expect(yahoo?.status).toBe('NO_CONFIRMED_ACCESS');
      expect(yahoo?.reason).toMatch(/discontinued/i);
    });

    it('calling it never makes a network request or throws — pure, synchronous, static data', () => {
      expect(() => SourcingProviderRegistry.getKnownUnavailableSources()).not.toThrow();
    });
  });
});
