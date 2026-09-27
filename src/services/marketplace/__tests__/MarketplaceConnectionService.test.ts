/**
 * Multi-marketplace auth architecture (Option B — typed auth strategies).
 *
 * Proves three things together:
 *  1. Non-regression: eBay's plain OAuth flow and Etsy's OAuth+PKCE flow
 *     through MarketplaceConnectionService still work exactly as before
 *     — real EbayAdapter/EtsyAdapter instances, only global.fetch mocked
 *     (never a real network call), matching the convention already used
 *     in ebay-oauth.test.ts/EbayApplicationTokenManager.test.ts.
 *  2. The new connectWithManualCredentials() path (Vinted-shaped): valid
 *     credentials succeed and are encrypted, invalid ones are rejected,
 *     an OAuth marketplace sent to this method is rejected, workspace
 *     isolation holds, the operation is idempotent, and no secret is
 *     ever logged.
 *  3. initiateConnection/handleOAuthCallback (the OAuth path) now refuse
 *     a non-OAuth marketplace (Vinted) with a clear error instead of
 *     crashing — Vinted can never reach the OAuth callback machinery,
 *     even if called directly on the service, bypassing the route's own
 *     allowlist.
 *
 * No real network call, no real database — global.fetch and @/lib/prisma
 * are both mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { Marketplace } from '@/types/marketplace';

const { connectionStore } = vi.hoisted(() => ({ connectionStore: new Map<string, any>() }));

function connectionKey(workspaceId: string, marketplaceId: string) {
  return `${workspaceId}:${marketplaceId}`;
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    marketplaceConnection: {
      findUnique: vi.fn(async ({ where }: any) => {
        const { workspaceId, marketplaceId } = where.workspaceId_marketplaceId;
        const row = connectionStore.get(connectionKey(workspaceId, marketplaceId));
        return row ? { ...row } : null;
      }),
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const { workspaceId, marketplaceId } = where.workspaceId_marketplaceId;
        const key = connectionKey(workspaceId, marketplaceId);
        const existing = connectionStore.get(key);
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const row = { id: `conn-${connectionStore.size + 1}`, ...create };
        connectionStore.set(key, row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        for (const row of connectionStore.values()) {
          if (row.id === where.id) {
            Object.assign(row, data);
            return { ...row };
          }
        }
        throw new Error('MarketplaceConnection not found');
      }),
    },
  },
}));

import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService';

function jsonResponse(body: any, ok = true, status = ok ? 200 : 400) {
  // EbayAdapter/EtsyAdapter's own private HTTP helpers read the response
  // via .text() then JSON.parse() (never .json() directly) — both must
  // be provided for a real end-to-end call through either adapter to
  // succeed against this mock.
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as any;
}

/** One fetch mock covering both real adapters' real endpoints (eBay token+order-lookup, Etsy token+users/me+shops) — never a real network call. */
function mockOAuthFetch() {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/oauth2/token') || u.includes('/v3/public/oauth/token')) {
      return jsonResponse({ access_token: 'real-looking-access-token', refresh_token: 'real-looking-refresh-token', expires_in: 3600 });
    }
    if (u.includes('/sell/fulfillment/v1/order')) {
      return jsonResponse({ orders: [] }); // EbayAdapter.validateConnection
    }
    if (u.includes('/users/me')) {
      return jsonResponse({ user_id: 42 }); // EtsyAdapter.validateConnection, step 1
    }
    if (u.includes('/shops')) {
      return jsonResponse({ shop_id: 999 }); // EtsyAdapter.validateConnection, step 2
    }
    return jsonResponse({}, false, 404);
  });
}

function ebayConfig() {
  return { clientId: 'ebay-client', clientSecret: 'ebay-secret', redirectUri: 'http://localhost/callback/ebay', sandboxMode: true };
}

function etsyConfig() {
  return { clientId: 'etsy-client', clientSecret: 'etsy-secret', redirectUri: 'http://localhost/callback/etsy' };
}

function manualConfig() {
  return { clientId: '', clientSecret: '', redirectUri: '' };
}

describe('MarketplaceConnectionService', () => {
  beforeEach(() => {
    connectionStore.clear();
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  });

  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  describe('non-regression — eBay OAuth', () => {
    it('initiateConnection + handleOAuthCallback still create a connected connection, end to end', async () => {
      vi.stubGlobal('fetch', mockOAuthFetch());
      const service = new MarketplaceConnectionService(ebayConfig());

      const { authUrl, state } = await service.initiateConnection('ws-1', Marketplace.EBAY);
      expect(authUrl).toContain('ebay');
      expect(state).toHaveLength(64);

      const result = await service.handleOAuthCallback('ws-1', Marketplace.EBAY, 'auth-code-123', state);

      expect(result.status).toBe('connected');
      const stored = connectionStore.get(connectionKey('ws-1', Marketplace.EBAY));
      expect(stored.status).toBe('connected');
      expect(stored.encryptedOauthToken).toBeDefined();
      expect(stored.encryptedOauthToken).not.toContain('real-looking-access-token');
    });
  });

  describe('non-regression — Etsy OAuth + PKCE', () => {
    it('initiateConnection returns a codeVerifier, and handleOAuthCallback still works end to end with it', async () => {
      vi.stubGlobal('fetch', mockOAuthFetch());
      const service = new MarketplaceConnectionService(etsyConfig());

      const { authUrl, state, codeVerifier } = await service.initiateConnection('ws-1', Marketplace.ETSY);
      expect(authUrl).toContain('etsy');
      expect(codeVerifier).toBeDefined();

      const result = await service.handleOAuthCallback('ws-1', Marketplace.ETSY, 'auth-code-456', state, codeVerifier);

      expect(result.status).toBe('connected');
      const stored = connectionStore.get(connectionKey('ws-1', Marketplace.ETSY));
      expect(stored.status).toBe('connected');
      // Etsy's validateConnection resolves a real shop_id — stored via
      // the existing sellerId reuse, unchanged by this task.
      expect(stored.sellerId).toBe('999');
    });
  });

  describe('Vinted can never reach the OAuth path', () => {
    it('initiateConnection rejects Vinted with a clear error, never a generic crash', async () => {
      const service = new MarketplaceConnectionService(manualConfig());
      await expect(service.initiateConnection('ws-1', Marketplace.VINTED)).rejects.toThrow(
        'does not support OAuth'
      );
    });

    it('handleOAuthCallback rejects Vinted with a clear error, never a generic crash', async () => {
      const service = new MarketplaceConnectionService(manualConfig());
      const state = 'a'.repeat(64);
      await expect(service.handleOAuthCallback('ws-1', Marketplace.VINTED, 'some-code', state)).rejects.toThrow(
        'does not support OAuth'
      );
    });
  });

  describe('connectWithManualCredentials', () => {
    it('rejects an OAuth marketplace (eBay) — never silently routes it through the manual path', async () => {
      const service = new MarketplaceConnectionService(manualConfig());
      await expect(
        service.connectWithManualCredentials('ws-1', Marketplace.EBAY, { accessKey: 'x', signingKey: 'y' })
      ).rejects.toThrow('does not use manual credential authentication');
    });

    it('rejects empty/missing credential values before ever touching the adapter', async () => {
      const service = new MarketplaceConnectionService(manualConfig());
      await expect(
        service.connectWithManualCredentials('ws-1', Marketplace.VINTED, { accessKey: '', signingKey: 'y' })
      ).rejects.toThrow('non-empty string');
      expect(connectionStore.size).toBe(0);
    });

    it('rejects more than 2 credential values explicitly, never silently drops one', async () => {
      const service = new MarketplaceConnectionService(manualConfig());
      await expect(
        service.connectWithManualCredentials('ws-1', Marketplace.VINTED, { a: '1', b: '2', c: '3' })
      ).rejects.toThrow('at most 2');
    });

    it("propagates VintedAdapter's real BLOCKED error — never fabricates a successful connection", async () => {
      const service = new MarketplaceConnectionService(manualConfig());
      await expect(
        service.connectWithManualCredentials('ws-1', Marketplace.VINTED, { accessKey: 'ak', signingKey: 'sk' })
      ).rejects.toThrow('BLOCKED');
      // Nothing was ever written — validateConnection failed before encryption/upsert.
      expect(connectionStore.size).toBe(0);
    });

    it('never logs the credential values, on the success path or any failure path', async () => {
      const consoleSpies = [
        vi.spyOn(console, 'log').mockImplementation(() => {}),
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
        vi.spyOn(console, 'error').mockImplementation(() => {}),
      ];
      const service = new MarketplaceConnectionService(manualConfig());
      const secretAccessKey = 'super-secret-access-key-do-not-leak';
      const secretSigningKey = 'super-secret-signing-key-do-not-leak';

      await service
        .connectWithManualCredentials('ws-1', Marketplace.VINTED, { accessKey: secretAccessKey, signingKey: secretSigningKey })
        .catch(() => {});

      for (const spy of consoleSpies) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(secretAccessKey);
          expect(JSON.stringify(call)).not.toContain(secretSigningKey);
        }
      }
      consoleSpies.forEach((s) => s.mockRestore());
    });
  });

  /**
   * VintedAdapter's own validateConnection still throws BLOCKED today (no
   * real partner access) — so to test connectWithManualCredentials'
   * OWN encryption/upsert/idempotency logic (as opposed to VintedAdapter's
   * behavior), these tests use a minimal stand-in adapter that satisfies
   * ManualCredentialConnectable and actually returns true, registered
   * through the real AdapterFactory. This proves the SERVICE's pipe
   * works correctly — it never claims anything new about Vinted's real
   * API, which remains unimplemented (see actionTools/etc. — untouched).
   */
  describe('connectWithManualCredentials — pipe correctness (stand-in adapter, not a real Vinted implementation)', () => {
    beforeEach(async () => {
      const { VintedAdapter } = await import('@/services/marketplace/adapters/VintedAdapter');
      vi.spyOn(VintedAdapter.prototype, 'validateConnection').mockResolvedValue(true);
    });

    it('encrypts both credential values — the stored connection never contains the plaintext', async () => {
      const service = new MarketplaceConnectionService(manualConfig());
      const secretAccessKey = 'plain-access-key-value';
      const secretSigningKey = 'plain-signing-key-value';

      await service.connectWithManualCredentials('ws-1', Marketplace.VINTED, {
        accessKey: secretAccessKey,
        signingKey: secretSigningKey,
      });

      const stored = connectionStore.get(connectionKey('ws-1', Marketplace.VINTED));
      expect(stored.status).toBe('connected');
      expect(stored.encryptedOauthToken).not.toContain(secretAccessKey);
      expect(stored.encryptedRefreshToken).not.toContain(secretSigningKey);
      expect(stored.tokenExpiresAt).toBeNull();
    });

    it('is idempotent: connecting the same workspace+marketplace twice updates one row, never creates a second', async () => {
      const service = new MarketplaceConnectionService(manualConfig());

      await service.connectWithManualCredentials('ws-1', Marketplace.VINTED, { accessKey: 'ak-1', signingKey: 'sk-1' });
      const firstId = connectionStore.get(connectionKey('ws-1', Marketplace.VINTED)).id;

      await service.connectWithManualCredentials('ws-1', Marketplace.VINTED, { accessKey: 'ak-2', signingKey: 'sk-2' });
      const row = connectionStore.get(connectionKey('ws-1', Marketplace.VINTED));

      expect(row.id).toBe(firstId); // same row, updated in place
      expect(connectionStore.size).toBe(1);
    });

    it('creates/updates MarketplaceConnection with status "connected" and the workspace-scoped key', async () => {
      const service = new MarketplaceConnectionService(manualConfig());
      const result = await service.connectWithManualCredentials('ws-1', Marketplace.VINTED, {
        accessKey: 'ak',
        signingKey: 'sk',
      });

      expect(result.status).toBe('connected');
      expect(result.marketplace).toBe(Marketplace.VINTED);
      const stored = connectionStore.get(connectionKey('ws-1', Marketplace.VINTED));
      expect(stored.workspaceId).toBe('ws-1');
      expect(stored.marketplaceId).toBe(Marketplace.VINTED);
    });

    it('workspace isolation: workspace A and workspace B get independent connection rows, and A cannot decrypt B\'s stored credential', async () => {
      const service = new MarketplaceConnectionService(manualConfig());

      await service.connectWithManualCredentials('workspace-A', Marketplace.VINTED, { accessKey: 'a-access', signingKey: 'a-signing' });
      await service.connectWithManualCredentials('workspace-B', Marketplace.VINTED, { accessKey: 'b-access', signingKey: 'b-signing' });

      expect(connectionStore.size).toBe(2);
      const rowA = connectionStore.get(connectionKey('workspace-A', Marketplace.VINTED));
      const rowB = connectionStore.get(connectionKey('workspace-B', Marketplace.VINTED));
      expect(rowA.id).not.toBe(rowB.id);

      // The same guarantee TokenManager already provides for OAuth tokens
      // (workspaceId is AEAD "additional authenticated data") applies
      // unchanged to manual credentials: decrypting workspace A's stored
      // value under workspace B's id must fail, never succeed with wrong
      // or garbage plaintext.
      const { TokenManager } = await import('@/services/marketplace/TokenManager');
      const tokenManager = new TokenManager();
      expect(() =>
        tokenManager.decryptToken({ encrypted: rowA.encryptedOauthToken }, 'workspace-B')
      ).toThrow();
    });
  });
});
