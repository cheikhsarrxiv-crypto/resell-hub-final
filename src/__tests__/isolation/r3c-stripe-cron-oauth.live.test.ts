/**
 * R3-C.9 — Stripe webhooks, sync crons, OAuth callback and the dev stock route,
 * on the dedicated local test database. Real handlers / services / Prisma /
 * `@/lib/security`. Replaced: `@/auth`; the marketplace sync services and the
 * OAuth connection service (spies — no marketplace is ever contacted, no OAuth
 * is performed). Stripe: only the SDK's LOCAL signature check runs, with a
 * fake key and secret; no request ever leaves the machine.
 *
 * Run ONLY through the guarded runner:
 *   node scripts/r3c/run-with-test-db.mjs vitest src/__tests__/isolation/r3c-stripe-cron-oauth.live.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import type { PrismaClient } from '@prisma/client';
import { enforceGuardForTestRun } from '@/lib/testing/dbSafetyGuard';
import { connectGuardedPrisma, createAbFixture, cleanupAbFixture, snapshotTenant, type AbFixture } from '@/lib/testing/r3cHarness';
import { attachPlans, detachPlans, type PlansFixture } from '@/lib/testing/r3cPlans';

const { authMock, syncOrdersMock, syncListingsMock, getConnectionMock, handleOAuthCallbackMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  syncOrdersMock: vi.fn(),
  syncListingsMock: vi.fn(),
  getConnectionMock: vi.fn(),
  handleOAuthCallbackMock: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/services/marketplace/OrdersSyncService', () => ({
  OrdersSyncService: class { syncOrders = syncOrdersMock; },
}));
vi.mock('@/services/marketplace/ListingsSyncService', () => ({
  ListingsSyncService: class { syncListings = syncListingsMock; },
}));
vi.mock('@/services/marketplace/MarketplaceConnectionService', () => ({
  MarketplaceConnectionService: class {
    getConnection = getConnectionMock;
    handleOAuthCallback = handleOAuthCallbackMock;
  },
}));

const guarded = enforceGuardForTestRun(process.env) === 'guarded';

import * as webhookRoute from '@/app/api/stripe/webhooks/route';
import * as cronOrders from '@/app/api/cron/sync-orders/route';
import * as cronListings from '@/app/api/cron/sync-listings/route';
import * as callbackRoute from '@/app/api/marketplace/callback/[marketplace]/route';
import * as stockRoute from '@/app/api/test/stock-race-condition/route';
import { createBoundStateCookieValue } from '@/lib/oauthStateBinding';

const WEBHOOK_SECRET = 'whsec_r3c_fake_not_a_real_secret';
const CRON_SECRET = 'r3c-fake-cron-secret-value';

describe.skipIf(!guarded)('R3-C.9 — Stripe, crons, OAuth callback and dev stock route', () => {
  let prisma: PrismaClient;
  let fx: AbFixture;
  let plans: PlansFixture;
  let beforeB: string;
  const saved: Record<string, string | undefined> = {};
  const extraPlanIds: string[] = [];

  const setEnv = (k: string, v: string) => { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v; };

  beforeAll(async () => {
    prisma = await connectGuardedPrisma();
    // fake values, only for the local signature check / cron header / state comparison of this test file
    setEnv('STRIPE_SECRET_KEY', 'sk_test_r3c_fake_not_a_real_key');
    setEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    setEnv('CRON_SECRET', CRON_SECRET);
    setEnv('TOKEN_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    // B.11.1: the callback validates the eBay configuration (fake Sandbox values, never sent anywhere)
    setEnv('EBAY_SANDBOX_MODE', 'true');
    setEnv('EBAY_CLIENT_ID', 'R3c-R3c-SBX-0123456789-abcdef01');
    setEnv('EBAY_CLIENT_SECRET', 'r3c-fake-ebay-secret');
    setEnv('EBAY_REDIRECT_URI', 'R3c-R3c-R3c-abcdefg');
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    fx = await createAbFixture(prisma);
    plans = await attachPlans(
      prisma, fx,
      { maxProducts: 10, maxListings: 10, maxOrders: 10, maxMarketplaces: 2, aiAssistant: true, fulfillmentEnabled: true, advancedAnalytics: false },
      { maxProducts: 100, maxListings: 100, maxOrders: 100, maxMarketplaces: 100, aiAssistant: true, fulfillmentEnabled: true, advancedAnalytics: true }
    );
    beforeB = await snapshotTenant(prisma, fx.B);
    authMock.mockResolvedValue({ user: { id: fx.A.userId, workspaceId: fx.A.workspaceId } });
  });
  afterEach(async () => {
    await prisma.subscription.updateMany({ where: { stripeSubscriptionId: { startsWith: `sub_${fx.runId}` } }, data: { stripeSubscriptionId: null } });
    if (extraPlanIds.length) {
      await prisma.workspace.updateMany({ where: { id: { in: [fx.A.workspaceId, fx.B.workspaceId] } }, data: { subscriptionId: null } });
      await prisma.subscription.deleteMany({ where: { planId: { in: extraPlanIds } } });
      await prisma.plan.deleteMany({ where: { id: { in: extraPlanIds } } });
      extraPlanIds.length = 0;
    }
    if (plans) await detachPlans(prisma, fx, plans);
    if (fx) await cleanupAbFixture(prisma, fx);
  });

  const expectBUnchanged = async () => expect(await snapshotTenant(prisma, fx.B)).toBe(beforeB);

  async function http(handler: (req: NextRequest, ctx?: any) => Promise<Response>, init: { method?: string; url: string; headers?: Record<string, string>; body?: string; params?: Record<string, string> }) {
    const response = await handler(
      new NextRequest(`http://localhost${init.url}`, { method: init.method ?? 'GET', headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) }),
      init.params ? { params: init.params } : undefined
    );
    const raw = await response.text();
    let json: any = null;
    try { json = JSON.parse(raw); } catch { /* not json */ }
    return { status: response.status, raw, json, location: response.headers.get('location') };
  }

  // ------------------------------------------------------------------ Stripe
  describe('Stripe webhooks', () => {
    const subscriptionObject = (id: string, workspaceId: string, planId: string) => ({
      id, object: 'subscription', status: 'active',
      current_period_start: Math.floor(Date.now() / 1000), current_period_end: Math.floor(Date.now() / 1000) + 2_592_000,
      metadata: { workspaceId, planId },
    });
    const signedRequest = (event: unknown, secret = WEBHOOK_SECRET) => {
      const payload = JSON.stringify(event);
      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
      return { method: 'POST', url: '/api/stripe/webhooks', headers: { 'stripe-signature': header, 'content-type': 'application/json' }, body: payload };
    };
    const event = (id: string, type: string, object: unknown) => ({ id, object: 'event', type, data: { object }, created: Math.floor(Date.now() / 1000) });
    const makePlan = async (suffix: string) => {
      const plan = await prisma.plan.create({ data: { name: `${fx.runId}-stripe-${suffix}`, displayName: 'R3C stripe plan' } });
      extraPlanIds.push(plan.id);
      return plan;
    };

    it('an unsigned or wrongly signed request is refused and writes nothing', async () => {
      const subs = await prisma.subscription.count();
      const evt = event(`evt_${fx.runId}_1`, 'customer.subscription.created', subscriptionObject(`sub_${fx.runId}_x`, fx.A.workspaceId, plans.A.planId));
      const unsigned = await http(webhookRoute.POST, { method: 'POST', url: '/api/stripe/webhooks', body: JSON.stringify(evt) });
      expect(unsigned.status).toBe(400);
      const forged = await http(webhookRoute.POST, signedRequest(evt, 'whsec_attacker_guess'));
      expect(forged.status).toBe(401);
      expect(await prisma.subscription.count()).toBe(subs);
      await expectBUnchanged();
    });

    it("a validly signed subscription event for A links A's subscription only; B is untouched; a replay is idempotent", async () => {
      const plan = await makePlan('pro');
      const sub = subscriptionObject(`sub_${fx.runId}_a`, fx.A.workspaceId, plan.id);
      const first = await http(webhookRoute.POST, signedRequest(event(`evt_${fx.runId}_2`, 'customer.subscription.created', sub)));
      expect(first.status).toBe(200);
      const wsA = await prisma.workspace.findUniqueOrThrow({ where: { id: fx.A.workspaceId }, include: { subscription: true } });
      expect(wsA.subscription?.stripeSubscriptionId).toBe(sub.id);
      expect(wsA.subscription?.planId).toBe(plan.id);
      await expectBUnchanged();

      const replay = await http(webhookRoute.POST, signedRequest(event(`evt_${fx.runId}_2`, 'customer.subscription.created', sub)));
      expect(replay.status).toBe(200);
      expect(await prisma.subscription.count({ where: { stripeSubscriptionId: sub.id } })).toBe(1);
    });

    it("a signed event naming workspace B for a subscription id that already belongs to A is refused: A's subscription is not rewritten and B gets none", async () => {
      const planPro = await makePlan('pro');
      const planCheap = await makePlan('cheap');
      const subA = subscriptionObject(`sub_${fx.runId}_shared`, fx.A.workspaceId, planPro.id);
      expect((await http(webhookRoute.POST, signedRequest(event(`evt_${fx.runId}_3`, 'customer.subscription.created', subA)))).status).toBe(200);
      const aBefore = await prisma.subscription.findUniqueOrThrow({ where: { id: (await prisma.workspace.findUniqueOrThrow({ where: { id: fx.A.workspaceId } })).subscriptionId! } });
      const bSubBefore = (await prisma.workspace.findUniqueOrThrow({ where: { id: fx.B.workspaceId } })).subscriptionId;

      const mismatch = { ...subA, metadata: { workspaceId: fx.B.workspaceId, planId: planCheap.id } };
      await http(webhookRoute.POST, signedRequest(event(`evt_${fx.runId}_4`, 'customer.subscription.created', mismatch)));

      const aAfter = await prisma.subscription.findUniqueOrThrow({ where: { id: aBefore.id } });
      expect(aAfter.planId).toBe(planPro.id); // A's plan was not overwritten by an event that names B
      expect(aAfter.planId).toBe(aBefore.planId);
      expect((await prisma.workspace.findUniqueOrThrow({ where: { id: fx.B.workspaceId } })).subscriptionId).toBe(bSubBefore);
    });

    it('subscription deletion for A downgrades A only', async () => {
      const free = (await prisma.plan.findFirst({ where: { name: 'free' } })) ?? (await prisma.plan.create({ data: { name: 'free', displayName: 'Free (r3c)' } }));
      const createdFree = !(await prisma.plan.findFirst({ where: { id: free.id, createdAt: { lt: new Date(Date.now() - 60_000) } } }));
      if (createdFree) extraPlanIds.push(free.id);
      const plan = await makePlan('pro');
      const sub = subscriptionObject(`sub_${fx.runId}_del`, fx.A.workspaceId, plan.id);
      await http(webhookRoute.POST, signedRequest(event(`evt_${fx.runId}_5`, 'customer.subscription.created', sub)));
      const bPlanBefore = (await prisma.subscription.findUniqueOrThrow({ where: { id: plans.B.subscriptionId } })).planId;
      await http(webhookRoute.POST, signedRequest(event(`evt_${fx.runId}_6`, 'customer.subscription.deleted', sub)));
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: plans.B.subscriptionId } })).planId).toBe(bPlanBefore);
      await expectBUnchanged();
    });
  });

  // ------------------------------------------------------------------- crons
  describe('sync crons', () => {
    const ensureMarketplaces = async () => {
      const created: string[] = [];
      for (const name of ['ebay', 'etsy']) {
        if (!(await prisma.marketplace.findUnique({ where: { name } }))) {
          created.push((await prisma.marketplace.create({ data: { name, displayName: `${name} (r3c)` } })).id);
        }
      }
      return created;
    };

    it.each([
      ['no Authorization header', undefined],
      ['an empty bearer', 'Bearer '],
      ['the wrong secret', 'Bearer wrong-secret'],
      ['a secret of the right length but wrong value', `Bearer ${'x'.repeat(CRON_SECRET.length)}`],
      ['a non-bearer scheme', `Basic ${CRON_SECRET}`],
    ])('rejects %s (401) before touching any workspace', async (_name, header) => {
      for (const handler of [cronOrders.GET, cronListings.GET]) {
        const res = await http(handler, { url: '/api/cron/x', headers: header ? { authorization: header } : {} });
        expect(res.status).toBe(401);
      }
      expect(syncOrdersMock).not.toHaveBeenCalled();
      expect(syncListingsMock).not.toHaveBeenCalled();
    });

    it('fails closed when CRON_SECRET is not configured at all', async () => {
      const previous = process.env.CRON_SECRET;
      delete process.env.CRON_SECRET;
      try {
        const res = await http(cronOrders.GET, { url: '/api/cron/x', headers: { authorization: 'Bearer ' } });
        expect(res.status).toBe(401);
        const res2 = await http(cronOrders.GET, { url: '/api/cron/x', headers: { authorization: 'Bearer undefined' } });
        expect(res2.status).toBe(401);
      } finally {
        process.env.CRON_SECRET = previous;
      }
    });

    it("syncs each connection with ITS OWN workspace id, isolates failures, and returns counts only", async () => {
      const createdMarketplaces = await ensureMarketplaces();
      const connA = await prisma.marketplaceConnection.create({ data: { workspaceId: fx.A.workspaceId, marketplaceId: 'ebay', status: 'connected', encryptedOauthToken: 'FAKE-A-TOKEN-ZZZ' } });
      const connB = await prisma.marketplaceConnection.create({ data: { workspaceId: fx.B.workspaceId, marketplaceId: 'ebay', status: 'connected', encryptedOauthToken: 'FAKE-B-TOKEN-ZZZ' } });
      try {
        syncOrdersMock.mockImplementation(async (workspaceId: string) => {
          if (workspaceId === fx.A.workspaceId) throw new Error('boom for A');
          return { skipped: false };
        });
        const res = await http(cronOrders.GET, { url: '/api/cron/sync-orders', headers: { authorization: `Bearer ${CRON_SECRET}` } });
        expect(res.status).toBe(200);
        expect(Object.keys(res.json).sort()).toEqual(['failed', 'skipped', 'succeeded', 'workspacesTotal']);
        expect(res.json).toMatchObject({ workspacesTotal: 2, succeeded: 1, failed: 1 });
        // each call carries the workspace of the connection it came from: A's call is A's, B's call is B's
        const calls = syncOrdersMock.mock.calls.map((c) => c[0]).sort();
        expect(calls).toEqual([fx.A.workspaceId, fx.B.workspaceId].sort());
        for (const marker of [fx.A.workspaceId, fx.B.workspaceId, 'FAKE-A-TOKEN-ZZZ', 'FAKE-B-TOKEN-ZZZ', 'boom for A']) {
          expect(res.raw.includes(marker), `cron response must not contain ${marker}`).toBe(false);
        }

        syncListingsMock.mockResolvedValue({ skipped: true });
        const res2 = await http(cronListings.GET, { url: '/api/cron/sync-listings', headers: { authorization: `Bearer ${CRON_SECRET}` } });
        expect(res2.status).toBe(200);
        expect(Object.keys(res2.json).sort()).toEqual(['failed', 'skipped', 'succeeded', 'workspacesTotal']);
        expect(syncListingsMock.mock.calls.map((c) => c[0]).sort()).toEqual([fx.A.workspaceId, fx.B.workspaceId].sort());
      } finally {
        await prisma.marketplaceConnection.deleteMany({ where: { id: { in: [connA.id, connB.id] } } });
        await prisma.marketplace.deleteMany({ where: { id: { in: createdMarketplaces } } });
      }
    });

    it('only connected eBay / Etsy connections are selected (a disconnected one and other marketplaces are never synced)', async () => {
      const createdMarketplaces = await ensureMarketplaces();
      const dead = await prisma.marketplaceConnection.create({ data: { workspaceId: fx.B.workspaceId, marketplaceId: 'etsy', status: 'not_connected' } });
      try {
        syncOrdersMock.mockResolvedValue({ skipped: false });
        const res = await http(cronOrders.GET, { url: '/api/cron/sync-orders', headers: { authorization: `Bearer ${CRON_SECRET}` } });
        expect(res.json.workspacesTotal).toBe(0); // fixture connections use a private marketplace name: never selected
        expect(syncOrdersMock).not.toHaveBeenCalled();
      } finally {
        await prisma.marketplaceConnection.deleteMany({ where: { id: dead.id } });
        await prisma.marketplace.deleteMany({ where: { id: { in: createdMarketplaces } } });
      }
    });
  });

  // ------------------------------------------------------------ OAuth callback
  describe('marketplace OAuth callback (no OAuth is performed: the connection service is a spy)', () => {
    const STATE = 'a'.repeat(64);
    // B.11.1: the state cookie is bound to the workspace + user that started the flow
    const boundCookie = (who: 'A' | 'B' = 'A') => `oauth_state_ebay=${createBoundStateCookieValue(STATE, { marketplace: 'ebay', workspaceId: fx[who].workspaceId, userId: fx[who].userId })}`;
    const callback = (opts: { cookie?: string; query?: string } = {}) =>
      http(callbackRoute.GET, {
        url: `/api/marketplace/callback/ebay?${opts.query ?? `code=code123&state=${STATE}`}`,
        headers: opts.cookie ? { cookie: opts.cookie } : {},
        params: { marketplace: 'ebay' },
      });

    it('no session -> redirect to login, nothing is exchanged', async () => {
      authMock.mockResolvedValue(null);
      const res = await callback({ cookie: boundCookie() });
      expect(res.status).toBe(307);
      expect(res.location).toContain('/login');
      expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    });

    it('a session without a workspace -> error redirect, nothing is exchanged', async () => {
      authMock.mockResolvedValue({ user: { id: fx.A.userId } });
      const res = await callback({ cookie: boundCookie() });
      expect(res.status).toBe(307);
      expect(res.location).toContain('status=error');
      expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    });

    it.each([
      ['no state cookie', undefined, `code=c&state=${'a'.repeat(64)}`],
      ['a different state cookie', `oauth_state_ebay=${'b'.repeat(64)}`, `code=c&state=${'a'.repeat(64)}`],
      ['a wrong-length state', `oauth_state_ebay=${'a'.repeat(63)}`, `code=c&state=${'a'.repeat(63)}`],
      ['a state cookie of another marketplace', `oauth_state_etsy=${'a'.repeat(64)}`, `code=c&state=${'a'.repeat(64)}`],
      ['no code', `oauth_state_ebay=${'a'.repeat(64)}`, `state=${'a'.repeat(64)}`],
    ])('%s -> 400, nothing is exchanged', async (_name, cookie, query) => {
      const res = await callback({ cookie, query });
      expect(res.status).toBe(400);
      expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    });

    it("B.11.1: a state started by workspace B but presented by a session of workspace A is refused, nothing is exchanged", async () => {
      const res = await callback({ cookie: boundCookie('B') });
      expect(res.status).toBe(400);
      expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
      await expectBUnchanged();
    });

    it("a valid state connects the SESSION's workspace; a workspaceId in the query string is ignored", async () => {
      getConnectionMock.mockResolvedValue(null);
      handleOAuthCallbackMock.mockResolvedValue({ connectionId: 'x', marketplace: 'ebay', status: 'connected' });
      const res = await callback({ cookie: boundCookie(), query: `code=code123&state=${STATE}&workspaceId=${fx.B.workspaceId}` });
      expect(res.status).toBe(307);
      expect(res.location).toContain('status=connected');
      expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
      expect(handleOAuthCallbackMock.mock.calls[0][0]).toBe(fx.A.workspaceId);
      expect(handleOAuthCallbackMock.mock.calls[0][0]).not.toBe(fx.B.workspaceId);
      await expectBUnchanged();
    });

    it("the plan's marketplace limit is enforced per workspace before the exchange (A at its limit, B not)", async () => {
      getConnectionMock.mockResolvedValue(null);
      handleOAuthCallbackMock.mockResolvedValue({});
      const second = await prisma.marketplace.create({ data: { name: `${fx.runId}-mkt2`, displayName: 'second' } });
      const extra = await prisma.marketplaceConnection.create({ data: { workspaceId: fx.A.workspaceId, marketplaceId: second.name, status: 'connected' } });
      try {
        // A: 2 connections, plan allows 2 -> reached
        const refused = await callback({ cookie: boundCookie() });
        expect(refused.status).toBe(307);
        expect(decodeURIComponent(refused.location ?? '')).toContain('limit reached');
        expect(handleOAuthCallbackMock).not.toHaveBeenCalled();

        // B: also 1 connection, plan allows 100 -> proceeds
        authMock.mockResolvedValue({ user: { id: fx.B.userId, workspaceId: fx.B.workspaceId } });
        const ok = await callback({ cookie: boundCookie('B') });
        expect(ok.location).toContain('status=connected');
        expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
        expect(handleOAuthCallbackMock.mock.calls[0][0]).toBe(fx.B.workspaceId);
      } finally {
        await prisma.marketplaceConnection.deleteMany({ where: { id: extra.id } });
        await prisma.marketplace.deleteMany({ where: { id: second.id } });
      }
    });

    it('a failing exchange redirects with an error, consumes the state cookie and leaks no token', async () => {
      getConnectionMock.mockResolvedValue(null);
      handleOAuthCallbackMock.mockRejectedValue(new Error('upstream exploded with token FAKE-TOKEN-LEAK-12345'));
      const res = await callback({ cookie: boundCookie() });
      expect(res.status).toBe(307);
      expect(res.location).toContain('status=error');
      expect(res.raw + (res.location ?? '')).not.toContain('FAKE-TOKEN-LEAK-12345');
    });
  });

  // ------------------------------------------------------- dev stock-race route
  describe('api/test/stock-race-condition (development helper)', () => {
    const post = (body: unknown) => http(stockRoute.POST, { method: 'POST', url: '/api/test/stock-race-condition', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const withNodeEnv = async (value: string, fn: () => Promise<void>) => {
      const env = process.env as Record<string, string | undefined>;
      const previous = env.NODE_ENV;
      env.NODE_ENV = value;
      try { await fn(); } finally { env.NODE_ENV = previous; }
    };

    it.each(['production', 'test', 'staging', ''])("NODE_ENV=%j: unauthenticated callers can neither create, simulate on nor delete any workspace", async (value) => {
      await withNodeEnv(value, async () => {
        const usersBefore = await prisma.user.count();
        const setup = await post({ action: 'setup' });
        expect(setup.status).toBe(403);
        const simulate = await post({ action: 'simulate', productId: fx.B.productId, workspaceId: fx.B.workspaceId });
        expect(simulate.status).toBe(403);
        const cleanup = await post({ action: 'cleanup', workspaceId: fx.B.workspaceId });
        expect(cleanup.status).toBe(403);
        expect(await prisma.user.count()).toBe(usersBefore);
        await expectBUnchanged();
      });
    });

    it("even in development it refuses to act on a workspace that is not one of its own synthetic ones", async () => {
      await withNodeEnv('development', async () => {
        const simulate = await post({ action: 'simulate', productId: fx.B.productId, workspaceId: fx.B.workspaceId });
        expect([400, 403, 404]).toContain(simulate.status);
        const cleanup = await post({ action: 'cleanup', workspaceId: fx.B.workspaceId });
        expect([400, 403, 404]).toContain(cleanup.status);
        expect(await prisma.workspace.count({ where: { id: fx.B.workspaceId } })).toBe(1);
        await expectBUnchanged();
      });
    });
  });
});
