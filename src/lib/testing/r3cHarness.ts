/**
 * R3-C.2.2 — A/B workspace harness for the isolation tests, on the dedicated
 * local PostgreSQL test database ONLY.
 *
 * - `connectGuardedPrisma()` refuses to return a client unless the
 *   environment passes the DB safety guard AND the server identity
 *   (database / role / port) is the dedicated R3-C cluster.
 * - `createAbFixture()` creates two fully separate tenants (A and B), each
 *   with its own user, workspace and a complete graph of related rows, using
 *   only synthetic data (`@r3c.invalid` e-mails, `FAKE-` token strings). It
 *   records the id of EVERY row it creates.
 * - `cleanupAbFixture()` deletes exactly those recorded ids, child tables
 *   first. It never issues a table-wide or pattern-based delete.
 * - `snapshotFixture()` returns a deterministic picture of every recorded
 *   row (including updatedAt) so a test can prove "nothing of B changed".
 *
 * No real user, token, marketplace account or customer data is ever used.
 */
import { PrismaClient } from '@prisma/client';
import { assertRuntimeIdentity, assertSafeTestDatabase } from './dbSafetyGuard';

export interface TenantIds {
  userId: string;
  workspaceId: string;
  productId: string;
  secondProductId: string;
  imageIds: string[]; // 3 images on productId
  secondProductImageId: string;
  inventoryId: string;
  connectionId: string;
  listingId: string;
  orderId: string;
  orderItemId: string;
  fulfillmentOrderId: string;
  shipmentId: string;
  trackingEventId: string;
  syncLogId: string;
  conversationId: string;
  messageId: string;
  actionId: string;
  notificationId: string;
  webhookId: string;
}

export interface AbFixture {
  runId: string;
  marketplaceId: string; // Marketplace.id (global table)
  marketplaceName: string; // Marketplace.name (FK target of MarketplaceConnection.marketplaceId)
  partnerId: string; // FulfillmentPartner (global table)
  A: TenantIds;
  B: TenantIds;
}

export async function connectGuardedPrisma(): Promise<PrismaClient> {
  assertSafeTestDatabase(process.env); // throws DbSafetyError, reason codes only
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw<Array<{ db: string; usr: string; port: number | null }>>`
      select current_database() as db, current_user as usr, inet_server_port() as port`;
    assertRuntimeIdentity({ database: rows[0]?.db ?? null, user: rows[0]?.usr ?? null, port: rows[0]?.port ?? null });
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
  return prisma;
}

function newRunId(): string {
  return `r3c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function createTenant(prisma: PrismaClient, runId: string, side: 'a' | 'b', marketplaceName: string, partnerId: string): Promise<TenantIds> {
  const tag = `${runId}-${side}`;
  const user = await prisma.user.create({
    data: { email: `${tag}@r3c.invalid`, name: `R3C tenant ${side.toUpperCase()}`, emailVerified: true },
  });
  const workspace = await prisma.workspace.create({
    data: { name: `R3C workspace ${side.toUpperCase()}`, slug: tag, userId: user.id },
  });

  const product = await prisma.product.create({
    data: { workspaceId: workspace.id, sku: `${tag}-sku1`, title: `Product 1 ${side}`, description: 'synthetic', purchasePrice: 5, sellingPrice: 10, quantity: 3 },
  });
  const secondProduct = await prisma.product.create({
    data: { workspaceId: workspace.id, sku: `${tag}-sku2`, title: `Product 2 ${side}`, description: 'synthetic', purchasePrice: 6, sellingPrice: 12, quantity: 2 },
  });

  const imageIds: string[] = [];
  for (const n of [0, 1, 2]) {
    const img = await prisma.productImage.create({
      data: { productId: product.id, url: `https://r3c.invalid/${tag}/img${n}.jpg`, order: n, isMain: n === 0 },
    });
    imageIds.push(img.id);
  }
  const secondImage = await prisma.productImage.create({
    data: { productId: secondProduct.id, url: `https://r3c.invalid/${tag}/second.jpg`, order: 0, isMain: true },
  });

  const inventory = await prisma.inventory.create({
    data: { productId: product.id, workspaceId: workspace.id, available: 3 },
  });

  const connection = await prisma.marketplaceConnection.create({
    data: {
      workspaceId: workspace.id,
      marketplaceId: marketplaceName,
      status: 'connected',
      encryptedOauthToken: `FAKE-ACCESS-${tag}`,
      encryptedRefreshToken: `FAKE-REFRESH-${tag}`,
    },
  });

  const listing = await prisma.listing.create({
    data: {
      productId: product.id,
      workspaceId: workspace.id,
      marketplaceConnectionId: connection.id,
      title: `Listing ${side}`,
      description: 'synthetic',
      price: 10,
      quantity: 3,
      externalId: `EXT-${tag}`,
    },
  });

  const order = await prisma.order.create({
    data: {
      workspaceId: workspace.id,
      listingId: listing.id,
      customerId: `CUST-${tag}`,
      customerName: `Buyer ${side}`,
      customerEmail: `${tag}-buyer@r3c.invalid`,
      totalPrice: 10,
      estimatedProfit: 4,
      shippingAddress: '1 synthetic street',
      shippingCity: 'Testville',
      shippingPostalCode: '00000',
      shippingCountry: 'FR',
    },
  });
  const orderItem = await prisma.orderItem.create({
    data: { orderId: order.id, productId: product.id, title: `Item ${side}`, quantity: 1, price: 10 },
  });

  const fulfillmentOrder = await prisma.fulfillmentOrder.create({
    data: { workspaceId: workspace.id, orderId: order.id, partnerId, quantity: 1, totalCost: 5, revenue: 10, profit: 5, status: 'pending' },
  });
  const shipment = await prisma.shipment.create({
    data: { fulfillmentOrderId: fulfillmentOrder.id, partnerId, trackingNumber: `TRK-${tag}`, carrier: 'synthetic' },
  });
  const trackingEvent = await prisma.trackingEvent.create({
    data: { shipmentId: shipment.id, status: 'created', location: 'Testville' },
  });

  const syncLog = await prisma.syncLog.create({
    data: { workspaceId: workspace.id, connectionId: connection.id, marketplace: marketplaceName, syncType: 'listings' },
  });

  const conversation = await prisma.agentConversation.create({
    data: { workspaceId: workspace.id, userId: user.id },
  });
  const message = await prisma.agentMessage.create({
    data: { conversationId: conversation.id, role: 'user', content: `synthetic ${tag}` },
  });
  const action = await prisma.agentAction.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      conversationId: conversation.id,
      type: 'synthetic',
      category: 'synthetic',
      input: '{}',
      summary: `synthetic ${tag}`,
      idempotencyKey: `idem-${tag}`,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });

  const notification = await prisma.notification.create({
    data: { userId: user.id, type: 'info', title: `synthetic ${tag}`, message: 'synthetic' },
  });
  const webhook = await prisma.webhook.create({
    data: { workspaceId: workspace.id, url: `https://r3c.invalid/hook/${tag}`, events: 'order.created', secret: `FAKE-SECRET-${tag}` },
  });

  return {
    userId: user.id,
    workspaceId: workspace.id,
    productId: product.id,
    secondProductId: secondProduct.id,
    imageIds,
    secondProductImageId: secondImage.id,
    inventoryId: inventory.id,
    connectionId: connection.id,
    listingId: listing.id,
    orderId: order.id,
    orderItemId: orderItem.id,
    fulfillmentOrderId: fulfillmentOrder.id,
    shipmentId: shipment.id,
    trackingEventId: trackingEvent.id,
    syncLogId: syncLog.id,
    conversationId: conversation.id,
    messageId: message.id,
    actionId: action.id,
    notificationId: notification.id,
    webhookId: webhook.id,
  };
}

/** Creates tenants A and B (and the two global rows they need) and records every id. */
export async function createAbFixture(prisma: PrismaClient): Promise<AbFixture> {
  const runId = newRunId();
  const marketplaceName = `${runId}-mkt`;
  const marketplace = await prisma.marketplace.create({
    data: { name: marketplaceName, displayName: `R3C marketplace ${runId}` },
  });
  const partner = await prisma.fulfillmentPartner.create({
    data: { name: `${runId}-partner`, country: 'FR', apiUrl: 'https://r3c.invalid/partner' },
  });

  const partial: Partial<AbFixture> = { runId, marketplaceId: marketplace.id, marketplaceName, partnerId: partner.id };
  try {
    partial.A = await createTenant(prisma, runId, 'a', marketplaceName, partner.id);
    partial.B = await createTenant(prisma, runId, 'b', marketplaceName, partner.id);
  } catch (error) {
    // Best-effort removal of whatever was created before the failure.
    await cleanupByPrefix(prisma, runId, marketplace.id, partner.id).catch(() => undefined);
    throw error;
  }
  return partial as AbFixture;
}

/** Every recorded id of one tenant, grouped by table, children before parents. */
function tenantDeletePlan(t: TenantIds) {
  return [
    ['trackingEvent', [t.trackingEventId]],
    ['shipment', [t.shipmentId]],
    ['fulfillmentOrder', [t.fulfillmentOrderId]],
    ['orderItem', [t.orderItemId]],
    ['order', [t.orderId]],
    ['listing', [t.listingId]],
    ['syncLog', [t.syncLogId]],
    ['agentAction', [t.actionId]],
    ['agentMessage', [t.messageId]],
    ['agentConversation', [t.conversationId]],
    ['webhook', [t.webhookId]],
    ['notification', [t.notificationId]],
    ['marketplaceConnection', [t.connectionId]],
    ['productImage', [...t.imageIds, t.secondProductImageId]],
    ['inventory', [t.inventoryId]],
    ['product', [t.productId, t.secondProductId]],
    ['workspace', [t.workspaceId]],
    ['user', [t.userId]],
  ] as Array<[string, string[]]>;
}

/** Deletes exactly the recorded ids of ONE tenant (children first); the shared global rows are left alone. */
export async function cleanupTenant(prisma: PrismaClient, tenant: TenantIds): Promise<void> {
  const client = prisma as any;
  for (const [model, ids] of tenantDeletePlan(tenant)) {
    if (ids.length > 0) await client[model].deleteMany({ where: { id: { in: ids } } });
  }
}

/** Deletes exactly the recorded ids of the fixture (never a table-wide or pattern delete). */
export async function cleanupAbFixture(prisma: PrismaClient, fx: AbFixture): Promise<void> {
  const client = prisma as any;
  for (const tenant of [fx.A, fx.B]) {
    if (!tenant) continue;
    for (const [model, ids] of tenantDeletePlan(tenant)) {
      if (ids.length > 0) await client[model].deleteMany({ where: { id: { in: ids } } });
    }
  }
  await prisma.fulfillmentPartner.deleteMany({ where: { id: fx.partnerId } });
  await prisma.marketplace.deleteMany({ where: { id: fx.marketplaceId } });
}

/** Failure path of createAbFixture only: removes this run's rows by their run-unique prefix. */
async function cleanupByPrefix(prisma: PrismaClient, runId: string, marketplaceId: string, partnerId: string): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { startsWith: `${runId}-` } }, select: { id: true } });
  // Workspace/User deletion cascades to the rows created before the failure.
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.fulfillmentPartner.deleteMany({ where: { id: partnerId } });
  await prisma.marketplace.deleteMany({ where: { id: marketplaceId } });
}

/** Number of recorded rows that still exist (0 after a correct cleanup). */
export async function countFixtureRows(prisma: PrismaClient, fx: AbFixture): Promise<number> {
  const client = prisma as any;
  let total = 0;
  for (const tenant of [fx.A, fx.B]) {
    for (const [model, ids] of tenantDeletePlan(tenant)) {
      total += await client[model].count({ where: { id: { in: ids } } });
    }
  }
  total += await prisma.fulfillmentPartner.count({ where: { id: fx.partnerId } });
  total += await prisma.marketplace.count({ where: { id: fx.marketplaceId } });
  return total;
}

/** Deterministic picture of every recorded row of one tenant (for "unchanged" assertions). */
export async function snapshotTenant(prisma: PrismaClient, t: TenantIds): Promise<string> {
  const client = prisma as any;
  const out: Record<string, unknown> = {};
  for (const [model, ids] of tenantDeletePlan(t)) {
    const rows = await client[model].findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    out[model] = rows;
  }
  return JSON.stringify(out);
}
