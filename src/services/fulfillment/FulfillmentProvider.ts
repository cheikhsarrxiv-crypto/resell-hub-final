/**
 * FulfillmentProvider
 *
 * STATUS (Fulfillment Integration Foundation V1): NOW IMPLEMENTED BY ONE
 * REAL PROVIDER — MockFulfillmentProvider (./providers/MockFulfillmentProvider.ts),
 * resolved via getFulfillmentProvider('mock') in ./registry.ts. Every other
 * provider id this registry knows about (frenchlog/vintedmkp/colock_box/
 * nexeuro — see registry.ts's PLANNED_PARTNER_PROVIDER_IDS) resolves to
 * NotConfiguredFulfillmentProvider, which implements this same interface
 * but throws FulfillmentProviderError('NOT_CONFIGURED', ...) from every
 * method, NEVER performing a real network call. No real partner adapter
 * exists yet because no real partner API documentation has been received —
 * see docs/fulfillment/PARTNER-INTEGRATION-CHECKLIST.md for what adding one
 * requires.
 *
 * Original Phase 8 audit finding (still true for every id except "mock"):
 * ADKSY's fulfillment code had no adapter abstraction at all, unlike the
 * marketplace side (see MarketplaceAdapter.ts). FulfillmentService's
 * simulateOrderAccepted/Processing/Shipped/Delivered methods remain
 * hand-rolled, DB-only simulations, UNCHANGED by this phase.
 *
 * Phase C update: FulfillmentService.sendToFulfillment is now the real
 * entry point — it dispatches to this interface automatically whenever
 * the order's FulfillmentPartner has a `providerId` configured
 * (FulfillmentPartner.providerId, additive nullable column). Every
 * partner that exists today (including the seeded "ShipMock France") has
 * `providerId: null`, so send_to_fulfillment and the dashboard see
 * EXACTLY their historical behavior until a partner is explicitly given
 * a real `providerId`. sendToFulfillmentViaProvider remains available as
 * an explicit-override entry point (bypassing whatever is or isn't
 * configured on the partner row) for direct testing.
 *
 * Every method still throws via FulfillmentProviderError (./errors.ts)
 * rather than a plain Error, so callers can branch on a real `.code`
 * (NOT_CONFIGURED / UNSUPPORTED_OPERATION / AUTH_FAILURE /
 * VALIDATION_FAILURE / TEMPORARY_FAILURE / PERMANENT_FAILURE) instead of
 * matching message strings.
 */

export interface FulfillmentOrderLine {
  productId: string;
  sku: string;
  title: string;
  quantity: number;
}

/**
 * A marketplace can impose real shipping requirements ADKSY must pass
 * through to a fulfillment partner (carrier, service level, shipping
 * method, pickup point/locker, label artifact + format, a QR/reference
 * code, tracking requirements, handling/delivery deadlines).
 *
 * PERSISTENCE STATUS (Fulfillment Integration Foundation V1 audit): as of
 * this phase, NOTHING in ADKSY's real marketplace sync (OrdersSyncService,
 * EbayAdapter, EtsyAdapter) extracts or stores any of these fields — Order/
 * OrderItem/FulfillmentOrder have no columns for them today, and no caller
 * can supply a real, non-fabricated value for any field below yet. This
 * interface is therefore kept TypeScript-only and NOT persisted to Prisma
 * in this phase — adding a column to store a value nothing produces would
 * violate "never invent a value" as surely as inventing the value itself.
 * The moment a real marketplace or partner integration supplies real data
 * here, persisting it is a small additive migration (e.g. a nullable
 * `FulfillmentOrder.shippingRequirements Json?`) — not a redesign. See
 * docs/fulfillment/ARCHITECTURE.md for this decision's full reasoning.
 *
 * Every field is optional: never populated with a guessed/default value
 * when a marketplace doesn't supply it.
 */
export interface MarketplaceShippingRequirements {
  marketplace: string;
  carrier?: string;
  service?: string;
  /** The marketplace's own shipping-method label (e.g. "standard",
   * "express") — distinct from `service`, which names the carrier's own
   * service tier; some marketplaces expose one, some the other, some
   * both. */
  shippingMethod?: string;
  pickupPoint?: string;
  locker?: string;
  requiresLabel?: boolean;
  /** Where to find the actual label artifact once the partner has
   * generated one (a URL) — distinct from `requiresLabel`, which only
   * says whether the marketplace demands a label at all. */
  labelUrl?: string;
  /** The label's own file format (e.g. "PDF", "ZPL", "PNG") — a free
   * string, never constrained to a guessed enum. */
  labelFormat?: string;
  requiresTrackingNumber?: boolean;
  /** A QR code or reference string the marketplace/carrier requires on
   * the parcel, distinct from the eventual carrier tracking number. */
  trackingReference?: string;
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
  // 'packed' added for the Mock provider's full lifecycle (created ->
  // accepted -> processing -> packed -> shipped -> delivered) — purely
  // additive to this union, never removes or renames an existing value, so
  // every existing FulfillmentOrder.status string ('pending', 'accepted',
  // 'processing', 'shipped', 'delivered', 'failed', 'cancelled') stays
  // valid and unaffected.
  status: 'pending' | 'accepted' | 'processing' | 'packed' | 'shipped' | 'delivered' | 'failed' | 'cancelled';
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
