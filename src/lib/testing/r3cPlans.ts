/**
 * R3-C.9 — plans and subscriptions for the A/B harness, on the dedicated local
 * test database only. Plan rows are global, so every plan gets a run-unique
 * name and the exact ids are recorded and removed afterwards.
 */
import type { PrismaClient } from '@prisma/client';
import type { AbFixture } from './r3cHarness';

export interface PlanSpec {
  maxProducts: number;
  maxListings: number;
  maxOrders: number;
  maxMarketplaces: number;
  aiAssistant: boolean;
  fulfillmentEnabled: boolean;
  advancedAnalytics: boolean;
  subscriptionStatus?: string;
}

export interface PlansFixture {
  planIds: string[];
  subscriptionIds: string[];
  A: { planId: string; subscriptionId: string };
  B: { planId: string; subscriptionId: string };
}

async function attach(prisma: PrismaClient, runId: string, side: 'a' | 'b', workspaceId: string, spec: PlanSpec) {
  const plan = await prisma.plan.create({
    data: {
      name: `${runId}-plan-${side}`,
      displayName: `R3C plan ${side}`,
      maxProducts: spec.maxProducts,
      maxListings: spec.maxListings,
      maxOrders: spec.maxOrders,
      maxMarketplaces: spec.maxMarketplaces,
      aiAssistant: spec.aiAssistant,
      fulfillmentEnabled: spec.fulfillmentEnabled,
      advancedAnalytics: spec.advancedAnalytics,
    },
  });
  const subscription = await prisma.subscription.create({
    data: { planId: plan.id, status: spec.subscriptionStatus ?? 'active' },
  });
  await prisma.workspace.update({ where: { id: workspaceId }, data: { subscriptionId: subscription.id } });
  return { planId: plan.id, subscriptionId: subscription.id };
}

export async function attachPlans(prisma: PrismaClient, fx: AbFixture, a: PlanSpec, b: PlanSpec): Promise<PlansFixture> {
  const A = await attach(prisma, fx.runId, 'a', fx.A.workspaceId, a);
  const B = await attach(prisma, fx.runId, 'b', fx.B.workspaceId, b);
  return { planIds: [A.planId, B.planId], subscriptionIds: [A.subscriptionId, B.subscriptionId], A, B };
}

/** Removes exactly the recorded plans / subscriptions (workspaces are un-linked first). */
export async function detachPlans(prisma: PrismaClient, fx: AbFixture, plans: PlansFixture): Promise<void> {
  await prisma.workspace.updateMany({
    where: { id: { in: [fx.A.workspaceId, fx.B.workspaceId] }, subscriptionId: { in: plans.subscriptionIds } },
    data: { subscriptionId: null },
  });
  await prisma.subscription.deleteMany({ where: { id: { in: plans.subscriptionIds } } });
  await prisma.plan.deleteMany({ where: { id: { in: plans.planIds } } });
}
