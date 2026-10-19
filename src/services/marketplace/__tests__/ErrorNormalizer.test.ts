/**
 * ADKSY — Correctif de diagnostic sync-listings/sync-orders.
 *
 * Avant ce correctif, ErrorNormalizer.normalize() et
 * RateLimitManager.checkLimit() lançaient des objets littéraux (jamais
 * `new Error(...)`), ce qui faisait échouer silencieusement tous les
 * `error instanceof Error` dans ListingsSyncService/OrdersSyncService et
 * les routes cron correspondantes — le vrai message était alors remplacé
 * par la chaîne fixe "Unknown error" (voir le diagnostic en lecture seule
 * de l'incident "[Cron sync-listings] Failed for workspace ...: Unknown
 * error" du 19 octobre).
 *
 * Ce fichier vérifie, au niveau unitaire, que NormalizedError est bien
 * une vraie instance Error tout en conservant les champs structurés déjà
 * lus ailleurs par simple accès de propriété (RetrySystem.isRetryable,
 * MarketplaceOrderService, EbayAdapter, ListingService) — aucun de ces
 * consommateurs ne fait de comparaison stricte de forme, donc ce
 * changement ne doit rien casser côté retry/statusCode/business rules.
 */
import { describe, it, expect } from 'vitest'
import { ErrorNormalizer } from '@/services/marketplace/ErrorNormalizer'
import { RateLimitManager } from '@/services/marketplace/RateLimitManager'
import { NormalizedError, ErrorType, Marketplace } from '@/types/marketplace'

describe('NormalizedError — real Error instance', () => {
  it('is constructed as a genuine Error (instanceof Error true, .message set via super())', () => {
    const err = new NormalizedError({
      type: ErrorType.SERVER_ERROR,
      message: 'eBay server error. Will retry automatically.',
      statusCode: 500,
      retryable: true,
    })

    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('eBay server error. Will retry automatically.')
    expect(err.type).toBe(ErrorType.SERVER_ERROR)
    expect(err.statusCode).toBe(500)
    expect(err.retryable).toBe(true)
  })
})

describe('ErrorNormalizer.normalize — every branch returns a real Error', () => {
  const cases: Array<[string, any, string]> = [
    ['ebay 429', { status: 429 }, 'ebay'],
    ['ebay 401', { status: 401 }, 'ebay'],
    ['ebay 403', { status: 403 }, 'ebay'],
    ['ebay 400', { status: 400, message: 'bad request' }, 'ebay'],
    ['ebay 404', { status: 404 }, 'ebay'],
    ['ebay network', { code: 'ETIMEDOUT' }, 'ebay'],
    ['ebay 5xx', { status: 502 }, 'ebay'],
    ['etsy 429', { status: 429 }, 'etsy'],
    ['etsy 401', { status: 401 }, 'etsy'],
    ['etsy 403', { status: 403 }, 'etsy'],
    ['etsy 400', { status: 400 }, 'etsy'],
    ['etsy 404', { status: 404 }, 'etsy'],
    ['etsy 5xx', { status: 503 }, 'etsy'],
    ['depop', {}, 'depop'],
    ['vinted', {}, 'vinted'],
    ['generic network', { code: 'ECONNREFUSED' }, 'unknown-marketplace'],
    ['generic default', { message: 'something odd' }, 'unknown-marketplace'],
  ]

  for (const [label, rawError, marketplace] of cases) {
    it(`${label}: instanceof Error, has a real non-empty message, type and statusCode`, () => {
      const normalized = ErrorNormalizer.normalize(rawError, marketplace)

      expect(normalized).toBeInstanceOf(Error)
      expect(typeof normalized.message).toBe('string')
      expect(normalized.message.length).toBeGreaterThan(0)
      expect(Object.values(ErrorType)).toContain(normalized.type)
      expect(typeof normalized.statusCode).toBe('number')
    })
  }

  it('eBay 429 preserves the exact pre-existing message/type/retryable/retryAfter (no business-rule change)', () => {
    const normalized = ErrorNormalizer.normalize({ status: 429, headers: { 'retry-after': '42' } }, 'ebay')

    expect(normalized.type).toBe(ErrorType.RATE_LIMIT_EXCEEDED)
    expect(normalized.message).toBe('eBay rate limit exceeded. Requests queued for later.')
    expect(normalized.statusCode).toBe(429)
    expect(normalized.retryable).toBe(true)
    expect(normalized.retryAfter).toBe(42)
  })

  it('Etsy 401 preserves the exact pre-existing message/type/retryable (no business-rule change)', () => {
    const normalized = ErrorNormalizer.normalize({ status: 401 }, 'etsy')

    expect(normalized.type).toBe(ErrorType.AUTH_EXPIRED)
    expect(normalized.message).toBe('Etsy token expired. Please reconnect.')
    expect(normalized.retryable).toBe(false)
  })

  it('never includes the raw originalError content inside .message — only the short, safe mapped string', () => {
    const rawError = {
      status: 401,
      // Simulates what a real marketplace error body could carry —
      // never expected to leak into .message.
      error: 'invalid_token',
      authorization: 'Bearer sk-should-never-appear-in-message',
    }

    const normalized = ErrorNormalizer.normalize(rawError, 'ebay')

    expect(normalized.message).not.toContain('sk-should-never-appear-in-message')
    expect(normalized.message).toBe('eBay token expired. Please reconnect.')
    // originalError itself is still reachable for a caller that explicitly
    // wants it (never logged wholesale by any existing caller — see the
    // cron-sync.test.ts "never logs secrets" coverage for the real
    // console.error/SyncLog.error call sites).
    expect(normalized.originalError).toBe(rawError)
  })
})

describe('RateLimitManager.checkLimit — rate-limit exceeded is a real Error', () => {
  it('throws a NormalizedError (instanceof Error) with the exact pre-existing fields, once the bucket is exhausted', async () => {
    const manager = new RateLimitManager()

    // eBay's configured burst limit is 114 requests/hour (see the
    // constructor) — exhaust it, then the next call must throw.
    for (let i = 0; i < 114; i++) {
      await manager.checkLimit(Marketplace.EBAY, 'ws-rate-limit-test')
    }

    let caught: any
    try {
      await manager.checkLimit(Marketplace.EBAY, 'ws-rate-limit-test')
      throw new Error('expected checkLimit to throw after exhausting the bucket')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught).toBeInstanceOf(NormalizedError)
    expect(caught.type).toBe(ErrorType.RATE_LIMIT_EXCEEDED)
    expect(caught.statusCode).toBe(429)
    expect(caught.retryable).toBe(true)
    expect(typeof caught.retryAfter).toBe('number')
    expect(caught.message).toContain('Rate limit exceeded for')
    expect(caught.message).toContain(Marketplace.EBAY)
  })
})
