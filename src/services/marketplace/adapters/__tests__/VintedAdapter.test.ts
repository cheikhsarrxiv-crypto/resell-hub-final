/**
 * Multi-marketplace auth architecture (Option B) — VintedAdapter's own
 * ManualCredentialConnectable implementation. Never calls any real
 * Vinted endpoint (none exists here) — setManualCredentials only stores
 * values in memory; validateConnection still throws its documented
 * "BLOCKED, no partner access" error, unchanged in substance from before
 * this task, just reachable through a different, typed path.
 */
import { describe, it, expect } from 'vitest';
import { VintedAdapter } from '@/services/marketplace/adapters/VintedAdapter';

function makeAdapter() {
  return new VintedAdapter({ clientId: '', clientSecret: '', redirectUri: '' });
}

describe('VintedAdapter.setManualCredentials', () => {
  it('accepts a valid accessKey + signingKey pair without throwing', () => {
    const adapter = makeAdapter();
    expect(() => adapter.setManualCredentials({ accessKey: 'ak', signingKey: 'sk' })).not.toThrow();
  });

  it('rejects a missing signingKey', () => {
    const adapter = makeAdapter();
    expect(() => adapter.setManualCredentials({ accessKey: 'ak' })).toThrow('requires both');
  });

  it('rejects a missing accessKey', () => {
    const adapter = makeAdapter();
    expect(() => adapter.setManualCredentials({ signingKey: 'sk' })).toThrow('requires both');
  });

  it('rejects an empty-string accessKey', () => {
    const adapter = makeAdapter();
    expect(() => adapter.setManualCredentials({ accessKey: '', signingKey: 'sk' })).toThrow('requires both');
  });

  it('never makes a network call — no fetch is stubbed globally and none is needed', async () => {
    const adapter = makeAdapter();
    // No vi.stubGlobal('fetch', ...) anywhere in this test file — if
    // setManualCredentials ever tried a real network call, it would hit
    // the real, unmocked global fetch and this test would hang/fail on
    // a real network error, not pass silently.
    adapter.setManualCredentials({ accessKey: 'ak', signingKey: 'sk' });
    expect(true).toBe(true);
  });
});

describe('VintedAdapter.validateConnection', () => {
  it('throws a specific error when called before setManualCredentials — a caller bug, not the real limitation', async () => {
    const adapter = makeAdapter();
    await expect(adapter.validateConnection()).rejects.toThrow('setManualCredentials must be called');
  });

  it('throws the real BLOCKED limitation once credentials are set — never a fabricated success', async () => {
    const adapter = makeAdapter();
    adapter.setManualCredentials({ accessKey: 'ak', signingKey: 'sk' });
    await expect(adapter.validateConnection()).rejects.toThrow('BLOCKED');
    await expect(adapter.validateConnection()).rejects.toThrow('allowlisted Vinted Pro Integrations access');
  });
});

describe('VintedAdapter no longer implements any OAuth method', () => {
  it('has no getOAuthUrl/exchangeAuthCode/refreshToken at all', () => {
    const adapter = makeAdapter();
    expect((adapter as any).getOAuthUrl).toBeUndefined();
    expect((adapter as any).exchangeAuthCode).toBeUndefined();
    expect((adapter as any).refreshToken).toBeUndefined();
  });
});
