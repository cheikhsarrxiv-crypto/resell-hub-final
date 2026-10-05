import { FulfillmentProviderError } from './errors';
import type { FulfillmentProvider } from './FulfillmentProvider';
import { MockFulfillmentProvider } from './providers/MockFulfillmentProvider';
import { NotConfiguredFulfillmentProvider } from './providers/NotConfiguredFulfillmentProvider';

/**
 * Partner ids ADKSY has a real, named business relationship or intent to
 * integrate with, but NO real API documentation for yet. Listed here only
 * so a stable id exists today for future config/FulfillmentPartner rows to
 * reference — resolving any of these returns NotConfiguredFulfillmentProvider,
 * never a real network call. Adding a real adapter for one of these is a
 * SEPARATE, future change (a new providers/<Name>Adapter.ts implementing
 * FulfillmentProvider, wired in here) — never done speculatively per
 * RÈGLE ABSOLUE #1/#2/#3 (never invent a partner API/endpoint/required
 * field).
 */
export const PLANNED_PARTNER_PROVIDER_IDS = ['frenchlog', 'vintedmkp', 'colock_box', 'nexeuro'] as const;
export type PlannedPartnerProviderId = (typeof PLANNED_PARTNER_PROVIDER_IDS)[number];

export type FulfillmentProviderId = 'mock' | PlannedPartnerProviderId;

export const KNOWN_FULFILLMENT_PROVIDER_IDS: readonly string[] = ['mock', ...PLANNED_PARTNER_PROVIDER_IDS];

// A single shared instance: the whole point of MockFulfillmentProvider's
// in-memory state (see its own header comment) is to behave like one
// simulated partner backend across calls within this process, the same way
// a real adapter would hold one real HTTP client, not a fresh one per
// call.
const mockProviderSingleton = new MockFulfillmentProvider();

/**
 * getFulfillmentProvider(providerId) — the one place in the codebase that
 * resolves a provider id string to a real FulfillmentProvider instance.
 * Nothing in FulfillmentService or any AI tool constructs a provider
 * class directly — they all go through this function, so adding a real
 * partner adapter later is a one-line change here, not a scattered one.
 *
 * - 'mock' -> the one real, fully-executable provider in this phase.
 * - any PLANNED_PARTNER_PROVIDER_IDS entry -> NotConfiguredFulfillmentProvider
 *   (same interface, every method throws NOT_CONFIGURED, zero I/O).
 * - anything else -> throws NOT_CONFIGURED too (an unknown id is, by
 *   definition, not configured) rather than a generic TypeError, so every
 *   caller gets the same typed error shape regardless of why resolution
 *   failed.
 */
export function getFulfillmentProvider(providerId: string): FulfillmentProvider {
  if (providerId === 'mock') {
    return mockProviderSingleton;
  }
  if ((PLANNED_PARTNER_PROVIDER_IDS as readonly string[]).includes(providerId)) {
    return new NotConfiguredFulfillmentProvider(providerId);
  }
  throw new FulfillmentProviderError('NOT_CONFIGURED', `Unknown fulfillment provider id: "${providerId}".`, providerId);
}

/** Test-only escape hatch to reset the shared mock provider's in-memory
 * state between test files/cases without reaching into registry
 * internals from each test. */
export function __getMockFulfillmentProviderForTests(): MockFulfillmentProvider {
  return mockProviderSingleton;
}
