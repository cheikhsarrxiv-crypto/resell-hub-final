import { prisma } from '@/lib/prisma';
import { getFulfillmentProvider } from './registry';

export interface FulfillmentReconciliationResult {
  fulfillmentOrderId: string;
  inSync: boolean;
  localStatus: string;
  providerStatus: string | null;
  detail: string;
}

/**
 * Reconciliation — compares ADKSY's own FulfillmentOrder.status against
 * what the resolved provider itself reports via getFulfillmentOrder().
 * Detection only: this NEVER writes back to FulfillmentOrder/Shipment —
 * deciding which side wins a mismatch (and whether to notify the
 * reseller) is a product decision out of this phase's scope, not
 * something to invent here.
 *
 * Only meaningful for a FulfillmentOrder that actually went through
 * FulfillmentService.sendToFulfillmentViaProvider (so it has a real
 * provider-assigned externalOrderId) — one created via the plain,
 * unchanged sendToFulfillment path (no provider involved, the default
 * today) has no provider to reconcile against, and this function reports
 * that honestly rather than guessing.
 */
export async function reconcileFulfillmentOrder(
  fulfillmentOrderId: string,
  workspaceId: string,
  providerId: string
): Promise<FulfillmentReconciliationResult> {
  const fulfillmentOrder = await prisma.fulfillmentOrder.findFirst({ where: { id: fulfillmentOrderId, workspaceId } });
  if (!fulfillmentOrder) {
    throw new Error('Fulfillment order not found');
  }

  if (!fulfillmentOrder.externalOrderId) {
    return {
      fulfillmentOrderId,
      inSync: true, // nothing to reconcile against — not a mismatch
      localStatus: fulfillmentOrder.status,
      providerStatus: null,
      detail: 'No provider externalOrderId recorded for this fulfillment order — nothing to reconcile.',
    };
  }

  const provider = getFulfillmentProvider(providerId);
  const providerOrder = await provider.getFulfillmentOrder(fulfillmentOrder.externalOrderId);

  return {
    fulfillmentOrderId,
    inSync: providerOrder.status === fulfillmentOrder.status,
    localStatus: fulfillmentOrder.status,
    providerStatus: providerOrder.status,
    detail:
      providerOrder.status === fulfillmentOrder.status
        ? 'ADKSY and the provider agree on this order\'s status.'
        : `Mismatch: ADKSY has "${fulfillmentOrder.status}", the provider reports "${providerOrder.status}".`,
  };
}
