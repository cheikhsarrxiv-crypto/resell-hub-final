import { FulfillmentProviderError } from '../errors';
import type {
  CreateFulfillmentOrderInput,
  FulfillmentProvider,
  FulfillmentProviderOrderStatus,
  FulfillmentProviderShipment,
  FulfillmentProviderTrackingEvent,
} from '../FulfillmentProvider';

/**
 * Test-only forced outcomes a caller can arm BEFORE calling
 * createFulfillmentOrder for a given ADKSY orderId, to deterministically
 * exercise an error path without any randomness. Not part of the
 * FulfillmentProvider interface itself — real partner adapters will never
 * have an equivalent of this, since real failures come from the real
 * network/partner, not from a test harness arming them in advance.
 */
export type MockForcedOutcome =
  | 'INSUFFICIENT_STOCK'
  | 'TEMPORARY_FAILURE'
  | 'PERMANENT_FAILURE'
  | 'PROVIDER_UNAVAILABLE'
  | 'TRACKING_UNAVAILABLE';

interface MockOrderState {
  externalOrderId: string;
  status: FulfillmentProviderOrderStatus['status'];
  workspaceId: string;
  adkOrderId: string;
  trackingNumber: string | null;
  carrier: string | null;
  events: FulfillmentProviderTrackingEvent[];
  shippingRequirements: CreateFulfillmentOrderInput['shippingRequirements'];
  trackingUnavailable: boolean;
}

/**
 * MockFulfillmentProvider — the ONLY real, fully-executable
 * FulfillmentProvider in this codebase. It simulates a fulfillment
 * partner's OWN backend, which by construction keeps its own state
 * separate from ADKSY's database — exactly like a real partner's API
 * would. This in-memory Map is that simulated partner backend, NOT a
 * second ADKSY persistence system: the authoritative ADKSY-side record of
 * "this order was sent to fulfillment" is, unchanged, the real
 * FulfillmentOrder row FulfillmentService.sendToFulfillment already
 * creates in Postgres. Losing this Map on process restart is therefore
 * exactly as harmless as a real partner's own servers being a black box
 * ADKSY doesn't persist a shadow copy of.
 *
 * Supports the full lifecycle this phase asked for:
 *   created -> accepted -> processing -> packed -> shipped -> delivered
 * via the test-only __advanceStatus helper (a real partner would drive
 * these transitions itself, reported back to ADKSY via polling or a
 * webhook — neither of which exists for any real partner yet), plus every
 * requested error case: insufficient stock, duplicate order (idempotent
 * replay, not an error), temporary/permanent failure, cancellation,
 * tracking unavailable, provider unavailable.
 */
export class MockFulfillmentProvider implements FulfillmentProvider {
  readonly name = 'mock';

  private ordersByAdkOrderId = new Map<string, MockOrderState>();
  private ordersByExternalId = new Map<string, MockOrderState>();
  private forcedOutcomes = new Map<string, MockForcedOutcome>();

  /** Test-only: arm a deterministic failure/edge-case for the NEXT
   * createFulfillmentOrder call for this ADKSY orderId. Never called by
   * any production code path. */
  __forceOutcome(adkOrderId: string, outcome: MockForcedOutcome): void {
    this.forcedOutcomes.set(adkOrderId, outcome);
  }

  /** Test-only: wipe all simulated partner state between tests. */
  __reset(): void {
    this.ordersByAdkOrderId.clear();
    this.ordersByExternalId.clear();
    this.forcedOutcomes.clear();
  }

  /** Test-only: drive the simulated partner's own state machine forward,
   * the way a real partner would via polling/webhook — never part of the
   * FulfillmentProvider interface itself. */
  __advanceStatus(
    adkOrderId: string,
    status: FulfillmentProviderOrderStatus['status'],
    options?: { trackingNumber?: string; carrier?: string }
  ): void {
    const order = this.ordersByAdkOrderId.get(adkOrderId);
    if (!order) {
      throw new FulfillmentProviderError('PERMANENT_FAILURE', `Mock order for "${adkOrderId}" does not exist.`, this.name);
    }
    order.status = status;
    if (status === 'shipped' || status === 'packed') {
      order.trackingNumber = options?.trackingNumber ?? order.trackingNumber ?? `MOCK-TRACK-${adkOrderId}`;
      order.carrier = options?.carrier ?? order.carrier ?? 'Mock Carrier';
    }
    order.events.push({
      status,
      location: status === 'delivered' ? 'Destination' : 'Mock Fulfillment Center',
      description: `Order moved to "${status}" at the mock partner.`,
      timestamp: new Date(),
    });
  }

  async createFulfillmentOrder(input: CreateFulfillmentOrderInput): Promise<FulfillmentProviderOrderStatus> {
    const forced = this.forcedOutcomes.get(input.orderId);
    if (forced) {
      // One-shot: consumed on first use, so a retry after an armed
      // temporary failure can actually succeed, mirroring a real partner
      // recovering.
      this.forcedOutcomes.delete(input.orderId);
      if (forced === 'INSUFFICIENT_STOCK') {
        throw new FulfillmentProviderError('VALIDATION_FAILURE', 'Insufficient stock at the mock fulfillment partner.', this.name);
      }
      if (forced === 'TEMPORARY_FAILURE') {
        throw new FulfillmentProviderError('TEMPORARY_FAILURE', 'Mock partner temporarily unreachable — retry later.', this.name);
      }
      if (forced === 'PERMANENT_FAILURE') {
        throw new FulfillmentProviderError('PERMANENT_FAILURE', 'Mock partner permanently rejected this order.', this.name);
      }
      if (forced === 'PROVIDER_UNAVAILABLE') {
        throw new FulfillmentProviderError('TEMPORARY_FAILURE', 'Mock fulfillment provider is unavailable.', this.name);
      }
      // TRACKING_UNAVAILABLE isn't a creation-time failure — remember it on
      // the order itself, consumed later by getTracking.
    }

    // Idempotent replay: calling this twice for the same ADKSY orderId
    // (double-click, retry, or a genuine "duplicate order" scenario) never
    // creates a second simulated partner order — mirrors the real
    // FulfillmentOrder.orderId @unique guarantee one layer up.
    const existing = this.ordersByAdkOrderId.get(input.orderId);
    if (existing) {
      return { externalOrderId: existing.externalOrderId, status: existing.status };
    }

    const externalOrderId = `MOCK-${input.orderId}`;
    const order: MockOrderState = {
      externalOrderId,
      status: 'pending',
      workspaceId: input.workspaceId,
      adkOrderId: input.orderId,
      trackingNumber: null,
      carrier: null,
      events: [{ status: 'pending', location: 'Mock Fulfillment Center', description: 'Order received by the mock partner.', timestamp: new Date() }],
      shippingRequirements: input.shippingRequirements,
      trackingUnavailable: forced === 'TRACKING_UNAVAILABLE',
    };
    this.ordersByAdkOrderId.set(input.orderId, order);
    this.ordersByExternalId.set(externalOrderId, order);

    return { externalOrderId, status: order.status };
  }

  async getFulfillmentOrder(externalOrderId: string): Promise<FulfillmentProviderOrderStatus> {
    const order = this.ordersByExternalId.get(externalOrderId);
    if (!order) {
      throw new FulfillmentProviderError('PERMANENT_FAILURE', `Mock order "${externalOrderId}" was not found.`, this.name);
    }
    return { externalOrderId: order.externalOrderId, status: order.status };
  }

  async cancelFulfillmentOrder(externalOrderId: string): Promise<void> {
    const order = this.ordersByExternalId.get(externalOrderId);
    if (!order) {
      throw new FulfillmentProviderError('PERMANENT_FAILURE', `Mock order "${externalOrderId}" was not found.`, this.name);
    }
    if (order.status === 'shipped' || order.status === 'delivered') {
      throw new FulfillmentProviderError(
        'UNSUPPORTED_OPERATION',
        `Mock order "${externalOrderId}" is already "${order.status}" — the mock partner does not support cancelling after shipment.`,
        this.name
      );
    }
    order.status = 'cancelled';
    order.events.push({ status: 'cancelled', location: null, description: 'Order cancelled before shipment.', timestamp: new Date() });
  }

  async getShipment(externalOrderId: string): Promise<FulfillmentProviderShipment | null> {
    const order = this.ordersByExternalId.get(externalOrderId);
    if (!order) {
      throw new FulfillmentProviderError('PERMANENT_FAILURE', `Mock order "${externalOrderId}" was not found.`, this.name);
    }
    if (order.status !== 'shipped' && order.status !== 'delivered') {
      return null;
    }
    return {
      externalOrderId: order.externalOrderId,
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingNumber ? `https://mock-carrier.local/track/${order.trackingNumber}` : null,
      status: order.status,
      estimatedDelivery: null,
      actualDelivery: order.status === 'delivered' ? new Date() : null,
    };
  }

  async getTracking(externalOrderId: string): Promise<FulfillmentProviderTrackingEvent[]> {
    const order = this.ordersByExternalId.get(externalOrderId);
    if (!order) {
      throw new FulfillmentProviderError('PERMANENT_FAILURE', `Mock order "${externalOrderId}" was not found.`, this.name);
    }
    if (order.trackingUnavailable) {
      // Tracking genuinely not available yet — an honest empty result, not
      // an error: the order exists, tracking just has nothing to report.
      return [];
    }
    return order.events;
  }

  supportsPickupPoint(): boolean {
    return false;
  }

  supportsLabels(): boolean {
    return false;
  }

  supportsMarketplaceShippingRequirements(): boolean {
    // The mock accepts and stores shippingRequirements (see
    // createFulfillmentOrder) without erroring, but never ACTS on them
    // differently (no real pickup-point/label network exists to honor
    // them) — reported capability stays honest about that limit.
    return true;
  }
}
