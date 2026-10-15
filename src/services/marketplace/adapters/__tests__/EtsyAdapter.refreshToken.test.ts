/**
 * Etsy OAuth/scopes audit prep: EtsyAdapter.refreshToken() had no
 * dedicated test — the only existing coverage of Etsy's OAuth flow
 * (MarketplaceConnectionService.test.ts) exercises the initial
 * exchangeAuthCode() path, never a subsequent refresh. This file covers
 * refreshToken() in isolation: success, a real HTTP failure from Etsy,
 * and a malformed-but-200 response.
 *
 * No real network — global fetch is stubbed per test, same convention as
 * etsy-order-sku.test.ts / EtsyAdapter.uploadListingImage.test.ts.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter'

function newAdapter() {
  return new EtsyAdapter({
    clientId: 'test-etsy-client-id',
    clientSecret: 'test-etsy-client-secret',
    redirectUri: 'http://localhost/api/marketplace/callback/etsy',
  })
}

describe('EtsyAdapter.refreshToken()', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('success: posts grant_type=refresh_token with the x-api-key header, no client_secret in the body, and returns the new access token', async () => {
    let capturedBody: string | undefined
    let capturedHeaders: Record<string, string> | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: any) => {
        capturedBody = init?.body
        capturedHeaders = init?.headers
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'new-real-looking-access-token', expires_in: 3600 }),
        }
      })
    )

    const result = await newAdapter().refreshToken('a-real-refresh-token')

    expect(result).toEqual({ accessToken: 'new-real-looking-access-token', expiresIn: 3600 })
    expect(capturedBody).toContain('grant_type=refresh_token')
    expect(capturedBody).toContain('refresh_token=a-real-refresh-token');
    expect(capturedBody).not.toContain('client_secret'); // PKCE/public-client flow — never sent
    expect(capturedHeaders?.['x-api-key']).toBe('test-etsy-client-id')
  })

  it('HTTP failure (e.g. invalid_grant — the real shape of a revoked/expired refresh token): throws a normalized error, never fabricates a token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'The refresh token is invalid or has been revoked.' }),
      }))
    )

    await expect(newAdapter().refreshToken('a-revoked-refresh-token')).rejects.toMatchObject({
      message: expect.stringContaining('refresh token is invalid'),
    })
  })

  it('network-level failure (fetch itself rejects): throws a normalized error, never a fabricated token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed: ECONNRESET')
      })
    )

    await expect(newAdapter().refreshToken('any-refresh-token')).rejects.toBeDefined()
  })

  /**
   * FIX: a 200 OK response missing `access_token` entirely used to not
   * throw at all — the method returned `{ accessToken: undefined,
   * expiresIn: ... }` as if it had succeeded, which
   * MarketplaceConnectionService would then try to encrypt and store as a
   * real token. Now validated explicitly: a 200 response without a real,
   * string `access_token` is treated as a failure, normalized the same
   * way as any other refresh error — never silently returned as success.
   */
  it('REGRESSION FIX: a 200 response missing access_token now throws an explicit error, never returns a successful result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ expires_in: 3600 }), // no access_token key at all
      }))
    )

    await expect(newAdapter().refreshToken('a-real-refresh-token')).rejects.toMatchObject({
      message: expect.stringContaining('missing or malformed access_token'),
    })
  })

  it('REGRESSION FIX: a 200 response with a non-string access_token (e.g. a number) is also treated as invalid, never returned as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 12345, expires_in: 3600 }),
      }))
    )

    await expect(newAdapter().refreshToken('a-real-refresh-token')).rejects.toMatchObject({
      message: expect.stringContaining('missing or malformed access_token'),
    })
  })

  it('REGRESSION FIX: a 200 response with an empty-string access_token is also treated as invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: '', expires_in: 3600 }),
      }))
    )

    await expect(newAdapter().refreshToken('a-real-refresh-token')).rejects.toMatchObject({
      message: expect.stringContaining('missing or malformed access_token'),
    })
  })
})
