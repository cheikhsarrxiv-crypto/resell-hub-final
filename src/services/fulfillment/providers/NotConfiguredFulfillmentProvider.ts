import { FulfillmentProviderError } from '../errors';
import type {
  CreateFulfillmentOrderInput,
  FulfillmentProvider,
  FulfillmentProviderOrderStatus,
  FulfillmentProviderShipment,
  FulfillmentProviderTrackingEvent,
} from '../FulfillmentProvider';

/**
 * A single, shared stand-in for every partner provider id the registry
 * knows about but has no real implementation for yet (frenchlog, vintedmkp,
 * colock_box, nexeuro — see ../registry.ts's PLANNED_PARTNER_PROVIDER_IDS).
 *
 * Deliberately ONE generic class, not four near-identical per-partner
 * files: there is no real partner API documentation yet, so there is
 * nothing partner-specific to write — a FrenchlogAdapter.ts today would be
 * 100% boilerplate identical to this file with the name changed. Writing
 * one is explicitly deferred to when each partner's real technical spec
 * arrives (see docs/fulfillment/PARTNER-INTEGRATION-CHECKLIST.md).
 *
 * Every method throws FulfillmentProviderError('NOT_CONFIGURED', ...)
 * synchronously inside the async function (never reaching, let alone
 * awaiting, any network call) — this class performs ZERO I/O.
 */
export class NotConfiguredFulfillmentProvider implements FulfillmentProvider {
  readonly name: string;

  constructor(providerId: string) {
    this.name = providerId;
  }

  private notConfigured(operation: string): never {
    throw new FulfillmentProviderError(
      'NOT_CONFIGURED',
      `Fulfillment provider "${this.name}" is not configured yet — no partner API documentation has been received, so no real integration exists. ` +
        `Operation "${operation}" cannot be performed.`,
      this.name
    );
  }

  async createFulfillmentOrder(_input: CreateFulfillmentOrderInput): Promise<FulfillmentProviderOrderStatus> {
    this.notConfigured('createFulfillmentOrder');
  }

  async getFulfillmentOrder(_externalOrderId: string): Promise<FulfillmentProviderOrderStatus> {
    this.notConfigured('getFulfillmentOrder');
  }

  async cancelFulfillmentOrder(_externalOrderId: string): Promise<void> {
    this.notConfigured('cancelFulfillmentOrder');
  }

  async getShipment(_externalOrderId: string): Promise<FulfillmentProviderShipment | null> {
    this.notConfigured('getShipment');
  }

  async getTracking(_externalOrderId: string): Promise<FulfillmentProviderTrackingEvent[]> {
    this.notConfigured('getTracking');
  }

  supportsPickupPoint(): boolean {
    return false;
  }

  supportsLabels(): boolean {
    return false;
  }

  supportsMarketplaceShippingRequirements(): boolean {
    return false;
  }
}
