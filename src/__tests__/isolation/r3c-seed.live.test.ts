/**
 * R4/R5 — the demo seed on the dedicated local test database: idempotent,
 * atomic, non-destructive, isolated. Real Prisma, real transactions.
 *
 * Run ONLY through the guarded runner:
 *   node scripts/r3c/run-with-test-db.mjs vitest src/__tests__/isolation/r3c-seed.live.test.ts
 *
 * The seed functions are exercised directly with the guarded client (the
 * fail-closed target check of the script itself is covered, with real child
 * processes, in src/__tests__/prisma/seed-safety.test.ts). The test refuses
 * to run if the global reference tables are not empty, and removes only what
 * it created.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { enforceGuardForTestRun } from '@/lib/testing/dbSafetyGuard';
import { connectGuardedPrisma, createAbFixture, cleanupAbFixture, snapshotTenant } from '@/lib/testing/r3cHarness';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const seed = require('../../../prisma/seed.js');

const guarded = enforceGuardForTestRun(process.env) === 'guarded';

describe.skipIf(!guarded)('R4/R5 — demo seed on the local test database', () => {
  let prisma: PrismaClient;
  const extraUserIds: string[] = [];
  const extraWorkspaceIds: string[] = [];

  beforeAll(async () => {
    prisma = await connectGuardedPrisma();
    // Safety: never delete rows we did not create. The reference tables must start empty.
    const existing =
      (await prisma.plan.count()) + (await prisma.marketplace.count()) + (await prisma.fulfillmentPartner.count()) +
      (await prisma.workspace.count({ where: { slug: seed.DEMO_WORKSPACE_SLUG } })) +
      (await prisma.user.count({ where: { email: seed.DEMO_EMAIL } }));
    if (existing > 0) throw new Error('local test DB is not empty of seed rows: refusing to run (nothing was deleted)');
  });
  afterAll(async () => {
    await purge();
    await prisma?.$disconnect();
  });
  beforeEach(async () => {
    await purge();
  });
  afterEach(async () => {
    await purge();
  });

  /** Removes exactly the rows a seed run (and these tests) can create. */
  async function purge() {
    const workspaces = await prisma.workspace.findMany({ where: { OR: [{ slug: seed.DEMO_WORKSPACE_SLUG }, { id: { in: extraWorkspaceIds } }] }, select: { id: true, subscriptionId: true } });
    const wsIds = workspaces.map((w) => w.id);
    const orders = await prisma.order.findMany({ where: { workspaceId: { in: wsIds } }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    const fos = await prisma.fulfillmentOrder.findMany({ where: { workspaceId: { in: wsIds } }, select: { id: true } });
    const foIds = fos.map((f) => f.id);
    const shipments = await prisma.shipment.findMany({ where: { fulfillmentOrderId: { in: foIds } }, select: { id: true } });
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: { in: shipments.map((s) => s.id) } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipments.map((s) => s.id) } } });
    await prisma.fulfillmentOrder.deleteMany({ where: { id: { in: foIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.listing.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.inventory.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.product.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.marketplaceConnection.deleteMany({ where: { workspaceId: { in: wsIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } });
    await prisma.subscription.deleteMany({ where: { id: { in: workspaces.map((w) => w.subscriptionId).filter((x): x is string => !!x) } } });
    await prisma.subscription.deleteMany({ where: { workspace: null, plan: { name: { in: ['free', 'starter', 'pro', 'business', 'enterprise'] } } } }); // orphans (none expected)
    await prisma.user.deleteMany({ where: { OR: [{ email: seed.DEMO_EMAIL }, { id: { in: extraUserIds } }] } });
    await prisma.fulfillmentPartner.deleteMany({ where: { name: 'ShipMock France' } });
    await prisma.plan.deleteMany({ where: { name: { in: ['free', 'starter', 'pro', 'business', 'enterprise'] } } });
    await prisma.marketplace.deleteMany({ where: { name: { in: ['vinted', 'ebay', 'depop', 'etsy'] } } });
    extraUserIds.length = 0;
    extraWorkspaceIds.length = 0;
  }

  const counts = async () => ({
    users: await prisma.user.count(),
    subscriptions: await prisma.subscription.count(),
    workspaces: await prisma.workspace.count(),
    products: await prisma.product.count(),
    inventory: await prisma.inventory.count(),
    connections: await prisma.marketplaceConnection.count(),
    listings: await prisma.listing.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    fulfillmentOrders: await prisma.fulfillmentOrder.count(),
    shipments: await prisma.shipment.count(),
    trackingEvents: await prisma.trackingEvent.count(),
    plans: await prisma.plan.count(),
    marketplaces: await prisma.marketplace.count(),
    partners: await prisma.fulfillmentPartner.count(),
  });

  const runSeed = async (passwordHash: string | null = null) => {
    await seed.seedReferenceData(prisma, {});
    return seed.seedDemoWorkspace(prisma, { passwordHash });
  };

  it('creates the complete demo graph, all of it inside the one demo workspace', async () => {
    const result = await runSeed();
    expect(result.status).toBe('created');
    expect(await counts()).toEqual({
      users: 1, subscriptions: 1, workspaces: 1, products: 5, inventory: 5, connections: 3, listings: 6,
      orders: 3, orderItems: 3, fulfillmentOrders: 2, shipments: 1, trackingEvents: 2, plans: 5, marketplaces: 4, partners: 1,
    });
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { slug: seed.DEMO_WORKSPACE_SLUG } });
    expect(await prisma.product.count({ where: { workspaceId: { not: ws.id } } })).toBe(0);
    expect(await prisma.listing.count({ where: { workspaceId: { not: ws.id } } })).toBe(0);
    expect(await prisma.order.count({ where: { workspaceId: { not: ws.id } } })).toBe(0);
    expect(await prisma.inventory.count({ where: { workspaceId: { not: ws.id } } })).toBe(0);
    // relations are coherent: every listing points at a product and a connection of the same workspace
    const listings = await prisma.listing.findMany({ include: { product: true, connection: true } });
    expect(listings.every((l) => l.product.workspaceId === ws.id && l.connection?.workspaceId === ws.id)).toBe(true);
    // connections reference Marketplace.name (the former seed used the wrong column and crashed)
    expect((await prisma.marketplaceConnection.findMany({ select: { marketplaceId: true } })).map((c) => c.marketplaceId).sort()).toEqual(['depop', 'ebay', 'vinted']);
  });

  it('the demo account has no password unless one is provided', async () => {
    await runSeed();
    expect((await prisma.user.findUniqueOrThrow({ where: { email: seed.DEMO_EMAIL } })).password).toBeNull();
  });

  it('a provided password is stored only as a bcrypt hash', async () => {
    const plain = 'a-very-long-demo-pass-123';
    await runSeed(await bcrypt.hash(plain, 4));
    const user = await prisma.user.findUniqueOrThrow({ where: { email: seed.DEMO_EMAIL } });
    expect(user.password).not.toBe(plain);
    expect(user.password).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare(plain, user.password!)).toBe(true);
    expect(await bcrypt.compare('wrong-password-123', user.password!)).toBe(false);
  });

  it('is idempotent: repeated runs change nothing and never leave an orphan subscription (the former seed did)', async () => {
    await runSeed();
    const first = await counts();
    const wsBefore = await prisma.workspace.findUniqueOrThrow({ where: { slug: seed.DEMO_WORKSPACE_SLUG } });
    for (let i = 0; i < 3; i++) {
      const again = await runSeed();
      expect(again.status).toBe('skipped');
    }
    expect(await counts()).toEqual(first);
    const wsAfter = await prisma.workspace.findUniqueOrThrow({ where: { slug: seed.DEMO_WORKSPACE_SLUG } });
    expect(wsAfter.id).toBe(wsBefore.id);
    expect(wsAfter.updatedAt.getTime()).toBe(wsBefore.updatedAt.getTime());
  });

  it('preserves existing data: an existing demo account, plan and marketplace are not modified', async () => {
    const existingUser = await prisma.user.create({ data: { email: seed.DEMO_EMAIL, name: 'Existing Person', password: 'existing-hash-value', emailVerified: false } });
    await prisma.plan.create({ data: { name: 'pro', displayName: 'Custom Pro', price: 777, maxProducts: 3 } });
    await prisma.marketplace.create({ data: { name: 'ebay', displayName: 'Custom eBay' } });

    await runSeed('would-be-new-hash');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: existingUser.id } });
    expect(user).toMatchObject({ name: 'Existing Person', password: 'existing-hash-value', emailVerified: false });
    expect(user.updatedAt.getTime()).toBe(existingUser.updatedAt.getTime());
    expect(await prisma.plan.findUniqueOrThrow({ where: { name: 'pro' } })).toMatchObject({ displayName: 'Custom Pro', price: 777, maxProducts: 3 });
    expect((await prisma.marketplace.findUniqueOrThrow({ where: { name: 'ebay' } })).displayName).toBe('Custom eBay');
    expect(await prisma.user.count({ where: { email: seed.DEMO_EMAIL } })).toBe(1);
  });

  it("a workspace that already uses the demo slug but belongs to another account is left untouched, and nothing is added to it", async () => {
    const other = await prisma.user.create({ data: { email: 'someone-else@r3c.invalid', name: 'Someone else', emailVerified: true } });
    extraUserIds.push(other.id);
    const theirs = await prisma.workspace.create({ data: { name: 'Not a demo', slug: seed.DEMO_WORKSPACE_SLUG, userId: other.id } });
    extraWorkspaceIds.push(theirs.id);
    const before = JSON.stringify(await prisma.workspace.findUniqueOrThrow({ where: { id: theirs.id } }));

    const result = await runSeed();

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('another account');
    expect(JSON.stringify(await prisma.workspace.findUniqueOrThrow({ where: { id: theirs.id } }))).toBe(before);
    expect(await prisma.product.count({ where: { workspaceId: theirs.id } })).toBe(0);
    expect(await prisma.user.count({ where: { email: seed.DEMO_EMAIL } })).toBe(0); // the demo account was not even created
    expect((await counts()).products).toBe(0);
  });

  it('is atomic: a failure in the middle rolls back everything (no user, subscription, workspace or product is left)', async () => {
    await seed.seedReferenceData(prisma, {});
    await prisma.plan.delete({ where: { name: 'pro' } }); // the graph creation fails after the user upsert, inside the transaction
    await expect(seed.seedDemoWorkspace(prisma, {})).rejects.toThrow(/plan "pro" is missing/);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.workspace.count()).toBe(0);
    expect(await prisma.product.count()).toBe(0);
    // and after repairing the cause, the next run succeeds normally
    await seed.seedReferenceData(prisma, {});
    expect((await seed.seedDemoWorkspace(prisma, {})).status).toBe('created');
  });

  it('two concurrent runs create exactly one demo workspace (no duplicate products, orders or subscriptions)', async () => {
    await seed.seedReferenceData(prisma, {});
    const results = await Promise.allSettled([seed.seedDemoWorkspace(prisma, {}), seed.seedDemoWorkspace(prisma, {})]);
    expect(results.filter((r) => r.status === 'fulfilled' && (r.value as { status: string }).status === 'created')).toHaveLength(1);
    const c = await counts();
    expect(c).toMatchObject({ users: 1, subscriptions: 1, workspaces: 1, products: 5, orders: 3, listings: 6 });
  });

  it("does not touch another tenant's data: an A/B fixture is byte-identical after seeding, and shares no row with the demo workspace", async () => {
    const fx = await createAbFixture(prisma);
    try {
      const a = await snapshotTenant(prisma, fx.A);
      const b = await snapshotTenant(prisma, fx.B);
      await runSeed();
      expect(await snapshotTenant(prisma, fx.A)).toBe(a);
      expect(await snapshotTenant(prisma, fx.B)).toBe(b);
      const demo = await prisma.workspace.findUniqueOrThrow({ where: { slug: seed.DEMO_WORKSPACE_SLUG } });
      expect(demo.id).not.toBe(fx.A.workspaceId);
      expect(demo.id).not.toBe(fx.B.workspaceId);
      expect(await prisma.product.count({ where: { workspaceId: { in: [fx.A.workspaceId, fx.B.workspaceId] } } })).toBe(4); // the fixtures' own 2 + 2
    } finally {
      await cleanupAbFixture(prisma, fx);
    }
  });

  it('seeds nothing for demo users when the reference data is missing: a clear refusal, not a partial graph', async () => {
    await expect(seed.seedDemoWorkspace(prisma, {})).rejects.toThrow();
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.workspace.count()).toBe(0);
  });
});
