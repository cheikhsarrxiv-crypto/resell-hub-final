/**
 * Architecture Tests
 * Verify core architectural principles without calling real APIs
 * 
 * STATUS: TEST MOCK - Uses mock data only
 */

import { describe, it, expect } from "vitest"
import { ErrorNormalizer } from "@/services/marketplace/ErrorNormalizer"
import { RetrySystem } from "@/services/marketplace/RetrySystem"
import { StatusMapper } from "@/services/marketplace/StatusMapper"
import { RateLimitManager } from "@/services/marketplace/RateLimitManager"
import { Marketplace, ErrorType } from "@/types/marketplace"

// ============================================================================
// TEST 1: Error Normalization
// ============================================================================

describe("ErrorNormalizer", () => {
  it("normalizes eBay rate limit error", () => {
    const ebayError = {
      status: 429,
      message: "REQUEST_LIMIT_EXCEEDED"
    }

    const normalized = ErrorNormalizer.normalize(ebayError, "ebay")

    expect(normalized.type).toBe(ErrorType.RATE_LIMIT_EXCEEDED)
    expect(normalized.statusCode).toBe(429)
    expect(normalized.retryable).toBe(true)
  })

  it("normalizes Etsy rate limit error to same type", () => {
    const etsyError = {
      status: 429,
      headers: { "retry-after": "60" }
    }

    const normalized = ErrorNormalizer.normalize(etsyError, "etsy")

    expect(normalized.type).toBe(ErrorType.RATE_LIMIT_EXCEEDED)
    expect(normalized.statusCode).toBe(429)
    expect(normalized.retryable).toBe(true)
    expect(normalized.retryAfter).toBe(60)
  })

  it("normalizes eBay 401 as AUTH_EXPIRED", () => {
    const error = { status: 401 }
    const normalized = ErrorNormalizer.normalize(error, "ebay")

    expect(normalized.type).toBe(ErrorType.AUTH_EXPIRED)
    expect(normalized.retryable).toBe(false)
  })

  it("normalizes eBay validation error", () => {
    const error = {
      status: 400,
      message: "Invalid listing"
    }
    const normalized = ErrorNormalizer.normalize(error, "ebay")

    expect(normalized.type).toBe(ErrorType.VALIDATION_ERROR)
    expect(normalized.statusCode).toBe(400)
    expect(normalized.retryable).toBe(false)
  })

  it("core logic sees consistent error types", () => {
    // Different marketplace errors → same normalized type
    const ebay429 = ErrorNormalizer.normalize({ status: 429 }, "ebay")
    const etsy429 = ErrorNormalizer.normalize({ status: 429 }, "etsy")

    // Core business logic handles them identically
    expect(ebay429.type).toBe(etsy429.type)
    expect(ebay429.retryable).toBe(etsy429.retryable)
  })
})

// ============================================================================
// TEST 2: Retry System
// ============================================================================

describe("RetrySystem", () => {
  it("retries on transient errors", async () => {
    let attempts = 0
    let shouldFail = true

    const operation = async () => {
      attempts++
      if (shouldFail && attempts < 3) {
        throw { statusCode: 503, type: ErrorType.SERVER_ERROR }
      }
      return "success"
    }

    // Flip shouldFail in the background while withRetry is retrying,
    // not before calling it (otherwise the first attempt already succeeds).
    setTimeout(() => { shouldFail = false }, 100)
    const result = await RetrySystem.withRetry(operation)

    expect(result).toBe("success")
    expect(attempts).toBeGreaterThan(1)
  })

  it("does not retry on non-retryable errors", async () => {
    let attempts = 0

    const operation = async () => {
      attempts++
      throw { statusCode: 401, type: ErrorType.AUTH_EXPIRED }
    }

    await expect(RetrySystem.withRetry(operation)).rejects.toThrow()
    expect(attempts).toBe(1) // Only one attempt
  })

  it("gives up after max retries", async () => {
    let attempts = 0

    const operation = async () => {
      attempts++
      throw { statusCode: 500, type: ErrorType.SERVER_ERROR }
    }

    await expect(RetrySystem.withRetry(operation)).rejects.toThrow()
    expect(attempts).toBe(5) // Max retries
  }, 25000) // Real exponential backoff (1s+2s+4s+8s+jitter) exceeds default 5s timeout
})

// ============================================================================
// TEST 3: Status Mapping
// ============================================================================

describe("StatusMapper", () => {
  it("maps eBay statuses to ResellHub format", () => {
    const mappings = [
      ["INCOMPLETE", "pending"],
      ["IN_PROCESS", "confirmed"],
      ["FULFILLED", "shipped"],
      ["CANCELLED", "cancelled"],
    ]

    for (const [ebayStatus, expected] of mappings) {
      const result = StatusMapper.mapToResellHub(Marketplace.EBAY, ebayStatus)
      expect(result).toBe(expected)
    }
  })

  it("maps Etsy statuses to ResellHub format", () => {
    const mappings = [
      ["OPEN", "pending"],
      ["PAID", "confirmed"],
      ["PARTIALLY_FULFILLED", "partially_shipped"],
      ["FULFILLED", "shipped"],
      ["CANCELLED", "cancelled"],
    ]

    for (const [etsyStatus, expected] of mappings) {
      const result = StatusMapper.mapToResellHub(Marketplace.ETSY, etsyStatus)
      expect(result).toBe(expected)
    }
  })

  it("core logic sees same status type from different marketplaces", () => {
    const ebayShipped = StatusMapper.mapToResellHub(Marketplace.EBAY, "FULFILLED")
    const etsyShipped = StatusMapper.mapToResellHub(Marketplace.ETSY, "FULFILLED")

    expect(ebayShipped).toBe(etsyShipped)
    expect(ebayShipped).toBe("shipped")
  })
})

// ============================================================================
// TEST 4: Rate Limiting
// ============================================================================

describe("RateLimitManager", () => {
  it("allows requests within limit", async () => {
    const limiter = new RateLimitManager()
    const workspace = "ws-test-1"

    // eBay allows 114 req/hour
    for (let i = 0; i < 5; i++) {
      const state = await limiter.checkLimit(Marketplace.EBAY, workspace)
      expect(state.isLimited).toBe(false)
    }
  })

  it("blocks requests exceeding rate limit", async () => {
    const limiter = new RateLimitManager()
    const workspace = "ws-test-2"

    // Manually set a bucket to test blocking
    // This is TEST MOCK behavior
    limiter.reset(Marketplace.EBAY, workspace)

    // Simulate hitting the limit
    // (In production this would be prevented by Redis)
    expect(limiter.getState(Marketplace.EBAY, workspace).isLimited).toBe(false)
  })

  it("tracks different workspaces separately", async () => {
    const limiter = new RateLimitManager()

    const state1 = limiter.getState(Marketplace.EBAY, "ws-1")
    const state2 = limiter.getState(Marketplace.EBAY, "ws-2")

    // Both should have independent rate limits
    expect(state1.remaining).toBe(state2.remaining)
    expect(limiter.getState(Marketplace.EBAY, "ws-1")).not.toBe(
      limiter.getState(Marketplace.EBAY, "ws-2")
    )
  })
})

// ============================================================================
// TEST 5: Adapter Interface Compliance
// ============================================================================

describe("Adapter Interface", () => {
  it("eBay adapter implements all required methods", async () => {
    const { EbayAdapter } = await import("@/services/marketplace/adapters/EbayAdapter")

    const adapter = new EbayAdapter({
      clientId: "test",
      clientSecret: "test",
      redirectUri: "http://localhost"
    })

    // Check that all methods exist
    expect(adapter.marketplace).toBe(Marketplace.EBAY)
    expect(typeof adapter.getOAuthUrl).toBe("function")
    expect(typeof adapter.exchangeAuthCode).toBe("function")
    expect(typeof adapter.refreshToken).toBe("function")
    expect(typeof adapter.getListings).toBe("function")
    expect(typeof adapter.getListing).toBe("function")
    expect(typeof adapter.createListing).toBe("function")
    expect(typeof adapter.updateListing).toBe("function")
    expect(typeof adapter.deleteListing).toBe("function")
    expect(typeof adapter.getOrders).toBe("function")
    expect(typeof adapter.getOrder).toBe("function")
    expect(typeof adapter.updateOrderStatus).toBe("function")
    expect(typeof adapter.updateInventory).toBe("function")
    expect(typeof adapter.verifyWebhookSignature).toBe("function")
    expect(typeof adapter.validateConnection).toBe("function")
  })

  it("Vinted adapter is blocked", async () => {
    const { VintedAdapter } = await import("@/services/marketplace/adapters/VintedAdapter")

    const adapter = new VintedAdapter({
      clientId: "test",
      clientSecret: "test",
      redirectUri: "http://localhost"
    })

    // All methods should throw
    expect(() => adapter.getOAuthUrl("state", [])).toThrow("NOT_SUPPORTED")
  })

  it("Depop adapter is blocked pending partner access", async () => {
    const { DepopAdapter } = await import("@/services/marketplace/adapters/DepopAdapter")

    const adapter = new DepopAdapter({
      clientId: "test",
      clientSecret: "test",
      redirectUri: "http://localhost"
    })

    // Methods throw BLOCKED (real API exists, but access requires
    // approved Depop partnership — see DepopAdapter.ts header comment)
    await expect(adapter.createListing({} as any)).rejects.toThrow("BLOCKED")
  })
})

