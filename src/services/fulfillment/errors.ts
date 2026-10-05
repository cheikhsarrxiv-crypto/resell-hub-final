/**
 * Fulfillment Integration Foundation — typed error taxonomy.
 *
 * Every FulfillmentProvider implementation (MockFulfillmentProvider today;
 * a real partner adapter later) throws ONLY this error type for any
 * expected failure, so callers (FulfillmentService, send_to_fulfillment,
 * future reconciliation/retry code) can branch on `.code` instead of
 * pattern-matching error message strings — the same fragility problem
 * actionTools.ts's own KNOWN_FULFILLMENT_ERRORS comment already flags for
 * FulfillmentService's current plain Error messages.
 *
 * Codes are intentionally the small, real set this phase asked for — never
 * expanded speculatively for a partner whose real error taxonomy isn't
 * known yet:
 *  - NOT_CONFIGURED: the provider has no real credentials/integration yet
 *    (every partner id other than "mock" today — see registry.ts).
 *  - UNSUPPORTED_OPERATION: the provider is configured but this specific
 *    capability isn't offered by it (e.g. cancelling an already-shipped
 *    order).
 *  - AUTH_FAILURE: the provider rejected credentials/signature.
 *  - VALIDATION_FAILURE: the request itself is invalid per the provider's
 *    own rules (e.g. insufficient stock at the partner).
 *  - TEMPORARY_FAILURE: retrying the same request later may succeed
 *    (network error, partner outage) — the only code that marks
 *    `retryable: true`.
 *  - PERMANENT_FAILURE: retrying will not help (e.g. unknown order id).
 */
export type FulfillmentErrorCode =
  | 'NOT_CONFIGURED'
  | 'UNSUPPORTED_OPERATION'
  | 'AUTH_FAILURE'
  | 'VALIDATION_FAILURE'
  | 'TEMPORARY_FAILURE'
  | 'PERMANENT_FAILURE';

export class FulfillmentProviderError extends Error {
  readonly code: FulfillmentErrorCode;
  readonly providerName: string;
  /** Only TEMPORARY_FAILURE is ever safe to retry automatically. */
  readonly retryable: boolean;

  constructor(code: FulfillmentErrorCode, message: string, providerName: string) {
    super(message);
    this.name = 'FulfillmentProviderError';
    this.code = code;
    this.providerName = providerName;
    this.retryable = code === 'TEMPORARY_FAILURE';
  }
}
