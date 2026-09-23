/**
 * seed-plans-production.js
 *
 * Single responsibility: create the Plan rows that are missing (free,
 * starter, pro, business, enterprise) and leave any Plan row that already
 * exists completely untouched. Nothing else.
 *
 * This is deliberately NOT a variant of prisma/seed.js — it does not
 * import it, does not reuse its PLANS constant, and touches ONLY the
 * `Plan` table via prisma.plan.findMany() (read) and prisma.plan.upsert()
 * (write). It never creates/updates/deletes a User, Workspace, Product,
 * Listing, Order, Subscription, FulfillmentOrder, Shipment or
 * MarketplaceConnection — prisma/seed.js does all of that for local/demo
 * seeding, which is exactly what makes it unsafe to run against a real
 * production database (see the audit that preceded this file).
 *
 * Plan field values below are copied verbatim from prisma/seed.js's own
 * PLANS array (name, displayName, description, price, limits, feature
 * flags) — nothing here is invented. The 6 Stripe Price ID env var names
 * are the exact same ones prisma/seed.js already reads:
 *   STRIPE_PRICE_ID_STARTER_MONTHLY   STRIPE_PRICE_ID_STARTER_ANNUAL
 *   STRIPE_PRICE_ID_PRO_MONTHLY       STRIPE_PRICE_ID_PRO_ANNUAL
 *   STRIPE_PRICE_ID_BUSINESS_MONTHLY  STRIPE_PRICE_ID_BUSINESS_ANNUAL
 * A missing variable becomes `null` (never a fabricated placeholder
 * value) — exactly prisma/seed.js's own `|| null` behavior. Enterprise
 * never receives a Stripe Price ID, matching prisma/seed.js.
 *
 * Idempotence: every plan uses
 *   prisma.plan.upsert({ where: { name }, update: {}, create: plan })
 * — the same `update: {}` convention prisma/seed.js uses for Plan. If a
 * plan with that name already exists, NOTHING about it is changed by
 * this script, ever. Only plans that don't exist yet are created.
 *
 * Safety gate: this script NEVER writes anything unless the environment
 * variable ALLOW_PRODUCTION_PLAN_SEED is set to the exact string "true".
 * Without it (the default), running this file only prints the read-only
 * summary below and exits — the same behavior as passing --dry-run,
 * which always skips writes regardless of ALLOW_PRODUCTION_PLAN_SEED.
 *
 * Uses the project's normal Prisma configuration (the same
 * `datasource db { url = env("DATABASE_URL") }` from prisma/schema.prisma
 * that every other part of this app uses) — no separate connection
 * string, nothing hardcoded, nothing printed from it.
 *
 * Usage (documented here for the operator; this file does not run
 * itself, and importing/requiring it from a test never calls main()):
 *   Dry run (always read-only, any environment):
 *     node prisma/seed-plans-production.js --dry-run
 *   Real run (writes only once explicitly opted in):
 *     ALLOW_PRODUCTION_PLAN_SEED=true node prisma/seed-plans-production.js
 */

const { PrismaClient } = require('@prisma/client');

/**
 * Exact same 6 env var names prisma/seed.js reads for Starter/Pro/Business.
 * Exported so a test can assert this list without re-typing it, and so
 * the summary below always reflects the true set of variables this
 * script depends on.
 */
const STRIPE_PRICE_ID_ENV_VARS = [
  'STRIPE_PRICE_ID_STARTER_MONTHLY',
  'STRIPE_PRICE_ID_STARTER_ANNUAL',
  'STRIPE_PRICE_ID_PRO_MONTHLY',
  'STRIPE_PRICE_ID_PRO_ANNUAL',
  'STRIPE_PRICE_ID_BUSINESS_MONTHLY',
  'STRIPE_PRICE_ID_BUSINESS_ANNUAL',
];

/**
 * Builds the 5 Plan payloads from current process.env, mirroring
 * prisma/seed.js's PLANS array field-for-field. A function (not a
 * module-load-time constant) so tests can set env vars first and call
 * this fresh, without needing to re-require the module.
 */
function buildPlans(env = process.env) {
  return [
    {
      name: 'free',
      displayName: 'Free',
      description: 'For beginners',
      price: 0,
      maxProducts: 10,
      maxListings: 20,
      maxOrders: 50,
      maxMarketplaces: 2,
      maxUsers: 1,
      fulfillmentEnabled: false,
      advancedAnalytics: false,
      apiAccess: false,
      stripePriceIdMonthly: null,
      stripePriceIdAnnual: null,
    },
    {
      name: 'starter',
      displayName: 'Starter',
      description: 'For small resellers',
      price: 19,
      maxProducts: 100,
      maxListings: 300,
      maxOrders: 500,
      maxMarketplaces: 3,
      maxUsers: 1,
      fulfillmentEnabled: false,
      advancedAnalytics: false,
      apiAccess: false,
      stripePriceIdMonthly: env.STRIPE_PRICE_ID_STARTER_MONTHLY || null,
      stripePriceIdAnnual: env.STRIPE_PRICE_ID_STARTER_ANNUAL || null,
    },
    {
      name: 'pro',
      displayName: 'Pro',
      description: 'For serious resellers',
      price: 49,
      maxProducts: 500,
      maxListings: 1500,
      maxOrders: 2000,
      maxMarketplaces: 4,
      maxUsers: 1,
      fulfillmentEnabled: true,
      advancedAnalytics: true,
      apiAccess: false,
      stripePriceIdMonthly: env.STRIPE_PRICE_ID_PRO_MONTHLY || null,
      stripePriceIdAnnual: env.STRIPE_PRICE_ID_PRO_ANNUAL || null,
    },
    {
      name: 'business',
      displayName: 'Business',
      description: 'For large operations',
      price: 99,
      maxProducts: 5000,
      maxListings: 10000,
      maxOrders: 10000,
      maxMarketplaces: 4,
      maxUsers: 5,
      fulfillmentEnabled: true,
      advancedAnalytics: true,
      apiAccess: true,
      aiAssistant: true,
      stripePriceIdMonthly: env.STRIPE_PRICE_ID_BUSINESS_MONTHLY || null,
      stripePriceIdAnnual: env.STRIPE_PRICE_ID_BUSINESS_ANNUAL || null,
    },
    {
      name: 'enterprise',
      displayName: 'Enterprise',
      description: 'Custom solution',
      price: 0,
      maxProducts: 999999,
      maxListings: 999999,
      maxOrders: 999999,
      maxMarketplaces: 4,
      maxUsers: 999,
      fulfillmentEnabled: true,
      advancedAnalytics: true,
      apiAccess: true,
      aiAssistant: true,
      // Never given a Stripe Price ID, in any environment — Enterprise is
      // custom pricing, exactly like prisma/seed.js.
      stripePriceIdMonthly: null,
      stripePriceIdAnnual: null,
    },
  ];
}

/** Pure diff: which of `plans` have no matching row in `existingPlans`. */
function getMissingPlanNames(existingPlans, plans) {
  const existingNames = new Set(existingPlans.map((p) => p.name));
  return plans.filter((p) => !existingNames.has(p.name)).map((p) => p.name);
}

/**
 * Writes happen only when explicitly opted in AND not in dry-run mode.
 * dry-run always wins — it forces read-only behavior regardless of the
 * ALLOW_PRODUCTION_PLAN_SEED value.
 */
function isWriteAllowed({ dryRun, allowFlag }) {
  if (dryRun) return false;
  return allowFlag === 'true';
}

/** Presence-only (never values) map of the 6 Stripe Price ID env vars. */
function getStripeEnvPresence(env = process.env) {
  const presence = {};
  for (const name of STRIPE_PRICE_ID_ENV_VARS) {
    presence[name] = Boolean(env[name]);
  }
  return presence;
}

function printSummary({ existingPlans, plans, stripeEnvPresence }) {
  const existingNames = existingPlans.map((p) => p.name).sort();
  const missingNames = getMissingPlanNames(existingPlans, plans).sort();
  const preservedNames = plans
    .map((p) => p.name)
    .filter((name) => existingNames.includes(name))
    .sort();

  console.log('--- Plan seed summary (read-only) ---');
  console.log('Existing plans in DB:', existingNames.length ? existingNames.join(', ') : '(none)');
  console.log('Missing plans (will be CREATED if writes are allowed):', missingNames.length ? missingNames.join(', ') : '(none)');
  console.log('Plans that already exist (will be PRESERVED unchanged — update: {}):', preservedNames.length ? preservedNames.join(', ') : '(none)');
  console.log('Stripe Price ID env vars present (name only, never the value):');
  for (const [name, present] of Object.entries(stripeEnvPresence)) {
    console.log(`  ${name}: ${present ? 'yes' : 'no'}`);
  }
  console.log('--------------------------------------');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const allowFlag = process.env.ALLOW_PRODUCTION_PLAN_SEED;

  const prisma = new PrismaClient();
  try {
    const plans = buildPlans(process.env);
    const stripeEnvPresence = getStripeEnvPresence(process.env);

    // Read-only — the only table touched by this script, in either mode.
    const existingPlans = await prisma.plan.findMany({ select: { name: true } });

    printSummary({ existingPlans, plans, stripeEnvPresence });

    if (!isWriteAllowed({ dryRun, allowFlag })) {
      console.log(
        dryRun
          ? 'Dry run: no write performed.'
          : 'ALLOW_PRODUCTION_PLAN_SEED is not set to "true": no write performed. ' +
              'Set ALLOW_PRODUCTION_PLAN_SEED=true explicitly to actually create the missing plans.'
      );
      return;
    }

    console.log('ALLOW_PRODUCTION_PLAN_SEED=true — creating missing plans now (existing plans are never modified)...');
    for (const plan of plans) {
      await prisma.plan.upsert({
        where: { name: plan.name },
        update: {},
        create: plan,
      });
    }
    console.log('Done.');
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  STRIPE_PRICE_ID_ENV_VARS,
  buildPlans,
  getMissingPlanNames,
  isWriteAllowed,
  getStripeEnvPresence,
  printSummary,
};

// Only run when executed directly (`node prisma/seed-plans-production.js`)
// — requiring this file from a test imports the pure helpers above
// without ever opening a Prisma connection or writing anything.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
