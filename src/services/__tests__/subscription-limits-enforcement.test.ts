/**
 * Real-DB tests proving subscription plan limits/features are actually
 * enforced server-side, not just displayed in the UI.
 *
 * Three real bugs fixed together here:
 *  1. SubscriptionService.isLimitReached() treated limit===0 as "no
 *     limit" (returned false/allowed) instead of "blocked" — inverted.
 *  2. ProductService.createProduct / ListingService.createListing /
 *     OrderService.createOrder each had their own inline
 *     `if (subscription?.plan) {...}` check that was silently SKIPPED
 *     for a workspace with no active subscription (or a canceled one
 *     with plan unset) — giving unlimited access instead of the free
 *     tier. They now go through SubscriptionService, whose
 *     getSubscription() falls back to the real 'free' plan.
 *  3. fulfillmentEnabled / maxMarketplaces were defined in the Plan
 *     schema and seeded with real values but never checked by any
 *     route or service — any user on any plan could use them.
 */
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SubscriptionService } from '@/services/SubscriptionService';
import { ProductService } from '@/services/ProductService';
import { FulfillmentService } from '@/services/FulfillmentService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

async function ensurePlans() {
  // Plan.name is globally unique and shared with other test files that
  // also upsert 'free'/'pro' — use a non-empty `update` so this file's
  // exact limit values are always in effect for its own assertions
  // regardless of what another file's upsert left behind, instead of
  // silently no-op'ing via `update: {}` when the row already exists.
  const freeFields = {
    displayName: 'Free',
    maxProducts: 2, maxListings: 20, maxOrders: 50, maxMarketplaces: 2, maxUsers: 1,
    fulfillmentEnabled: false,
  };
  await prisma.plan.upsert({
    where: { name: 'free' },
    update: freeFields,
    create: { name: 'free', ...freeFields },
  });

  const proFields = {
    displayName: 'Pro', price: 49,
    maxProducts: 500, maxListings: 1500, maxOrders: 2000, maxMarketplaces: 4, maxUsers: 1,
    fulfillmentEnabled: true,
  };
  const pro = await prisma.plan.upsert({
    where: { name: 'pro' },
    update: proFields,
    create: { name: 'pro', ...proFields },
  });
  return { pro };
}

async function createWorkspace(withProSubscription = false) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { pro } = await ensurePlans();

  const user = await prisma.user.create({
    data: { email: `sub-limit-test-${suffix}@example.com`, name: 'Test User', password: 'x' },
  });

  let subscription = null;
  if (withProSubscription) {
    subscription = await prisma.subscription.create({
      data: { planId: pro.id, status: 'active' },
    });
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Test WS',
      slug: `sub-limit-test-${suffix}`,
      userId: user.id,
      subscriptionId: subscription?.id,
    },
  });

  return { user, workspace };
}

async function cleanup(ids: { userId: string; workspaceId: string }) {
  await prisma.product.deleteMany({ where: { workspaceId: ids.workspaceId } }).catch(() => {});
  await prisma.workspace.delete({ where: { id: ids.workspaceId } }).catch(() => {});
  await prisma.user.delete({ where: { id: ids.userId } }).catch(() => {});
}

describe.skipIf(!dbAvailable)('SubscriptionService.isLimitReached - no-subscription = free tier, not unlimited', () => {
  it('a workspace with no subscription is capped at the free plan limit, not unlimited', async () => {
    const { user, workspace } = await createWorkspace(false);

    try {
      // Free plan seeded above with maxProducts: 2.
      await prisma.product.createMany({
        data: [
          { workspaceId: workspace.id, sku: 'A', title: 'A', description: 'Test product' },
          { workspaceId: workspace.id, sku: 'B', title: 'B', description: 'Test product' },
        ],
      });

      const reached = await SubscriptionService.isLimitReached(workspace.id, 'products');
      expect(reached).toBe(true);
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id });
    }
  });

  it('ProductService.createProduct rejects once the free-tier limit is hit for a no-subscription workspace', async () => {
    const { user, workspace } = await createWorkspace(false);

    try {
      await prisma.product.createMany({
        data: [
          { workspaceId: workspace.id, sku: 'A2', title: 'A2', description: 'Test product' },
          { workspaceId: workspace.id, sku: 'B2', title: 'B2', description: 'Test product' },
        ],
      });

      await expect(
        ProductService.createProduct(workspace.id, {
          sku: 'C2',
          title: 'Should be rejected',
          purchasePrice: 10,
          sellingPrice: 20,
          fulfillmentCost: 0,
          quantity: 1,
        } as any)
      ).rejects.toThrow('Product limit reached for your plan');
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id });
    }
  });

  it('a workspace on the Pro plan is not blocked by the free-tier limit', async () => {
    const { user, workspace } = await createWorkspace(true);

    try {
      await prisma.product.createMany({
        data: [
          { workspaceId: workspace.id, sku: 'A3', title: 'A3', description: 'Test product' },
          { workspaceId: workspace.id, sku: 'B3', title: 'B3', description: 'Test product' },
          { workspaceId: workspace.id, sku: 'C3', title: 'C3', description: 'Test product' },
        ],
      });

      const reached = await SubscriptionService.isLimitReached(workspace.id, 'products');
      expect(reached).toBe(false); // Pro's maxProducts is 500, far above 3
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id });
    }
  });
});

describe.skipIf(!dbAvailable)('FulfillmentService.sendToFulfillment - fulfillmentEnabled is enforced server-side', () => {
  it('rejects for a free-plan (no subscription) workspace before touching order data', async () => {
    const { user, workspace } = await createWorkspace(false);

    try {
      await expect(
        FulfillmentService.sendToFulfillment('nonexistent-order-id', workspace.id, 'nonexistent-partner-id')
      ).rejects.toThrow('Fulfillment is not included in your current plan');
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id });
    }
  });

  it('does not reject on the plan gate for a Pro-plan workspace (fails later, on missing order, instead)', async () => {
    const { user, workspace } = await createWorkspace(true);

    try {
      await expect(
        FulfillmentService.sendToFulfillment('nonexistent-order-id', workspace.id, 'nonexistent-partner-id')
      ).rejects.toThrow('Order not found');
    } finally {
      await cleanup({ userId: user.id, workspaceId: workspace.id });
    }
  });
});
