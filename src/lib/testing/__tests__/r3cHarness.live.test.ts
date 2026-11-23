/**
 * R3-C.2.2 — the A/B harness itself, on the dedicated local test database.
 * Run ONLY through the guarded runner:
 *
 *   node scripts/r3c/run-with-test-db.mjs vitest src/lib/testing/__tests__/r3cHarness.live.test.ts
 *
 * Proves: A and B are two distinct, fully populated tenants; nothing from any
 * other environment is involved; cleanup removes exactly the recorded rows
 * and nothing else; the harness is reproducible (create -> cleanup -> create
 * -> cleanup leaves no trace).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { enforceGuardForTestRun } from '../dbSafetyGuard';
import {
  connectGuardedPrisma,
  createAbFixture,
  cleanupAbFixture,
  countFixtureRows,
  snapshotTenant,
  type AbFixture,
} from '../r3cHarness';

const guarded = enforceGuardForTestRun(process.env) === 'guarded';

describe.skipIf(!guarded)('R3-C A/B harness', () => {
  let prisma: PrismaClient;
  const created: AbFixture[] = [];

  beforeAll(async () => {
    prisma = await connectGuardedPrisma();
  });

  afterAll(async () => {
    // Safety net: anything a failed test left behind is removed by its recorded ids only.
    for (const fx of created) await cleanupAbFixture(prisma, fx).catch(() => undefined);
    await prisma?.$disconnect();
  });

  it('creates two distinct tenants with distinct ids at every level', async () => {
    const fx = await createAbFixture(prisma);
    created.push(fx);

    const idsA = Object.values(fx.A).flat();
    const idsB = Object.values(fx.B).flat();
    expect(idsA.length).toBe(idsB.length);
    expect(new Set([...idsA, ...idsB]).size).toBe(idsA.length + idsB.length); // no id shared by A and B
    expect(fx.A.workspaceId).not.toBe(fx.B.workspaceId);
    expect(fx.A.userId).not.toBe(fx.B.userId);

    // each workspace is owned by its own user
    const wsA = await prisma.workspace.findUniqueOrThrow({ where: { id: fx.A.workspaceId } });
    const wsB = await prisma.workspace.findUniqueOrThrow({ where: { id: fx.B.workspaceId } });
    expect(wsA.userId).toBe(fx.A.userId);
    expect(wsB.userId).toBe(fx.B.userId);

    await cleanupAbFixture(prisma, fx);
  });

  it('every tenant row belongs to its own workspace; nothing crosses over', async () => {
    const fx = await createAbFixture(prisma);
    created.push(fx);

    for (const [t, other] of [[fx.A, fx.B], [fx.B, fx.A]] as const) {
      const products = await prisma.product.findMany({ where: { id: { in: [t.productId, t.secondProductId] } } });
      expect(products.every((p) => p.workspaceId === t.workspaceId)).toBe(true);

      const images = await prisma.productImage.findMany({ where: { id: { in: [...t.imageIds, t.secondProductImageId] } }, include: { product: true } });
      expect(images.every((i) => i.product.workspaceId === t.workspaceId)).toBe(true);

      const listing = await prisma.listing.findUniqueOrThrow({ where: { id: t.listingId }, include: { connection: true, product: true } });
      expect(listing.workspaceId).toBe(t.workspaceId);
      expect(listing.product.workspaceId).toBe(t.workspaceId);
      expect(listing.connection?.workspaceId).toBe(t.workspaceId);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: t.orderId }, include: { items: { include: { product: true } }, listing: true } });
      expect(order.workspaceId).toBe(t.workspaceId);
      expect(order.listing?.workspaceId).toBe(t.workspaceId);
      expect(order.items.every((i) => i.product.workspaceId === t.workspaceId)).toBe(true);

      const fo = await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: t.fulfillmentOrderId }, include: { order: true, shipment: { include: { trackingEvents: true } } } });
      expect(fo.workspaceId).toBe(t.workspaceId);
      expect(fo.order.workspaceId).toBe(t.workspaceId);
      expect(fo.shipment?.trackingEvents.map((e) => e.id)).toEqual([t.trackingEventId]);

      const conv = await prisma.agentConversation.findUniqueOrThrow({ where: { id: t.conversationId } });
      expect(conv.workspaceId).toBe(t.workspaceId);

      // the other tenant's ids are not reachable through this tenant's workspace filter
      const foreign = await prisma.product.findMany({ where: { id: { in: [other.productId, other.secondProductId] }, workspaceId: t.workspaceId } });
      expect(foreign).toEqual([]);
    }

    await cleanupAbFixture(prisma, fx);
  });

  it('uses only synthetic data (reserved .invalid domain, FAKE- token strings)', async () => {
    const fx = await createAbFixture(prisma);
    created.push(fx);
    for (const t of [fx.A, fx.B]) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: t.userId } });
      expect(user.email.endsWith('@r3c.invalid')).toBe(true);
      const conn = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: t.connectionId } });
      expect(conn.encryptedOauthToken?.startsWith('FAKE-')).toBe(true);
      expect(conn.encryptedRefreshToken?.startsWith('FAKE-')).toBe(true);
      expect(conn.apiKey).toBeNull();
    }
    await cleanupAbFixture(prisma, fx);
  });

  it('cleanup removes exactly the recorded rows (and only those): a bystander row survives', async () => {
    // A row the harness did not create, in a different namespace.
    const bystander = await prisma.user.create({ data: { email: `bystander-${Date.now()}@r3c.invalid`, name: 'bystander', emailVerified: true } });
    try {
      const rowsBefore = await prisma.user.count();

      const fx = await createAbFixture(prisma);
      created.push(fx);
      expect(await countFixtureRows(prisma, fx)).toBeGreaterThan(40);
      expect(await prisma.user.count()).toBe(rowsBefore + 2);

      await cleanupAbFixture(prisma, fx);

      expect(await countFixtureRows(prisma, fx)).toBe(0);
      expect(await prisma.user.count()).toBe(rowsBefore); // exactly the two harness users are gone
      expect(await prisma.user.findUnique({ where: { id: bystander.id } })).not.toBeNull(); // the bystander is intact
    } finally {
      await prisma.user.deleteMany({ where: { id: bystander.id } }); // always removed by its own id, even if an assertion fails
    }
  });

  it('snapshots are stable until something changes, and change when a row of the tenant changes', async () => {
    const fx = await createAbFixture(prisma);
    created.push(fx);
    const a1 = await snapshotTenant(prisma, fx.A);
    const b1 = await snapshotTenant(prisma, fx.B);
    expect(await snapshotTenant(prisma, fx.A)).toBe(a1);
    expect(await snapshotTenant(prisma, fx.B)).toBe(b1);

    await prisma.productImage.update({ where: { id: fx.A.imageIds[0] }, data: { order: 42 } });
    expect(await snapshotTenant(prisma, fx.A)).not.toBe(a1); // A changed
    expect(await snapshotTenant(prisma, fx.B)).toBe(b1); // B did not

    await cleanupAbFixture(prisma, fx);
  });

  it('is reproducible: create -> cleanup -> create -> cleanup leaves no trace and ids are fresh each time', async () => {
    const usersBefore = await prisma.user.count();
    const productsBefore = await prisma.product.count();
    const ordersBefore = await prisma.order.count();

    const first = await createAbFixture(prisma);
    created.push(first);
    await cleanupAbFixture(prisma, first);
    const second = await createAbFixture(prisma);
    created.push(second);
    expect(second.runId).not.toBe(first.runId);
    expect(second.A.workspaceId).not.toBe(first.A.workspaceId);
    await cleanupAbFixture(prisma, second);

    expect(await countFixtureRows(prisma, first)).toBe(0);
    expect(await countFixtureRows(prisma, second)).toBe(0);
    expect(await prisma.user.count()).toBe(usersBefore);
    expect(await prisma.product.count()).toBe(productsBefore);
    expect(await prisma.order.count()).toBe(ordersBefore);
  });

  it('the guarded client is bound to the dedicated database (identity re-checked)', async () => {
    const rows = await prisma.$queryRaw<Array<{ db: string; usr: string; port: number | null }>>`
      select current_database() as db, current_user as usr, inet_server_port() as port`;
    expect(rows[0]).toMatchObject({ db: 'adksy_r3c_test', usr: 'adksy_r3c_test' });
    expect(Number(rows[0].port)).toBe(5433);
  });
});
