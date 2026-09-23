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

describe('EbayApplicationTokenManager', () => {
  beforeEach(() => {
    EbayApplicationTokenManager.clearCache();
    delete process.env.EBAY_BUY_API_CLIENT_ID;
    delete process.env.EBAY_BUY_API_CLIENT_SECRET;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.EBAY_BUY_API_CLIENT_ID;
    delete process.env.EBAY_BUY_API_CLIENT_SECRET;
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
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'tok-1', expires_in: 7200 }));
      vi.stubGlobal('fetch', fetchMock);

      const token = await EbayApplicationTokenManager.getAccessToken();

      expect(token).toBe('tok-1');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.ebay.com/identity/v1/oauth2/token');
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
});
