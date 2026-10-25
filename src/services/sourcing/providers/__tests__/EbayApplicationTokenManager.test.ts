/**
 * Real behavioral tests for EbayApplicationTokenManager — token
 * acquisition, caching, expiry-based renewal, and error handling for the
 * client_credentials grant used by EbayBrowseSourcingProvider. Never
 * calls the real eBay endpoint — global.fetch is mocked, matching the
 * convention already used for EbayAdapter's own tests (ebay-oauth.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EbayApplicationTokenManager,
  EbayApplicationTokenAuthError,
} from '@/services/sourcing/providers/EbayApplicationTokenManager';

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as any;
}

const SANDBOX_TOKEN_URL = 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';
const PRODUCTION_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

describe('EbayApplicationTokenManager', () => {
  // vitest.config.ts loads local .env files into process.env, so the
  // developer's own EBAY_SANDBOX_MODE must never leak into these tests.
  const originalSandboxMode = process.env.EBAY_SANDBOX_MODE;

  beforeEach(() => {
    EbayApplicationTokenManager.clearCache();
    delete process.env.EBAY_BUY_API_CLIENT_ID;
    delete process.env.EBAY_BUY_API_CLIENT_SECRET;
    delete process.env.EBAY_SANDBOX_MODE;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.EBAY_BUY_API_CLIENT_ID;
    delete process.env.EBAY_BUY_API_CLIENT_SECRET;
    if (originalSandboxMode === undefined) {
      delete process.env.EBAY_SANDBOX_MODE;
    } else {
      process.env.EBAY_SANDBOX_MODE = originalSandboxMode;
    }
  });

  describe('isConfigured', () => {
    it('is false when no credentials are set', () => {
      expect(EbayApplicationTokenManager.isConfigured()).toBe(false);
    });

    it('is false when only one of the two credentials is set', () => {
      process.env.EBAY_BUY_API_CLIENT_ID = 'id-only';
      expect(EbayApplicationTokenManager.isConfigured()).toBe(false);
    });

    it('is true when both credentials are set', () => {
      process.env.EBAY_BUY_API_CLIENT_ID = 'id';
      process.env.EBAY_BUY_API_CLIENT_SECRET = 'secret';
      expect(EbayApplicationTokenManager.isConfigured()).toBe(true);
    });
  });

  describe('getAccessToken', () => {
    it('throws a clean auth error when not configured, never calls fetch', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(EbayApplicationTokenManager.getAccessToken()).rejects.toThrow(EbayApplicationTokenAuthError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requests a token from the correct endpoint with client_credentials grant and the public scope', async () => {
      process.env.EBAY_BUY_API_CLIENT_ID = 'my-id';
      process.env.EBAY_BUY_API_CLIENT_SECRET = 'my-secret';
      process.env.EBAY_SANDBOX_MODE = 'false';
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'tok-1', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      const token = await EbayApplicationTokenManager.getAccessToken();

      expect(token).toBe('tok-1');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(PRODUCTION_TOKEN_URL);
      expect(init.method).toBe('POST');
      expect(init.body).toContain('grant_type=client_credentials');
      expect(init.body).toContain(encodeURIComponent('https://api.ebay.com/oauth/api_scope'));
      // Basic auth built from EBAY_BUY_API_* — never from the seller OAuth vars.
      const expectedAuth = 'Basic ' + Buffer.from('my-id:my-secret').toString('base64');
      expect(init.headers.Authorization).toBe(expectedAuth);
    });

    it('caches the token and does not re-fetch while it is still valid', async () => {
      process.env.EBAY_BUY_API_CLIENT_ID = 'id';
      process.env.EBAY_BUY_API_CLIENT_SECRET = 'secret';
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'tok-1', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      const first = await EbayApplicationTokenManager.getAccessToken();
      const second = await EbayApplicationTokenManager.getAccessToken();

      expect(first).toBe('tok-1');
      expect(second).toBe('tok-1');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('re-fetches once the cached token has expired', async () => {
      process.env.EBAY_BUY_API_CLIENT_ID = 'id';
      process.env.EBAY_BUY_API_CLIENT_SECRET = 'secret';
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 61 })) // expires almost immediately (61s - 60s safety margin = 1s)
        .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-2', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      const first = await EbayApplicationTokenManager.getAccessToken();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const second = await EbayApplicationTokenManager.getAccessToken();

      expect(first).toBe('tok-1');
      expect(second).toBe('tok-2');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('a non-ok response -> throws EbayApplicationTokenAuthError with the eBay error description', async () => {
      process.env.EBAY_BUY_API_CLIENT_ID = 'id';
      process.env.EBAY_BUY_API_CLIENT_SECRET = 'secret';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ error_description: 'invalid_client' }, false, 401))
      );

      await expect(EbayApplicationTokenManager.getAccessToken()).rejects.toThrow('invalid_client');
    });

    it('a request timeout -> throws EbayApplicationTokenTimeoutError', async () => {
      process.env.EBAY_BUY_API_CLIENT_ID = 'id';
      process.env.EBAY_BUY_API_CLIENT_SECRET = 'secret';
      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'TimeoutError';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

      await expect(EbayApplicationTokenManager.getAccessToken()).rejects.toThrow('eBay token request timed out');
    });
  });

  describe('Sandbox/Production environment selection', () => {
    beforeEach(() => {
      process.env.EBAY_BUY_API_CLIENT_ID = 'id';
      process.env.EBAY_BUY_API_CLIENT_SECRET = 'secret';
    });

    it('defaults to the Sandbox token endpoint when EBAY_SANDBOX_MODE is absent', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'tok-sbx', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      await EbayApplicationTokenManager.getAccessToken();

      expect(fetchMock.mock.calls[0][0]).toBe(SANDBOX_TOKEN_URL);
    });

    it.each(['', 'true', 'FALSE', 'False', '0', 'no', ' false', 'false '])(
      'stays on Sandbox when EBAY_SANDBOX_MODE=%j (only the exact string "false" selects Production)',
      async (value) => {
        process.env.EBAY_SANDBOX_MODE = value;
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'tok-sbx', expires_in: 7200 }));
        vi.stubGlobal('fetch', fetchMock);

        await EbayApplicationTokenManager.getAccessToken();

        expect(fetchMock.mock.calls[0][0]).toBe(SANDBOX_TOKEN_URL);
      }
    );

    it('uses the Production token endpoint only when EBAY_SANDBOX_MODE is exactly "false"', async () => {
      process.env.EBAY_SANDBOX_MODE = 'false';
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'tok-prod', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      await EbayApplicationTokenManager.getAccessToken();

      expect(fetchMock.mock.calls[0][0]).toBe(PRODUCTION_TOKEN_URL);
    });

    it('an explicit environment argument picks the matching host', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-sbx', expires_in: 7200 }))
        .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-prod', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      await EbayApplicationTokenManager.getAccessToken('sandbox');
      await EbayApplicationTokenManager.getAccessToken('production');

      expect(fetchMock.mock.calls[0][0]).toBe(SANDBOX_TOKEN_URL);
      expect(fetchMock.mock.calls[1][0]).toBe(PRODUCTION_TOKEN_URL);
    });

    it('never reuses a cached Sandbox token for Production', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-sbx', expires_in: 7200 }))
        .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-prod', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      const sandboxToken = await EbayApplicationTokenManager.getAccessToken();
      process.env.EBAY_SANDBOX_MODE = 'false';
      const productionToken = await EbayApplicationTokenManager.getAccessToken();

      expect(sandboxToken).toBe('tok-sbx');
      expect(productionToken).toBe('tok-prod');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe(PRODUCTION_TOKEN_URL);
    });

    it('never reuses a cached Production token for Sandbox', async () => {
      process.env.EBAY_SANDBOX_MODE = 'false';
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-prod', expires_in: 7200 }))
        .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-sbx', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      const productionToken = await EbayApplicationTokenManager.getAccessToken();
      delete process.env.EBAY_SANDBOX_MODE;
      const sandboxToken = await EbayApplicationTokenManager.getAccessToken();

      expect(productionToken).toBe('tok-prod');
      expect(sandboxToken).toBe('tok-sbx');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe(SANDBOX_TOKEN_URL);
    });

    it('keeps each environment cached independently once both are minted', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-sbx', expires_in: 7200 }))
        .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-prod', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      await EbayApplicationTokenManager.getAccessToken('sandbox');
      await EbayApplicationTokenManager.getAccessToken('production');

      expect(await EbayApplicationTokenManager.getAccessToken('sandbox')).toBe('tok-sbx');
      expect(await EbayApplicationTokenManager.getAccessToken('production')).toBe('tok-prod');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('clearCache drops the tokens of both environments', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'tok', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      await EbayApplicationTokenManager.getAccessToken('sandbox');
      await EbayApplicationTokenManager.getAccessToken('production');
      EbayApplicationTokenManager.clearCache();
      await EbayApplicationTokenManager.getAccessToken('sandbox');
      await EbayApplicationTokenManager.getAccessToken('production');

      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });
});
