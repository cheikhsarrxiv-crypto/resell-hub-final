/**
 * Real behavioral tests for NoopQueryExpansionService — the deliberately
 * unwired Global Sourcing Engine query-expansion stub. Nothing calls this
 * service in the app yet (see the class's own comment for why); these
 * tests only prove the stub itself never fabricates a translation or
 * synonym.
 */
import { describe, it, expect } from 'vitest';
import { NoopQueryExpansionService } from '@/services/sourcing/QueryExpansionService';

describe('NoopQueryExpansionService', () => {
  it('returns the original query unchanged', async () => {
    const service = new NoopQueryExpansionService();
    const result = await service.expand('Prada sneakers');
    expect(result.original).toBe('Prada sneakers');
  });

  it('never invents a variant — variants is always empty', async () => {
    const service = new NoopQueryExpansionService();
    const result = await service.expand('Prada sneakers');
    expect(result.variants).toEqual([]);
  });

  it('an empty string query is returned as-is, not rejected or altered', async () => {
    const service = new NoopQueryExpansionService();
    const result = await service.expand('');
    expect(result.original).toBe('');
    expect(result.variants).toEqual([]);
  });
});
