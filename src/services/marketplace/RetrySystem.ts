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

        // Wait before retry
        const jitter = Math.random() * 1000 // 0-1s jitter
        const waitTime = Math.min(delay + jitter, this.MAX_DELAY_MS)
        await this.sleep(waitTime)

        delay *= 2
      }
    }

    throw lastError
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
