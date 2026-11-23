/**
 * prisma/seed.js — LOCAL DEMO SEED (R4/R5: repaired and secured)
 *
 * What it does: reference data (marketplaces, plans, one mock fulfillment
 * partner) and ONE demo workspace ("Demo Shop") with demo products, listings,
 * orders, a fulfillment order and a shipment — for local development only.
 *
 * It must NEVER run against a real environment:
 *  - FAIL-CLOSED TARGET: before anything else it loads the shared DB safety
 *    guard (src/lib/testing/dbSafetyGuard.ts, same rules as the `db:*` npm
 *    scripts) and refuses unless DATABASE_URL / DIRECT_URL are exactly the
 *    dedicated local test database (127.0.0.1 / localhost, port 5433,
 *    `adksy_r3c_test`) and no env file or external-service credential could
 *    redirect it. If the guard cannot be loaded (Node without TypeScript type
 *    stripping, file missing...) the seed refuses too.
 *  - No hardcoded credentials: the demo account has NO password unless
 *    ADKSY_DEMO_USER_PASSWORD (>= 12 characters) is provided. The password and
 *    its hash are never printed; error output never contains Prisma's
 *    invocation dump (which would include the hash).
 *  - Idempotent and non-destructive: reference data uses `upsert` with
 *    `update: {}` (existing rows are never modified); the demo graph is created
 *    inside ONE transaction and only when the demo workspace does not exist yet.
 *    A failure rolls everything back (no orphan Subscription / Workspace / User
 *    rows), a second run changes nothing, nothing is ever deleted. A workspace
 *    with the demo slug that belongs to somebody else is left untouched.
 *  - Isolation: every demo row of the graph belongs to the one demo workspace.
 *
 * Usage (only through the guarded entry point, which also needs a confirmation):
 *   npm run db:seed -- --confirm-local-test-db
 *   ADKSY_DEMO_USER_PASSWORD='<at least 12 characters>' npm run db:seed -- --confirm-local-test-db
 * Direct use:  node prisma/seed.js [--dry-run]
 */
const path = require('path');
const { pathToFileURL } = require('url');

const DEMO_EMAIL = 'demo@reselling.local';
const DEMO_WORKSPACE_SLUG = 'demo-shop';
const MIN_DEMO_PASSWORD_LENGTH = 12;
const FULFILLMENT_PARTNER_NAME = 'ShipMock France';

const DEMO_PRODUCTS = [
  { sku: 'NIKE-AM95-001', title: 'Nike Air Max 95 OG Neon', description: 'Classic Nike Air Max 95 in excellent condition. Original box included. Size 42 EU.', brand: 'Nike', category: 'Sneakers', size: '42', color: 'White/Neon Yellow', condition: 'like-new', purchasePrice: 45, sellingPrice: 120, fulfillmentCost: 5, fees: 15, quantity: 2, location: 'Shelf A1' },
  { sku: 'ADIDAS-CAMPUS-002', title: 'Adidas Campus 00s Cream White', description: 'Adidas Campus in perfect condition. Worn once. Size 43 EU.', brand: 'Adidas', category: 'Sneakers', size: '43', color: 'Cream White', condition: 'new', purchasePrice: 40, sellingPrice: 95, fulfillmentCost: 5, fees: 12, quantity: 1, location: 'Shelf A2' },
  { sku: 'LEVIS-501-003', title: "Levi's 501 Original Blue Jeans", description: "Authentic Levi's 501 jeans. Perfect vintage condition. Size 32x32.", brand: "Levi's", category: 'Clothing', size: '32x32', color: 'Dark Blue', condition: 'good', purchasePrice: 35, sellingPrice: 65, fulfillmentCost: 4, fees: 8, quantity: 1, location: 'Shelf B1' },
  { sku: 'CARHARTT-JACKET-004', title: 'Carhartt WIP Detroit Jacket Brown', description: 'Iconic Carhartt work jacket. Excellent condition. Size L.', brand: 'Carhartt', category: 'Outerwear', size: 'L', color: 'Brown', condition: 'like-new', purchasePrice: 50, sellingPrice: 140, fulfillmentCost: 6, fees: 18, quantity: 1, location: 'Shelf B2' },
  { sku: 'NB-2002R-005', title: 'New Balance 2002R Protection Pack', description: 'Limited edition New Balance 2002R. DS condition. Size 44 EU.', brand: 'New Balance', category: 'Sneakers', size: '44', color: 'Grey/Navy', condition: 'new', purchasePrice: 75, sellingPrice: 180, fulfillmentCost: 6, fees: 25, quantity: 1, location: 'Shelf C1' },
];

const MARKETPLACES = [
  { name: 'vinted', displayName: 'Vinted' },
  { name: 'ebay', displayName: 'eBay' },
  { name: 'depop', displayName: 'Depop' },
  { name: 'etsy', displayName: 'Etsy' },
];

/** Plans, built at call time so tests can pass their own environment. Stripe Price IDs come from env (never hardcoded). */
function buildPlans(env = process.env) {
  // The AI Agent is available on every plan (usage is limited by AI Units quota, not by this flag).
  return [
    { name: 'free', displayName: 'Free', description: 'For beginners', price: 0, maxProducts: 10, maxListings: 20, maxOrders: 50, maxMarketplaces: 2, maxUsers: 1, fulfillmentEnabled: false, advancedAnalytics: false, apiAccess: false, aiAssistant: true, stripePriceIdMonthly: null, stripePriceIdAnnual: null },
    { name: 'starter', displayName: 'Starter', description: 'For small resellers', price: 19, maxProducts: 100, maxListings: 300, maxOrders: 500, maxMarketplaces: 3, maxUsers: 1, fulfillmentEnabled: false, advancedAnalytics: false, apiAccess: false, aiAssistant: true, stripePriceIdMonthly: env.STRIPE_PRICE_ID_STARTER_MONTHLY || null, stripePriceIdAnnual: env.STRIPE_PRICE_ID_STARTER_ANNUAL || null },
    { name: 'pro', displayName: 'Pro', description: 'For serious resellers', price: 49, maxProducts: 500, maxListings: 1500, maxOrders: 2000, maxMarketplaces: 4, maxUsers: 1, fulfillmentEnabled: true, advancedAnalytics: true, apiAccess: false, aiAssistant: true, stripePriceIdMonthly: env.STRIPE_PRICE_ID_PRO_MONTHLY || null, stripePriceIdAnnual: env.STRIPE_PRICE_ID_PRO_ANNUAL || null },
    { name: 'business', displayName: 'Business', description: 'For large operations', price: 99, maxProducts: 5000, maxListings: 10000, maxOrders: 10000, maxMarketplaces: 4, maxUsers: 5, fulfillmentEnabled: true, advancedAnalytics: true, apiAccess: true, aiAssistant: true, stripePriceIdMonthly: env.STRIPE_PRICE_ID_BUSINESS_MONTHLY || null, stripePriceIdAnnual: env.STRIPE_PRICE_ID_BUSINESS_ANNUAL || null },
    // No Stripe Price ID for Enterprise (custom pricing)
    { name: 'enterprise', displayName: 'Enterprise', description: 'Custom solution', price: 0, maxProducts: 999999, maxListings: 999999, maxOrders: 999999, maxMarketplaces: 4, maxUsers: 999, fulfillmentEnabled: true, advancedAnalytics: true, apiAccess: true, aiAssistant: true, stripePriceIdMonthly: null, stripePriceIdAnnual: null },
  ];
}

/** A refusal is an expected, explicit stop (exit code 2) — never a crash. */
class SeedRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedRefusal';
  }
}

const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Fail-closed target check. Resolves to the validated target (host, port, database, user — no credentials)
 * or throws; nothing is ever connected before this succeeds.
 */
async function assertSafeSeedTarget(env = process.env, root = PROJECT_ROOT) {
  let guard;
  try {
    guard = await import(pathToFileURL(path.join(root, 'src', 'lib', 'testing', 'dbSafetyGuard.ts')).href);
  } catch {
    throw new SeedRefusal('the DB safety guard could not be loaded (a Node version with TypeScript type stripping is required): refusing to seed');
  }
  guard.assertNoUnsafeEnvFiles(root);
  return guard.assertSafeTestDatabase(env);
}

/** The demo account has no password unless one is explicitly provided; a too-short one is refused (never echoed). */
function resolveDemoPassword(env = process.env) {
  const raw = env.ADKSY_DEMO_USER_PASSWORD;
  if (raw === undefined || raw === '') return null;
  if (raw.length < MIN_DEMO_PASSWORD_LENGTH) {
    throw new SeedRefusal(`ADKSY_DEMO_USER_PASSWORD must be at least ${MIN_DEMO_PASSWORD_LENGTH} characters`);
  }
  return raw;
}

/** One log line for an error, WITHOUT Prisma's invocation dump (it can contain a password hash). */
function safeErrorLine(error) {
  if (error instanceof SeedRefusal) return `REFUSED: ${error.message}`;
  if (error && error.name === 'DbSafetyError') return `REFUSED: ${error.message}`;
  const code = error && error.code ? ` ${error.code}` : '';
  const target = error && error.meta && error.meta.target ? ` (${[].concat(error.meta.target).join(', ')})` : '';
  return `Seed failed: ${(error && error.name) || 'Error'}${code}${target}. Nothing from the demo workspace was left behind (single transaction).`;
}

/** Reference data shared by every workspace. Existing rows are never modified (`update: {}`). */
async function seedReferenceData(prisma, env = process.env, log = () => {}) {
  log('Creating marketplaces...');
  for (const marketplace of MARKETPLACES) {
    await prisma.marketplace.upsert({ where: { name: marketplace.name }, update: {}, create: marketplace });
  }
  log('Creating subscription plans...');
  for (const plan of buildPlans(env)) {
    await prisma.plan.upsert({ where: { name: plan.name }, update: {}, create: plan });
  }
  log('Creating fulfillment partner...');
  await prisma.fulfillmentPartner.upsert({
    where: { name: FULFILLMENT_PARTNER_NAME },
    update: {},
    create: { name: FULFILLMENT_PARTNER_NAME, country: 'FR', apiUrl: 'https://api.shipmock.local/v1', processingTime: 24, deliveryTime: 48, costPerOrder: 5, costPerKg: 2 },
  });
}

/**
 * The demo graph, created atomically and only when the demo workspace does not exist yet.
 * @returns {Promise<{ status: 'created' | 'skipped', reason?: string }>}
 */
async function seedDemoWorkspace(prisma, { passwordHash = null, log = () => {} } = {}) {
  const existing = await prisma.workspace.findUnique({
    where: { slug: DEMO_WORKSPACE_SLUG },
    select: { id: true, user: { select: { email: true } } },
  });
  if (existing) {
    return {
      status: 'skipped',
      reason: existing.user.email === DEMO_EMAIL
        ? 'the demo workspace already exists: nothing was changed'
        : 'a workspace with the demo slug belongs to another account: left untouched',
    };
  }

  await prisma.$transaction(
    async (tx) => {
      log('Creating demo user...');
      // `update: {}`: an existing account with this e-mail is never modified (name, password, ...).
      const user = await tx.user.upsert({
        where: { email: DEMO_EMAIL },
        update: {},
        create: { email: DEMO_EMAIL, password: passwordHash, name: 'Demo Seller', country: 'FR', emailVerified: true },
      });

      const proPlan = await tx.plan.findUnique({ where: { name: 'pro' } });
      if (!proPlan) throw new SeedRefusal('plan "pro" is missing: reference data was not seeded');
      const subscription = await tx.subscription.create({
        data: { planId: proPlan.id, status: 'active', startDate: new Date(), nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      });

      log('Creating workspace...');
      const workspace = await tx.workspace.create({
        data: { name: 'Demo Shop', slug: DEMO_WORKSPACE_SLUG, description: 'Demo reselling shop for testing', country: 'FR', userId: user.id, subscriptionId: subscription.id },
      });

      log('Creating marketplace connections...');
      // MarketplaceConnection.marketplaceId references Marketplace.name (not Marketplace.id).
      for (const [marketplaceId, accountName] of [['vinted', 'demo_vinted_account'], ['ebay', 'demo_ebay_seller'], ['depop', 'demo_depop_shop']]) {
        await tx.marketplaceConnection.create({ data: { workspaceId: workspace.id, marketplaceId, status: 'mock', accountName } });
      }

      log('Creating demo products...');
      for (const productData of DEMO_PRODUCTS) {
        const product = await tx.product.create({ data: { ...productData, workspaceId: workspace.id } });
        await tx.inventory.create({
          data: { productId: product.id, workspaceId: workspace.id, quantity: productData.quantity, available: productData.quantity, reserved: 0, syncStatus: 'synced' },
        });
      }

      log('Creating listings...');
      const products = await tx.product.findMany({ where: { workspaceId: workspace.id }, orderBy: { sku: 'asc' } });
      const vintedConnection = await tx.marketplaceConnection.findUnique({ where: { workspaceId_marketplaceId: { workspaceId: workspace.id, marketplaceId: 'vinted' } } });
      const ebayConnection = await tx.marketplaceConnection.findUnique({ where: { workspaceId_marketplaceId: { workspaceId: workspace.id, marketplaceId: 'ebay' } } });
      for (const product of products.slice(0, 3)) {
        for (const [connection, prefix] of [[vintedConnection, 'VINTED'], [ebayConnection, 'EBAY']]) {
          await tx.listing.create({
            data: {
              productId: product.id, workspaceId: workspace.id, marketplaceConnectionId: connection.id, externalId: `${prefix}-${product.sku}`,
              title: product.title, description: product.description, price: product.sellingPrice, quantity: product.quantity, status: 'active', syncStatus: 'synced',
            },
          });
        }
      }

      log('Creating sample orders...');
      const listings = await tx.listing.findMany({ where: { workspaceId: workspace.id }, include: { product: true }, orderBy: { externalId: 'asc' } });
      const partner = await tx.fulfillmentPartner.findUnique({ where: { name: FULFILLMENT_PARTNER_NAME } });
      if (!partner) throw new SeedRefusal(`fulfillment partner "${FULFILLMENT_PARTNER_NAME}" is missing: reference data was not seeded`);

      const makeOrder = (listing, extra) =>
        tx.order.create({
          data: {
            workspaceId: workspace.id, listingId: listing.id, ...extra,
            items: { create: [{ productId: listing.productId, title: listing.product.title, quantity: 1, price: listing.price }] },
          },
        });

      if (listings.length > 0) {
        await makeOrder(listings[0], {
          externalOrderId: 'EXT-ORD-001', customerId: 'CUST-001', customerName: 'Alice Martin', customerEmail: 'alice@example.com',
          totalPrice: 120, marketplaceFees: 15, estimatedProfit: 85, status: 'pending', fulfillmentType: 'self',
          shippingAddress: '123 Rue de Paris', shippingCity: 'Paris', shippingPostalCode: '75001', shippingCountry: 'FR',
        });
      }
      if (listings.length > 1) {
        const order2 = await makeOrder(listings[1], {
          externalOrderId: 'EXT-ORD-002', customerId: 'CUST-002', customerName: 'Bob Dupont', customerEmail: 'bob@example.com',
          totalPrice: 95, marketplaceFees: 12, estimatedProfit: 65, status: 'processing', fulfillmentType: 'automatic',
          shippingAddress: '456 Avenue Montaigne', shippingCity: 'Lyon', shippingPostalCode: '69000', shippingCountry: 'FR',
        });
        await tx.fulfillmentOrder.create({
          data: { workspaceId: workspace.id, orderId: order2.id, partnerId: partner.id, status: 'processing', quantity: 1, totalCost: 5, revenue: 95, profit: 73 },
        });
      }
      if (listings.length > 2) {
        const order3 = await makeOrder(listings[2], {
          externalOrderId: 'EXT-ORD-003', customerId: 'CUST-003', customerName: 'Caroline Petit', customerEmail: 'caroline@example.com',
          totalPrice: 140, marketplaceFees: 18, estimatedProfit: 101, status: 'shipped', fulfillmentType: 'automatic',
          shippingAddress: '789 Boulevard Saint-Germain', shippingCity: 'Paris', shippingPostalCode: '75005', shippingCountry: 'FR',
        });
        const fulfillmentOrder = await tx.fulfillmentOrder.create({
          data: { workspaceId: workspace.id, orderId: order3.id, partnerId: partner.id, status: 'shipped', quantity: 1, totalCost: 6, revenue: 140, profit: 116 },
        });
        await tx.shipment.create({
          data: {
            fulfillmentOrderId: fulfillmentOrder.id, partnerId: partner.id, trackingNumber: 'FR123456789123', carrier: 'La Poste',
            trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=FR123456789123', status: 'in_transit',
            estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
            trackingEvents: {
              create: [
                { status: 'picked_up', location: 'Fulfillment Center Paris', description: 'Package picked up from fulfillment center', timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000) },
                { status: 'in_transit', location: 'Distribution Center Lyon', description: 'Package in transit to delivery area', timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000) },
              ],
            },
          },
        });
      }
    },
    { maxWait: 10000, timeout: 60000 }
  );
  return { status: 'created' };
}

function parseArgs(argv) {
  for (const arg of argv) {
    if (arg !== '--dry-run') throw new SeedRefusal(`argument not accepted: ${arg.startsWith('-') ? arg.split('=')[0] : '<value>'}`);
  }
  return { dryRun: argv.includes('--dry-run') };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const { dryRun } = parseArgs(argv);

  // 1. the target is validated BEFORE any client exists, any file is read for credentials, or anything is connected
  const target = await assertSafeSeedTarget(env);
  const password = resolveDemoPassword(env);
  console.log(`Seed target (guarded): ${target.host}:${target.port} / ${target.database} / ${target.user}`);

  if (dryRun) {
    console.log('Dry run: would upsert marketplaces/plans/partner and create the demo workspace only if it does not exist. Nothing was written.');
    console.log(password ? 'Demo account password: from ADKSY_DEMO_USER_PASSWORD (hashed; never printed).' : 'Demo account password: none (the account cannot sign in with a password).');
    return;
  }

  // 2. only now is the client created
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ log: ['error'] });
  try {
    const log = (message) => console.log(message);
    console.log('Seeding database...');
    await seedReferenceData(prisma, env, log);
    const passwordHash = password ? await require('bcryptjs').hash(password, 10) : null;
    const result = await seedDemoWorkspace(prisma, { passwordHash, log });
    console.log(result.status === 'created' ? 'Seeding complete.' : `Demo workspace not created — ${result.reason}.`);
    console.log(password ? 'Demo account password: from ADKSY_DEMO_USER_PASSWORD (not printed).' : 'Demo account has no password (set ADKSY_DEMO_USER_PASSWORD, at least 12 characters, before seeding to create a password-protected one).');
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  DEMO_EMAIL,
  DEMO_WORKSPACE_SLUG,
  DEMO_PRODUCTS,
  MARKETPLACES,
  MIN_DEMO_PASSWORD_LENGTH,
  SeedRefusal,
  assertSafeSeedTarget,
  buildPlans,
  main,
  parseArgs,
  resolveDemoPassword,
  safeErrorLine,
  seedDemoWorkspace,
  seedReferenceData,
};

// Only when executed directly: requiring this file (tests) never connects to anything.
if (require.main === module) {
  main().catch((error) => {
    console.error(safeErrorLine(error));
    process.exit(error instanceof SeedRefusal || (error && error.name === 'DbSafetyError') ? 2 : 1);
  });
}
