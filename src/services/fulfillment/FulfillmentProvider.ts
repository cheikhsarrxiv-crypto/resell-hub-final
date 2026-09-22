/**
 * FulfillmentProvider
 *
 * STATUS: DOCUMENTED CONTRACT ONLY — NO IMPLEMENTATION, NO REGISTRATION.
 *
 * Phase 8 audit finding: ADKSY's fulfillment code has no adapter
 * abstraction at all today, unlike the marketplace side (see
 * MarketplaceAdapter.ts, which is itself explicitly "abstract interface -
 * no implementation" for several methods). FulfillmentService's
 * simulateOrderAccepted/Processing/Shipped/Delivered methods are hand-
 * rolled, DB-only simulations — no real fulfillment partner API is ever
 * called anywhere in this codebase (FulfillmentPartner.apiUrl/apiKey are
 * stored columns, never read by any HTTP call). This file exists purely to
 * document the real capability surface a future real fulfillment
 * integration would need — it is intentionally NOT wired into
 * FulfillmentService, NOT registered anywhere, and implemented by NOTHING.
 *
 * Per this phase's own explicit instruction ("NE PAS implémenter un
 * provider fictif... si aucun provider réel n'est connecté, l'architecture
 * peut être préparée mais le système doit rester honnête"): declaring this
 * interface is the "architecture prepared" part; FulfillmentService
 * continuing to only ever call its own simulate* methods (clearly named as
 * such, never claiming a real partner call happened) is the "stays honest"
 * part. A real provider is added by writing a class that implements this
 * interface and wiring FulfillmentService to call it — nothing in this
 * file itself performs that wiring.
 */

export interface FulfillmentOrderLine {
  productId: string;
  sku: string;
  title: string;
  quantity: number;
}

/**
 * A marketplace can impose real shipping requirements ADKSY must pass
 * through to a fulfillment partner (carrier, service level, pickup point/
 * locker, label format, tracking requirements, handling/delivery
 * deadlines) — see this phase's own audit report for exactly which of
 * these Order/OrderItem/FulfillmentOrder already store today (none yet)
 * and which are a documented gap, never invented here.
 */
export interface MarketplaceShippingRequirements {
  marketplace: string;
  carrier?: string;
  service?: string;
  pickupPoint?: string;
  locker?: string;
  requiresLabel?: boolean;
  requiresTrackingNumber?: boolean;
  handlingDeadline?: Date;
  deliveryDeadline?: Date;
}

export interface CreateFulfillmentOrderInput {
  workspaceId: string;
  orderId: string;
  items: FulfillmentOrderLine[];
  shippingAddress: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
    phone?: string;
    email?: string;
  };
  shippingRequirements?: MarketplaceShippingRequirements;
}

export interface FulfillmentProviderOrderStatus {
  externalOrderId: string;
  status: 'pending' | 'accepted' | 'processing' | 'shipped' | 'delivered' | 'failed' | 'cancelled';
}

export interface FulfillmentProviderShipment {
  externalOrderId: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  estimatedDelivery: Date | null;
  actualDelivery: Date | null;
}

export interface FulfillmentProviderTrackingEvent {
  status: string;
  location: string | null;
  description: string | null;
  timestamp: Date;
}

/**
 * The real capability surface a future fulfillment partner integration
 * would implement. Every method is REQUIRED to reach the real partner API
 * — there is no default/simulated implementation here, unlike
 * MarketplaceAdapter's own abstract class (which at least provides a real,
 * callable base for its concrete subclasses). A provider that cannot
 * really support a capability (e.g. no pickup-point network) reports that
 * honestly via the `supports*` methods rather than pretending — the same
 * "never claim a capability that isn't real" rule this whole phase applies
 * to fulfillment/tracking data.
 */
export interface FulfillmentProvider {
  readonly name: string;

  createFulfillmentOrder(input: CreateFulfillmentOrderInput): Promise<FulfillmentProviderOrderStatus>;
  getFulfillmentOrder(externalOrderId: string): Promise<FulfillmentProviderOrderStatus>;
  cancelFulfillmentOrder(externalOrderId: string): Promise<void>;

  getShipment(externalOrderId: string): Promise<FulfillmentProviderShipment | null>;
  getTracking(externalOrderId: string): Promise<FulfillmentProviderTrackingEvent[]>;

  supportsPickupPoint(): boolean;
  supportsLabels(): boolean;
  supportsMarketplaceShippingRequirements(): boolean;
}
