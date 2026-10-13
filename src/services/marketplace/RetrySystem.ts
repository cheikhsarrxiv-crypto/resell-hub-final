/**
 * RetrySystem
 * Handle transient failures with exponential backoff
 * 
 * STATUS: REAL - Ready for use
 */

import { NormalizedError, ErrorType } from "@/types/marketplace"

export class RetrySystem {
  private static readonly MAX_RETRIES = 5
  private static readonly INITIAL_DELAY_MS = 1000
  private static readonly MAX_DELAY_MS = 32000

  /**
   * Retry an async operation with exponential backoff
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string = "Operation"
  ): Promise<T> {
    let lastError: any
    let delay = this.INITIAL_DELAY_MS

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error

        // Don't retry on non-retryable errors
        if (!this.isRetryable(error)) {
          throw error
        }

        // Don't retry on last attempt
        if (attempt === this.MAX_RETRIES) {
          throw error
        }

        // Wait before retry — prefer the marketplace's own stated
        // Retry-After (seconds, surfaced as NormalizedError.retryAfter by
        // ErrorNormalizer) over the generic exponential backoff, but never
        // beyond this system's own safety ceiling (MAX_DELAY_MS): an
        // unreasonably large or malformed Retry-After must never stall a
        // publish attempt far longer than the rest of this system allows.
        const retryAfterMs = this.getRetryAfterMs(error)
        const waitTime =
          retryAfterMs !== undefined
            ? Math.min(retryAfterMs, this.MAX_DELAY_MS)
            : Math.min(delay + Math.random() * 1000, this.MAX_DELAY_MS) // 0-1s jitter

        await this.sleep(waitTime)

        delay *= 2
      }
    }

    throw lastError
  }

  /**
   * Extracts a valid Retry-After wait time (converted to ms), preferring a
   * NormalizedError's own `retryAfter` (seconds) field when present
   * (Etsy's own callEtsyApi already normalizes before throwing), and
   * falling back to a raw `retry-after` response header otherwise (eBay's
   * own callEbayApi deliberately never pre-normalizes — see that method's
   * own comment — so this is the only place that value is ever read for
   * an eBay error). Returns undefined for anything not a finite,
   * non-negative value — never trusts a malformed value as if it were a
   * real instruction from the marketplace.
   */
  private static getRetryAfterMs(error: any): number | undefined {
    const direct = error?.retryAfter
    if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) {
      return direct * 1000
    }
    const headerValue = error?.headers?.['retry-after'] ?? error?.headers?.['Retry-After']
    if (typeof headerValue === 'string') {
      const seconds = parseInt(headerValue, 10)
      if (!Number.isNaN(seconds) && seconds >= 0) {
        return seconds * 1000
      }
    }
    return undefined
  }

  /**
   * Check if error is retryable
   */
  private static isRetryable(error: any): boolean {
    // Check if it's a normalized error
    if (error?.type) {
      return error.type === ErrorType.RATE_LIMIT_EXCEEDED ||
             error.type === ErrorType.SERVER_ERROR ||
             error.type === ErrorType.NETWORK_ERROR
    }

    // Check for HTTP status codes
    if (error?.statusCode) {
      // Don't retry on 4xx except for rate limit
      if (error.statusCode >= 400 && error.statusCode < 500) {
        return error.statusCode === 429 // Rate limit
      }
      // Retry on 5xx and network errors (503, 504)
      return error.statusCode >= 500
    }

    // Check for network errors
    if (error?.code) {
      return error.code === "ECONNREFUSED" ||
             error.code === "ENOTFOUND" ||
             error.code === "ETIMEDOUT" ||
             error.code === "ECONNRESET"
    }

    return false
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export default RetrySystem
