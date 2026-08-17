/**
 * ErrorNormalizer
 * Convert marketplace-specific errors to common format
 * 
 * STATUS: REAL - Ready for use
 */

import { ErrorType, NormalizedError, MarketplaceError } from "@/types/marketplace"

export class ErrorNormalizer {
  /**
   * Normalize any marketplace error to common format
   * 
   * Core business logic uses ErrorType instead of marketplace-specific codes
   * This makes it agnostic to which marketplace errored
   */
  static normalize(error: any, marketplace: string): NormalizedError {
    // Extract status code
    const statusCode = error?.status || error?.statusCode || error?.response?.status || 500

    // Route to marketplace-specific normalizer
    switch (marketplace.toLowerCase()) {
      case "ebay":
        return this.normalizeEbayError(error, statusCode)
      case "etsy":
        return this.normalizeEtsyError(error, statusCode)
      case "depop":
        return this.normalizeDepopError(error, statusCode)
      case "vinted":
        return this.normalizeVintedError(error, statusCode)
      default:
        return this.normalizeGenericError(error, statusCode)
    }
  }

  private static normalizeEbayError(error: any, statusCode: number): NormalizedError {
    // eBay error codes: https://developer.ebay.com/docs/api/error-handling

    // 429 Rate Limit
    if (statusCode === 429) {
      return {
        type: ErrorType.RATE_LIMIT_EXCEEDED,
        message: "eBay rate limit exceeded. Requests queued for later.",
        statusCode: 429,
        retryable: true,
        retryAfter: this.parseRetryAfter(error),
        originalError: error,
      }
    }

    // 401/403 Authentication
    if (statusCode === 401) {
      return {
        type: ErrorType.AUTH_EXPIRED,
        message: "eBay token expired. Please reconnect.",
        statusCode: 401,
        retryable: false,
        originalError: error,
      }
    }

    if (statusCode === 403) {
      return {
        type: ErrorType.AUTH_INVALID,
        message: "eBay permission denied. Check account permissions.",
        statusCode: 403,
        retryable: false,
        originalError: error,
      }
    }

    // 400 Validation
    if (statusCode === 400) {
      const message = error?.message || error?.error?.error_description || "Invalid eBay request"
      return {
        type: ErrorType.VALIDATION_ERROR,
        message: `eBay validation error: ${message}`,
        statusCode: 400,
        retryable: false,
        originalError: error,
      }
    }

    // 404 Not Found
    if (statusCode === 404) {
      return {
        type: ErrorType.NOT_FOUND,
        message: "eBay item not found",
        statusCode: 404,
        retryable: false,
        originalError: error,
      }
    }

    // 5xx Server errors
    if (statusCode >= 500) {
      return {
        type: ErrorType.SERVER_ERROR,
        message: "eBay server error. Will retry automatically.",
        statusCode,
        retryable: true,
        originalError: error,
      }
    }

    // Network errors
    if (error?.code === "ECONNREFUSED" || error?.code === "ENOTFOUND" || error?.code === "ETIMEDOUT") {
      return {
        type: ErrorType.NETWORK_ERROR,
        message: "Network error connecting to eBay. Will retry.",
        statusCode: 503,
        retryable: true,
        originalError: error,
      }
    }

    return this.normalizeGenericError(error, statusCode)
  }

  private static normalizeEtsyError(error: any, statusCode: number): NormalizedError {
    // Etsy error handling: https://developers.etsy.com/documentation/reference#errors

    // 429 Rate Limit
    if (statusCode === 429) {
      return {
        type: ErrorType.RATE_LIMIT_EXCEEDED,
        message: "Etsy rate limit exceeded.",
        statusCode: 429,
        retryable: true,
        retryAfter: this.parseRetryAfter(error),
        originalError: error,
      }
    }

    // 401 Auth
    if (statusCode === 401) {
      return {
        type: ErrorType.AUTH_EXPIRED,
        message: "Etsy token expired. Please reconnect.",
        statusCode: 401,
        retryable: false,
        originalError: error,
      }
    }

    // 403 Permission
    if (statusCode === 403) {
      return {
        type: ErrorType.AUTH_INVALID,
        message: "Etsy permission denied.",
        statusCode: 403,
        retryable: false,
        originalError: error,
      }
    }

    // 400 Validation
    if (statusCode === 400) {
      return {
        type: ErrorType.VALIDATION_ERROR,
        message: `Etsy validation error: ${error?.message || "Invalid request"}`,
        statusCode: 400,
        retryable: false,
        originalError: error,
      }
    }

    // 404 Not Found
    if (statusCode === 404) {
      return {
        type: ErrorType.NOT_FOUND,
        message: "Etsy resource not found",
        statusCode: 404,
        retryable: false,
        originalError: error,
      }
    }

    // 5xx Server
    if (statusCode >= 500) {
      return {
        type: ErrorType.SERVER_ERROR,
        message: "Etsy server error. Will retry.",
        statusCode,
        retryable: true,
        originalError: error,
      }
    }

    return this.normalizeGenericError(error, statusCode)
  }

  private static normalizeDepopError(error: any, statusCode: number): NormalizedError {
    // Depop has limited API, so most operations throw NOT_SUPPORTED
    return {
      type: ErrorType.VALIDATION_ERROR,
      message: "Depop API integration limited. Operation not supported.",
      statusCode: 400,
      retryable: false,
      originalError: error,
    }
  }

  private static normalizeVintedError(error: any, statusCode: number): NormalizedError {
    // Vinted has no official API
    return {
      type: ErrorType.UNKNOWN,
      message: "Vinted adapter not supported. No official API available.",
      statusCode: 400,
      retryable: false,
      originalError: error,
    }
  }

  private static normalizeGenericError(error: any, statusCode: number): NormalizedError {
    // Network errors
    if (error?.code === "ECONNREFUSED" || error?.code === "ENOTFOUND" || error?.code === "ETIMEDOUT") {
      return {
        type: ErrorType.NETWORK_ERROR,
        message: "Network error. Will retry.",
        statusCode: 503,
        retryable: true,
        originalError: error,
      }
    }

    // Default
    return {
      type: ErrorType.UNKNOWN,
      message: error?.message || "Unknown marketplace error",
      statusCode: statusCode || 500,
      retryable: statusCode >= 500,
      originalError: error,
    }
  }

  private static parseRetryAfter(error: any): number | undefined {
    // Parse Retry-After header
    const retryAfter = error?.headers?.["retry-after"] || error?.headers?.["Retry-After"]
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10)
      return isNaN(seconds) ? undefined : seconds
    }
    return undefined
  }
}

export default ErrorNormalizer

