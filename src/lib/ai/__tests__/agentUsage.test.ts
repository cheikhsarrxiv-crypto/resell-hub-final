/**
 * Same testing pattern as fetchConversationHistory in
 * agentConversation.test.ts — see that file's own describe block.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAgentUsage, isUsageLimitReached, type AgentUsageSnapshot } from '@/lib/ai/agentUsage';

describe('fetchAgentUsage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a successful response with a real snapshot returns it as-is', async () => {
    const snapshot: AgentUsageSnapshot = {
      unitsConsumed: 10,
      unitsReserved: 0,
      unitsLimit: 50,
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-02-01T00:00:00.000Z',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, usage: snapshot }) }));

    const outcome = await fetchAgentUsage();

    expect(outcome).toEqual({ status: 'ok', usage: snapshot });
  });

  it('a successful response with usage: null (period/limit unresolvable) is "ok" with a null snapshot, never an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, usage: null }) }));

    const outcome = await fetchAgentUsage();

    expect(outcome).toEqual({ status: 'ok', usage: null });
  });

  it('requests exactly /api/ai/agent/usage, no query parameters, no workspaceId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, usage: null }) });
    vi.stubGlobal('fetch', fetchMock);

    await fetchAgentUsage();

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/agent/usage');
  });

  it('a non-ok response maps to a plain error, never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'refused' }) }));

    const outcome = await fetchAgentUsage();

    expect(outcome).toEqual({ status: 'error' });
  });

  it('a malformed snapshot body (missing fields) maps to an error rather than a half-populated object', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, usage: { unitsConsumed: 1 } }) }));

    const outcome = await fetchAgentUsage();

    expect(outcome).toEqual({ status: 'error' });
  });

  it('a network-level failure (fetch itself throws) maps to an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const outcome = await fetchAgentUsage();

    expect(outcome).toEqual({ status: 'error' });
  });

  it('a malformed JSON body never crashes the whole call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }));

    await expect(fetchAgentUsage()).resolves.not.toThrow();
  });
});

describe('isUsageLimitReached', () => {
  it('false while consumed+reserved is below the limit', () => {
    expect(isUsageLimitReached({ unitsConsumed: 10, unitsReserved: 5, unitsLimit: 50, periodStart: '', periodEnd: '' })).toBe(false);
  });

  it('true once consumed+reserved equals the limit', () => {
    expect(isUsageLimitReached({ unitsConsumed: 45, unitsReserved: 5, unitsLimit: 50, periodStart: '', periodEnd: '' })).toBe(true);
  });

  it('true once consumed+reserved exceeds the limit', () => {
    expect(isUsageLimitReached({ unitsConsumed: 48, unitsReserved: 5, unitsLimit: 50, periodStart: '', periodEnd: '' })).toBe(true);
  });
});
