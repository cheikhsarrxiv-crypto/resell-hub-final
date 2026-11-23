/**
 * R3-C.9 — plan limits and the AI-agent surface, per workspace, on the dedicated
 * local test database. Real route handlers, services, Prisma and
 * `@/lib/security`; only `@/auth` is replaced. No LLM is ever called (the
 * tested AI routes read / cancel stored actions and read history only).
 *
 * Run ONLY through the guarded runner:
 *   node scripts/r3c/run-with-test-db.mjs vitest src/__tests__/isolation/r3c-plans-ai.live.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { enforceGuardForTestRun } from '@/lib/testing/dbSafetyGuard';
import { connectGuardedPrisma, createAbFixture, cleanupAbFixture, snapshotTenant, type AbFixture } from '@/lib/testing/r3cHarness';
import { attachPlans, detachPlans, type PlansFixture } from '@/lib/testing/r3cPlans';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@/auth', () => ({ auth: authMock }));

const guarded = enforceGuardForTestRun(process.env) === 'guarded';

import * as productsRoute from '@/app/api/products/route';
import * as agentRoute from '@/app/api/ai/agent/route';
import * as actionRoute from '@/app/api/ai/agent/actions/[id]/route';
import * as confirmRoute from '@/app/api/ai/agent/actions/[id]/confirm/route';
import * as cancelRoute from '@/app/api/ai/agent/actions/[id]/cancel/route';

describe.skipIf(!guarded)('R3-C.9 — plan limits and AI agent are per workspace', () => {
  let prisma: PrismaClient;
  let fx: AbFixture;
  let plans: PlansFixture;
  let beforeB: string;

  beforeAll(async () => {
    prisma = await connectGuardedPrisma();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    fx = await createAbFixture(prisma);
    // A: one unit of headroom on every limit (its own counts are 2 products / 1 listing / 1 order / 1 connection).
    // The SAME rows of B must not be counted towards A: a global count would already hit these limits.
    plans = await attachPlans(
      prisma, fx,
      { maxProducts: 3, maxListings: 2, maxOrders: 2, maxMarketplaces: 2, aiAssistant: true, fulfillmentEnabled: true, advancedAnalytics: false },
      { maxProducts: 100, maxListings: 100, maxOrders: 100, maxMarketplaces: 100, aiAssistant: true, fulfillmentEnabled: false, advancedAnalytics: true }
    );
    beforeB = await snapshotTenant(prisma, fx.B);
    asA();
  });
  afterEach(async () => {
    if (plans) await detachPlans(prisma, fx, plans);
    if (fx) await cleanupAbFixture(prisma, fx);
  });

  const asA = () => authMock.mockResolvedValue({ user: { id: fx.A.userId, workspaceId: fx.A.workspaceId } });
  const asB = () => authMock.mockResolvedValue({ user: { id: fx.B.userId, workspaceId: fx.B.workspaceId } });
  const expectBUnchanged = async () => expect(await snapshotTenant(prisma, fx.B)).toBe(beforeB);

  async function call(handler: (req: NextRequest, ctx?: any) => Promise<Response>, method: string, url: string, params?: Record<string, string>, body?: unknown) {
    const response = await handler(
      new NextRequest(`http://localhost${url}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      params ? { params } : undefined
    );
    const raw = await response.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { /* not json */ }
    return { status: response.status, raw, json };
  }

  describe('plan limits count only the workspace\'s own rows', () => {
    it('A is below every limit although A + B together would exceed them (counts are not global)', async () => {
      const { SubscriptionService } = await import('@/services/SubscriptionService');
      for (const resource of ['products', 'listings', 'orders', 'marketplaces'] as const) {
        expect(await SubscriptionService.isLimitReached(fx.A.workspaceId, resource), `A ${resource}`).toBe(false);
        expect(await SubscriptionService.isLimitReached(fx.B.workspaceId, resource), `B ${resource}`).toBe(false);
      }
    });

    it("A's own extra rows reach A's limit; B (same counts, bigger plan) is unaffected", async () => {
      const { SubscriptionService } = await import('@/services/SubscriptionService');
      const extra = await prisma.product.create({
        data: { workspaceId: fx.A.workspaceId, sku: `${fx.runId}-a-extra`, title: 'extra', description: 'synthetic', purchasePrice: 1, sellingPrice: 2, quantity: 1 },
      });
      try {
        expect(await SubscriptionService.isLimitReached(fx.A.workspaceId, 'products')).toBe(true);
        expect(await SubscriptionService.isLimitReached(fx.B.workspaceId, 'products')).toBe(false);
      } finally {
        await prisma.product.deleteMany({ where: { id: extra.id } });
      }
    });

    it('POST /api/products is refused for A at its limit (nothing created) and still allowed for B', async () => {
      const extra = await prisma.product.create({
        data: { workspaceId: fx.A.workspaceId, sku: `${fx.runId}-a-extra`, title: 'extra', description: 'synthetic', purchasePrice: 1, sellingPrice: 2, quantity: 1 },
      });
      const created: string[] = [extra.id];
      try {
        const body = { title: 'one more', description: 'synthetic text', purchasePrice: 1, sellingPrice: 2, quantity: 1 };
        const countA = await prisma.product.count({ where: { workspaceId: fx.A.workspaceId } });
        asA();
        const refused = await call(productsRoute.POST, 'POST', `/api/products?workspaceId=${fx.A.workspaceId}`, undefined, body);
        expect([400, 402, 403, 409, 500]).toContain(refused.status);
        expect(await prisma.product.count({ where: { workspaceId: fx.A.workspaceId } })).toBe(countA);

        asB();
        const ok = await call(productsRoute.POST, 'POST', `/api/products?workspaceId=${fx.B.workspaceId}`, undefined, body);
        expect([200, 201]).toContain(ok.status);
        const bNew = await prisma.product.findMany({ where: { workspaceId: fx.B.workspaceId, title: 'one more' }, select: { id: true } });
        created.push(...bNew.map((p) => p.id));
        expect(bNew).toHaveLength(1);
      } finally {
        await prisma.productImage.deleteMany({ where: { productId: { in: created } } });
        await prisma.inventory.deleteMany({ where: { productId: { in: created } } });
        await prisma.product.deleteMany({ where: { id: { in: created } } });
      }
    });

    it('soft-deleted products do not count towards the limit', async () => {
      const { SubscriptionService } = await import('@/services/SubscriptionService');
      const extra = await prisma.product.create({
        data: { workspaceId: fx.A.workspaceId, sku: `${fx.runId}-a-extra`, title: 'extra', description: 'synthetic', purchasePrice: 1, sellingPrice: 2, quantity: 1 },
      });
      try {
        expect(await SubscriptionService.isLimitReached(fx.A.workspaceId, 'products')).toBe(true);
        await prisma.product.update({ where: { id: extra.id }, data: { deletedAt: new Date() } });
        expect(await SubscriptionService.isLimitReached(fx.A.workspaceId, 'products')).toBe(false);
      } finally {
        await prisma.product.deleteMany({ where: { id: extra.id } });
      }
    });

    it("one workspace's subscription status never changes another's entitlements", async () => {
      const { SubscriptionService } = await import('@/services/SubscriptionService');
      expect(await SubscriptionService.hasFeature(fx.A.workspaceId, 'aiAssistant')).toBe(true);
      expect(await SubscriptionService.hasFeature(fx.B.workspaceId, 'aiAssistant')).toBe(true);
      await prisma.subscription.update({ where: { id: plans.A.subscriptionId }, data: { status: 'cancelled' } });
      expect(await SubscriptionService.hasFeature(fx.A.workspaceId, 'aiAssistant')).toBe(false);
      expect(await SubscriptionService.hasFeature(fx.B.workspaceId, 'aiAssistant')).toBe(true);
      // features come from each workspace's own plan
      expect(await SubscriptionService.hasFeature(fx.B.workspaceId, 'advancedAnalytics')).toBe(true);
      expect(await SubscriptionService.hasFeature(fx.A.workspaceId, 'advancedAnalytics')).toBe(false);
    });
  });

  describe('AI agent actions and conversations', () => {
    it("A reads its own action and conversation (positive control) but never B's", async () => {
      const own = await call(actionRoute.GET, 'GET', `/api/ai/agent/actions/x`, { id: fx.A.actionId });
      expect(own.status).toBe(200);
      const foreign = await call(actionRoute.GET, 'GET', `/api/ai/agent/actions/x`, { id: fx.B.actionId });
      expect(foreign.status).toBe(404);
      expect(foreign.raw).not.toContain(`${fx.runId}-b`);
      expect(foreign.raw).not.toContain(fx.B.actionId);

      const conv = await call(agentRoute.GET, 'GET', `/api/ai/agent?conversationId=${fx.A.conversationId}`);
      expect(conv.status).toBe(200);
      expect(conv.raw).toContain(`${fx.runId}-a`);
      const foreignConv = await call(agentRoute.GET, 'GET', `/api/ai/agent?conversationId=${fx.B.conversationId}`);
      expect(foreignConv.raw).not.toContain(`${fx.runId}-b`);
      expect(foreignConv.status).not.toBe(200);
    });

    it("confirm / cancel on B's action are refused and B's action is untouched", async () => {
      const confirm = await call(confirmRoute.POST, 'POST', `/api/ai/agent/actions/x/confirm`, { id: fx.B.actionId });
      const cancel = await call(cancelRoute.POST, 'POST', `/api/ai/agent/actions/x/cancel`, { id: fx.B.actionId });
      expect(confirm.status).toBe(404);
      expect(cancel.status).toBe(404);
      await expectBUnchanged();
    });

    it("cancel works on A's own pending action and does not touch B", async () => {
      const res = await call(cancelRoute.POST, 'POST', `/api/ai/agent/actions/x/cancel`, { id: fx.A.actionId });
      expect(res.status).toBe(200);
      expect((await prisma.agentAction.findUniqueOrThrow({ where: { id: fx.A.actionId } })).status).toBe('CANCELLED');
      await expectBUnchanged();
    });

    it('the workspace comes only from the session: a workspaceId in the query string is ignored', async () => {
      const res = await call(actionRoute.GET, 'GET', `/api/ai/agent/actions/x?workspaceId=${fx.B.workspaceId}`, { id: fx.B.actionId });
      expect(res.status).toBe(404);
      expect(res.raw).not.toContain(`${fx.runId}-b`);
    });

    it("B's session without the AI feature gets 403 for everything, including A's action id (no information)", async () => {
      await prisma.plan.update({ where: { id: plans.B.planId }, data: { aiAssistant: false } });
      asB();
      for (const res of [
        await call(actionRoute.GET, 'GET', `/api/ai/agent/actions/x`, { id: fx.B.actionId }),
        await call(actionRoute.GET, 'GET', `/api/ai/agent/actions/x`, { id: fx.A.actionId }),
        await call(cancelRoute.POST, 'POST', `/api/ai/agent/actions/x/cancel`, { id: fx.A.actionId }),
        await call(agentRoute.GET, 'GET', `/api/ai/agent?conversationId=${fx.A.conversationId}`),
      ]) {
        expect(res.status).toBe(403);
        expect(res.raw).not.toContain(`${fx.runId}-a`);
      }
      expect((await prisma.agentAction.findUniqueOrThrow({ where: { id: fx.A.actionId } })).status).toBe('PENDING_CONFIRMATION');
    });

    it('a session with a cancelled subscription cannot use the agent (entitlement is checked live)', async () => {
      await prisma.subscription.update({ where: { id: plans.A.subscriptionId }, data: { status: 'cancelled' } });
      const res = await call(actionRoute.GET, 'GET', `/api/ai/agent/actions/x`, { id: fx.A.actionId });
      expect(res.status).toBe(403);
    });

    it('no session -> 401; a session without workspace -> 403 (nothing is guessed)', async () => {
      authMock.mockResolvedValue(null);
      expect((await call(actionRoute.GET, 'GET', `/api/ai/agent/actions/x`, { id: fx.A.actionId })).status).toBe(401);
      authMock.mockResolvedValue({ user: { id: fx.A.userId } });
      expect((await call(actionRoute.GET, 'GET', `/api/ai/agent/actions/x`, { id: fx.A.actionId })).status).toBe(403);
    });

    it("AiActionService transitions are workspace-scoped at the SQL level: A's workspace id cannot move B's action", async () => {
      const { AiActionService } = await import('@/services/ai/AiActionService');
      expect(await AiActionService.cancelAction(fx.A.workspaceId, fx.A.userId, fx.B.actionId).catch(() => null)).toBeNull();
      expect(await AiActionService.confirmAndExecute(fx.A.workspaceId, fx.A.userId, fx.B.actionId).catch(() => null)).toBeNull();
      await expectBUnchanged();
    });
  });
});
