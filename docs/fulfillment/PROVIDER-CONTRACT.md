# Provider Contract

File: `src/services/fulfillment/FulfillmentProvider.ts`.

## The `FulfillmentProvider` interface — IMPLEMENTED NOW (contract itself)

```ts
interface FulfillmentProvider {
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
```

Every method throws `FulfillmentProviderError` (never a plain `Error`) for
any expected failure — see its 6 codes below.

## Status vocabulary

`FulfillmentProviderOrderStatus.status`:
`'pending' | 'accepted' | 'processing' | 'packed' | 'shipped' | 'delivered' | 'failed' | 'cancelled'`

`'packed'` is new in this phase (purely additive to the union) to support
the full lifecycle this phase asked for. Every pre-existing value is
unchanged.

## Error taxonomy (`src/services/fulfillment/errors.ts`)

| Code | Meaning | `retryable` |
|---|---|---|
| `NOT_CONFIGURED` | No real integration exists for this provider id yet | `false` |
| `UNSUPPORTED_OPERATION` | The provider is real but doesn't support this specific call (e.g. cancel-after-ship) | `false` |
| `AUTH_FAILURE` | The provider rejected credentials/signature | `false` |
| `VALIDATION_FAILURE` | The request itself is invalid per the provider's own rules (e.g. insufficient stock) | `false` |
| `TEMPORARY_FAILURE` | Retrying later may succeed (network error, partner outage) | `true` |
| `PERMANENT_FAILURE` | Retrying will not help (e.g. unknown order id) | `false` |

## Implementations — who implements what

| Provider id | Class | Status | Makes real network calls? |
|---|---|---|---|
| `mock` | `MockFulfillmentProvider` | **IMPLEMENTED NOW** | **Never** — pure in-memory simulation |
| `frenchlog` | `NotConfiguredFulfillmentProvider` | **NOT CONFIGURED** | **Never** |
| `vintedmkp` | `NotConfiguredFulfillmentProvider` | **NOT CONFIGURED** | **Never** |
| `colock_box` | `NotConfiguredFulfillmentProvider` | **NOT CONFIGURED** | **Never** |
| `nexeuro` | `NotConfiguredFulfillmentProvider` | **NOT CONFIGURED** | **Never** |
| anything else | — | throws `NOT_CONFIGURED` from the registry itself | **Never** |

`NotConfiguredFulfillmentProvider` is ONE shared class for all four
partner ids — there is no per-partner file yet, because there is no real
per-partner API documentation to write one from (see
PARTNER-INTEGRATION-CHECKLIST.md for what's needed before one can exist).

## `MarketplaceShippingRequirements` — fields and persistence status

`carrier`, `service`, `shippingMethod`, `pickupPoint`, `locker`,
`requiresLabel`, `labelUrl`, `labelFormat`, `requiresTrackingNumber`,
`trackingReference`, `handlingDeadline`, `deliveryDeadline` — all
optional, never defaulted/guessed. **Not persisted to Prisma** — see
ARCHITECTURE.md's "Decision" section for why and what would change that.
