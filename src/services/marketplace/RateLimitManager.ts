/**
 * RateLimitManager
 * Respects marketplace rate limits using token bucket algorithm
 * 
 * STATUS: REAL - Ready for use (uses in-memory storage for 2.9.2)
 * PRODUCTION: Will use Redis for distributed rate limiting
 */

import { Marketplace, RateLimitConfig, RateLimitState } from "@/types/marketplace"

interface TokenBucket {
  tokens: number
  lastRefillAt: number
}

export class RateLimitManager {
  private buckets: Map<string, TokenBucket> = new Map()
  private configs: Map<Marketplace, RateLimitConfig> = new Map()

  constructor() {
    // Initialize rate limit configs for each marketplace
    // Based on Phase 2.9.1 audit findings
    this.configs.set(Marketplace.EBAY, {
      marketplace: Marketplace.EBAY,
      requestsPerHour: 114, // Burst limit
    })

    this.configs.set(Marketplace.ETSY, {
      marketplace: Marketplace.ETSY,
      requestsPerMinute: 120,
    })
  }

  /**
   * Check if request is allowed
   * Returns when safe to proceed, or throws if rate limited
   */
  async checkLimit(marketplace: Marketplace, workspaceId: string): Promise<RateLimitState> {
    const config = this.configs.get(marketplace)
    if (!config) {
      // Unknown marketplace, allow through
      return {
        remaining: 1000,
        resetAt: new Date(Date.now() + 3600000),
        isLimited: false,
      }
    }

    const bucketKey = `${marketplace}:${workspaceId}`
    let bucket = this.buckets.get(bucketKey)

    const now = Date.now()

    // Initialize bucket on first use
    if (!bucket) {
      bucket = {
        tokens: config.requestsPerHour || config.requestsPerMinute || 100,
        lastRefillAt: now,
      }
      this.buckets.set(bucketKey, bucket)
    }

    // Refill tokens based on elapsed time
    const refillInterval = config.requestsPerHour
      ? 3600000 / config.requestsPerHour // per hour
      : 60000 / (config.requestsPerMinute || 120) // per minute

    const timeSinceRefill = now - bucket.lastRefillAt
    const tokensToAdd = Math.floor(timeSinceRefill / refillInterval)

    if (tokensToAdd > 0) {
      const maxTokens = config.requestsPerHour || config.requestsPerMinute || 100
      bucket.tokens = Math.min(bucket.tokens + tokensToAdd, maxTokens)
      bucket.lastRefillAt = now + (timeSinceRefill % refillInterval)
    }

    // Check if we have tokens
    if (bucket.tokens > 0) {
      bucket.tokens--
      return {
        remaining: Math.floor(bucket.tokens),
        resetAt: new Date(bucket.lastRefillAt + refillInterval),
        isLimited: false,
      }
    }

    // Rate limited
    const resetAt = new Date(bucket.lastRefillAt + refillInterval)
    const waitSeconds = Math.ceil((resetAt.getTime() - now) / 1000)

    throw {
      type: "RATE_LIMIT_EXCEEDED",
      message: `Rate limit exceeded for ${marketplace}. Retry in ${waitSeconds}s.`,
      statusCode: 429,
      retryable: true,
      retryAfter: waitSeconds,
    }
  }

  /**
   * Get current rate limit state without consuming a token
   */
  getState(marketplace: Marketplace, workspaceId: string): RateLimitState {
    const bucketKey = `${marketplace}:${workspaceId}`
    const bucket = this.buckets.get(bucketKey)

    if (!bucket) {
      return {
        remaining: 1000,
        resetAt: new Date(Date.now() + 3600000),
        isLimited: false,
      }
    }

    const config = this.configs.get(marketplace)
    const refillInterval = config?.requestsPerHour
      ? 3600000 / config.requestsPerHour
      : 60000 / (config?.requestsPerMinute || 120)

    return {
      remaining: Math.max(0, Math.floor(bucket.tokens)),
      resetAt: new Date(bucket.lastRefillAt + refillInterval),
      isLimited: bucket.tokens <= 0,
    }
  }

  /**
   * Reset rate limit for debugging
   */
  reset(marketplace: Marketplace, workspaceId: string): void {
    const bucketKey = `${marketplace}:${workspaceId}`
    this.buckets.delete(bucketKey)
  }
}

export default RateLimitManager

