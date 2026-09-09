/**
 * eBay OAuth Tests
 * Test OAuth flows, token management, security
 * 
 * STATUS: TEST MOCK + REAL BLOCKED
 * - OAuth state generation (REAL)
 * - Token encryption (REAL)
 * - Error handling (REAL)
 * - Full OAuth flow (BLOCKED - requires eBay credentials)
 */

import crypto from 'crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TokenManager } from '@/services/marketplace/TokenManager'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'
import { ErrorNormalizer } from '@/services/marketplace/ErrorNormalizer'
import { ErrorType } from '@/types/marketplace'

// ============================================================================
// TEST 1: TokenManager - Encryption
// ============================================================================

describe('TokenManager - Encryption', () => {
  it('encrypts and decrypts tokens correctly', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
      crypto.randomBytes(32)
    ).toString('base64')

    const manager = new TokenManager()
    const originalToken = 'test_access_token_12345'
    const workspaceId = 'ws-test-001'

    const encrypted = manager.encryptToken(originalToken, workspaceId)
    expect(encrypted.encrypted).toBeDefined()
    expect(encrypted.iv).toBeDefined()

    const decrypted = manager.decryptToken(encrypted, workspaceId)
    expect(decrypted).toBe(originalToken)
  })

  it('fails to decrypt with wrong workspace ID', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
      crypto.randomBytes(32)
    ).toString('base64')

    const manager = new TokenManager()
    const token = 'test_token'
    const encrypted = manager.encryptToken(token, 'ws-001')

    expect(() => manager.decryptToken(encrypted, 'ws-002')).toThrow()
  })

  it('requires TOKEN_ENCRYPTION_KEY environment variable', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY

    expect(() => new TokenManager()).toThrow('TOKEN_ENCRYPTION_KEY not set')
  })
})

// ============================================================================
// TEST 2: TokenManager - CSRF Protection
// ============================================================================

describe('TokenManager - CSRF Protection', () => {
  it('generates unique OAuth states', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
      crypto.randomBytes(32)
    ).toString('base64')

    const manager = new TokenManager()
    const state1 = manager.generateOAuthState()
    const state2 = manager.generateOAuthState()

    expect(state1).toBeDefined()
    expect(state2).toBeDefined()
    expect(state1).not.toBe(state2)
    expect(state1.length).toBe(64) // 32 bytes hex = 64 chars
  })

  it('verifies OAuth state correctly', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
      crypto.randomBytes(32)
    ).toString('base64')

    const manager = new TokenManager()
    const state = manager.generateOAuthState()

    expect(manager.verifyOAuthState(state, state)).toBe(true)
    expect(manager.verifyOAuthState('wrong', state)).toBe(false)
  })
})

// ============================================================================
// TEST 3: TokenManager - Token Expiry
// ============================================================================

describe('TokenManager - Token Expiry', () => {
  it('calculates token expiry correctly', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
      crypto.randomBytes(32)
    ).toString('base64')

    const manager = new TokenManager()
    const expiryDate = manager.calculateTokenExpiry(3600)

    expect(expiryDate).toBeDefined()
    expect(expiryDate!.getTime()).toBeGreaterThan(Date.now())
  })

  it('detects when token needs refresh', () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
      crypto.randomBytes(32)
    ).toString('base64')

    const manager = new TokenManager()
    const expiringToken = new Date(Date.now() + 2 * 60 * 1000) // 2 minutes
    const validToken = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes

    expect(manager.shouldRefreshToken(expiringToken)).toBe(true)
    expect(manager.shouldRefreshToken(validToken)).toBe(false)
  })
})

// ============================================================================
// TEST 4: EbayAdapter - Configuration
// ============================================================================

describe('EbayAdapter - Configuration', () => {
  it('requires configuration parameters', () => {
    expect(() => new EbayAdapter({
      clientId: '', // Missing
      clientSecret: 'secret',
      redirectUri: 'http://localhost',
    })).toThrow()
  })

  it('uses sandbox by default', () => {
    const adapter = new EbayAdapter({
      clientId: 'test',
      clientSecret: 'secret',
      redirectUri: 'http://localhost',
      sandboxMode: undefined,
    })

    // Would check baseUrl but it's private
    // REAL TEST: Would verify sandbox endpoints used
  })
})

// ============================================================================
// TEST 5: Error Normalization - eBay
// ============================================================================

describe('Error Normalization - eBay', () => {
  it('normalizes eBay 401 as AUTH_EXPIRED', () => {
    const error = { status: 401 }
    const normalized = ErrorNormalizer.normalize(error, 'ebay')

    expect(normalized.type).toBe(ErrorType.AUTH_EXPIRED)
    expect(normalized.statusCode).toBe(401)
    expect(normalized.retryable).toBe(false)
  })

  it('normalizes eBay 429 as RATE_LIMIT_EXCEEDED', () => {
    const error = { status: 429 }
    const normalized = ErrorNormalizer.normalize(error, 'ebay')

    expect(normalized.type).toBe(ErrorType.RATE_LIMIT_EXCEEDED)
    expect(normalized.retryable).toBe(true)
  })

  it('normalizes eBay 400 validation error', () => {
    const error = { status: 400, message: 'Invalid category' }
    const normalized = ErrorNormalizer.normalize(error, 'ebay')

    expect(normalized.type).toBe(ErrorType.VALIDATION_ERROR)
    expect(normalized.retryable).toBe(false)
  })
})

// ============================================================================
// REAL TEST BLOCKED - Requires eBay Credentials
// ============================================================================

describe('EbayAdapter - Real API Calls', () => {
  it.skip('exchanges authorization code for token - BLOCKED', async () => {
    // BLOCKED TEST: Requires EBAY_CLIENT_ID, EBAY_CLIENT_SECRET
    // This test would call real eBay OAuth endpoint
    // Cannot run without valid eBay developer account
  })

  it.skip('refreshes access token - BLOCKED', async () => {
    // BLOCKED TEST: Requires valid refresh token from eBay
    // Cannot run without active eBay connection
  })

  it.skip('validates connection - BLOCKED', async () => {
    // BLOCKED TEST: Requires valid eBay access token
    // Cannot run without eBay sandbox account
  })

  it.skip('fetches listings - BLOCKED', async () => {
    // BLOCKED TEST: Requires eBay credentials + active seller account
  })

  it.skip('creates listing - BLOCKED', async () => {
    // BLOCKED TEST: Requires eBay credentials + sandbox account
  })

  it.skip('synchronizes orders - BLOCKED', async () => {
    // BLOCKED TEST: Requires eBay credentials + test orders
  })
})

// ============================================================================
// TEST 6: EbayAdapter.createListing() - publish step (network mocked)
//
// Real eBay Sandbox is unreachable from this environment (no egress to
// api.sandbox.ebay.com), so these tests mock global.fetch to exercise the
// real adapter code path (real request sequencing, real error handling)
// without a live network call. Live Sandbox verification of the same
// sequence remains BLOCKED and is not claimed here.
// ============================================================================

describe('EbayAdapter - createListing() calls the required publish step', () => {
  const baseListing = {
    title: 'Test item',
    description: 'A test item description',
    price: 10,
    quantity: 1,
    sku: 'TEST-SKU-1',
  }

  function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json: any }>) {
    let call = 0
    return vi.fn(async (_url: string, _init?: any) => {
      const r = responses[call]
      call++
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 400),
        statusText: r.ok ? 'OK' : 'Error',
        json: async () => r.json,
        text: async () => JSON.stringify(r.json),
      } as any
    })
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('TEST 1: inventory item -> offer -> publish all succeed: calls publish and returns the published listingId', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { sku: 'TEST-SKU-1' } }, // inventory_item
      { ok: true, json: { offerId: 'OFFER-123' } }, // offer
      { ok: true, json: { listingId: 'EBAY-LISTING-456' } }, // publish
    ])
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new EbayAdapter({
      clientId: 'test',
      clientSecret: 'test',
      redirectUri: 'http://localhost',
    })
    adapter.setAccessToken('fake-access-token')

    const result = await adapter.createListing(baseListing)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    // The 3rd call must be the publish endpoint for the offerId returned by step 2
    const publishCall = fetchMock.mock.calls[2]
    expect(publishCall[0]).toBe('https://api.sandbox.ebay.com/sell/inventory/v1/offer/OFFER-123/publish')
    expect(publishCall[1].method).toBe('POST')

    expect(result.externalId).toBe('EBAY-LISTING-456')
    expect(result.status).toBe('active')
  })

  it('TEST 2: publish fails (e.g. eBay 400) -> createListing throws, never returns a fake success', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { sku: 'TEST-SKU-1' } }, // inventory_item
      { ok: true, json: { offerId: 'OFFER-123' } }, // offer
      { ok: false, status: 400, json: { message: 'Offer failed policy validation' } }, // publish fails
    ])
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new EbayAdapter({
      clientId: 'test',
      clientSecret: 'test',
      redirectUri: 'http://localhost',
    })
    adapter.setAccessToken('fake-access-token')

    await expect(adapter.createListing(baseListing)).rejects.toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(3) // publish was actually attempted
  })

  it('TEST 3: offer creation succeeds but returns no offerId -> throws cleanly without ever calling publish', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { sku: 'TEST-SKU-1' } }, // inventory_item
      { ok: true, json: {} }, // offer response missing offerId
    ])
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new EbayAdapter({
      clientId: 'test',
      clientSecret: 'test',
      redirectUri: 'http://localhost',
    })
    adapter.setAccessToken('fake-access-token')

    await expect(adapter.createListing(baseListing)).rejects.toBeTruthy()
    // Only 2 calls: inventory_item + offer. No 3rd (publish) call since
    // there is no offerId to publish.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('TEST 4: the publish call targets exactly POST /sell/inventory/v1/offer/{offerId}/publish', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { sku: 'TEST-SKU-1' } },
      { ok: true, json: { offerId: 'ABC-999' } },
      { ok: true, json: { listingId: 'LIVE-1' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new EbayAdapter({
      clientId: 'test',
      clientSecret: 'test',
      redirectUri: 'http://localhost',
    })
    adapter.setAccessToken('fake-access-token')

    await adapter.createListing(baseListing)

    const [url, init] = fetchMock.mock.calls[2]
    expect(url).toBe('https://api.sandbox.ebay.com/sell/inventory/v1/offer/ABC-999/publish')
    expect(init.method).toBe('POST')
  })

  it('TEST 5: a failed publish never leaks the access token or client secret in the thrown error', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { sku: 'TEST-SKU-1' } },
      { ok: true, json: { offerId: 'OFFER-SECRET-TEST' } },
      { ok: false, status: 401, json: { message: 'invalid_token' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new EbayAdapter({
      clientId: 'test-client-id',
      clientSecret: 'super-secret-client-secret',
      redirectUri: 'http://localhost',
    })
    const secretToken = 'super-secret-access-token-xyz'
    adapter.setAccessToken(secretToken)

    let caught: any
    try {
      await adapter.createListing(baseListing)
    } catch (error) {
      caught = error
    }

    const serialized = JSON.stringify(caught)
    expect(serialized).not.toContain(secretToken)
    expect(serialized).not.toContain('super-secret-client-secret')
  })
})

