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
 * Target confirmation (R4/R5): before ANY write the script prints the database
 * host / port / name (never the user, the password or URL parameters) and
 * requires the operator to name the WHOLE target explicitly:
 * PLAN_SEED_EXPECTED_DB_HOST, PLAN_SEED_EXPECTED_DB_PORT and
 * PLAN_SEED_EXPECTED_DB_NAME must equal host, port and database name of
 * DATABASE_URL. It also refuses ambiguous URLs (host=/port=/dbname=/options=
 * parameters, several hosts), a DIRECT_URL for another target, any .env file
 * that defines another target, and any internal failure of the check.
 * Refusal = exit code 2 and no client is even created. Dry runs and read-only
 * summaries are unaffected. The plans are written in ONE transaction.
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
 *   Real run (writes only once explicitly opted in AND the target host is named):
 *     ALLOW_PRODUCTION_PLAN_SEED=true PLAN_SEED_EXPECTED_DB_HOST=<host> \
 *       PLAN_SEED_EXPECTED_DB_PORT=<port> PLAN_SEED_EXPECTED_DB_NAME=<name> \
 *       node prisma/seed-plans-production.js   (the three values: as shown by the dry run)
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
      // The AI Agent is available on every plan (see prisma/seed.js's own
      // comment on this field) — usage is limited by AI Units quota, not
      // by this flag.
      aiAssistant: true,
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
      aiAssistant: true,
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
      aiAssistant: true,
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

/**
 * Non-sensitive description of the database this script would use: host, port and database name only —
 * never the user, the password or any URL parameter. Returns null when DATABASE_URL is missing/malformed.
 */
function describeDatabaseTarget(env = process.env) {
  try {
    const url = new URL(env.DATABASE_URL);
    return {
      host: url.hostname.toLowerCase(),
      port: url.port || '(default)',
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  } catch {
    return null;
  }
}

/**
 * ---- Full target confirmation (R4/R5 follow-up) --------------------------------------------------
 * Hostname alone is not enough (several databases can live on one server). Before ANY write the
 * operator must name the WHOLE target, in three variables whose values are never hardcoded here:
 *   PLAN_SEED_EXPECTED_DB_HOST   PLAN_SEED_EXPECTED_DB_PORT   PLAN_SEED_EXPECTED_DB_NAME
 * and host + port + database name of DATABASE_URL must each equal them exactly. Also refused:
 *   - any ambiguous / alternative connection parameter in the URL (host=, port=, dbname=, options=...);
 *   - several hosts in one URL, a unix-socket URL, a non-postgres scheme;
 *   - DIRECT_URL set but describing another target (or itself ambiguous);
 *   - any env file that Prisma/dotenv may read (.env, prisma/.env, ...) defining DATABASE_URL / DIRECT_URL
 *     for another target (or ambiguously);
 *   - any internal failure of this check (fail-closed).
 * Refusal reasons are fixed codes: they never contain a URL, user, password or parameter value.
 */
const EXPECTED_TARGET_VARS = Object.freeze({
  host: 'PLAN_SEED_EXPECTED_DB_HOST',
  port: 'PLAN_SEED_EXPECTED_DB_PORT',
  database: 'PLAN_SEED_EXPECTED_DB_NAME',
});

const AMBIGUOUS_URL_PARAMS = Object.freeze([
  'host', 'hostaddr', 'port', 'dbname', 'database', 'user', 'password', 'service', 'servicefile',
  'passfile', 'options', 'target_session_attrs', 'load_balance_hosts',
]);

const ENV_FILE_CANDIDATES = Object.freeze([
  '.env', '.env.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local',
  '.env.production', '.env.production.local', 'prisma/.env',
]);

/** Parses one postgres URL into { host, port, database } or returns a fixed reason code. Pure; never throws. */
function parseDatabaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { reason: 'URL_MISSING' };
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { reason: 'URL_MALFORMED' };
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return { reason: 'URL_NOT_POSTGRES' };
  // several hosts (host1:5432,host2:5432) make the effective target ambiguous
  const authority = raw.trim().replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0];
  const hostPart = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  if (hostPart.includes(',')) return { reason: 'URL_MULTIPLE_HOSTS' };
  const host = decodeURIComponent(url.hostname).toLowerCase();
  if (!host) return { reason: 'URL_NO_HOST' };
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database || database.includes('/')) return { reason: 'URL_NO_DATABASE' };
  for (const key of url.searchParams.keys()) {
    if (AMBIGUOUS_URL_PARAMS.includes(key.toLowerCase())) return { reason: 'URL_AMBIGUOUS_PARAMETER' };
  }
  return { target: { host, port: url.port || '5432', database } };
}

/** Reads the three expected values from the environment; returns { expected } or a reason code. */
function readExpectedTarget(env) {
  const host = (env[EXPECTED_TARGET_VARS.host] || '').trim().toLowerCase();
  const port = (env[EXPECTED_TARGET_VARS.port] || '').trim();
  const database = (env[EXPECTED_TARGET_VARS.database] || '').trim();
  if (!host || !port || !database) return { reason: 'EXPECTED_TARGET_INCOMPLETE' };
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return { reason: 'EXPECTED_PORT_INVALID' };
  return { expected: { host, port: String(Number(port)), database } };
}

function sameTarget(a, b) {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

/** DATABASE_URL / DIRECT_URL assignments of a dotenv text (later assignment wins, like dotenv). Pure. */
function findDbVarsInEnvText(text) {
  const found = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(DATABASE_URL|DIRECT_URL)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.includes(quote, 1)) value = value.slice(1, value.indexOf(quote, 1));
    else value = value.replace(/\s+#.*$/, '').trim();
    if (value.length > 0) found[m[1]] = value;
  }
  return found;
}

/**
 * Fail-closed confirmation, required before any write. `io` is injectable for tests:
 *   { root, exists(path) -> boolean, read(path) -> string }
 * Returns { ok: true, target } or { ok: false, reason } where reason is a fixed, non-sensitive sentence.
 */
function checkExpectedTarget(env = process.env, io) {
  try {
    const exp = readExpectedTarget(env);
    if (exp.reason) {
      return {
        ok: false,
        reason:
          exp.reason === 'EXPECTED_PORT_INVALID'
            ? `${EXPECTED_TARGET_VARS.port} is not a valid port: nothing was written`
            : `the full expected target is not set: define ${Object.values(EXPECTED_TARGET_VARS).join(', ')} ` +
              '(host, port and database name shown by the dry run): nothing was written',
      };
    }
    const main = parseDatabaseUrl(env.DATABASE_URL);
    if (main.reason) return { ok: false, reason: `DATABASE_URL cannot be used as a write target (${main.reason}): nothing was written` };
    if (!sameTarget(main.target, exp.expected)) {
      const which = ['host', 'port', 'database'].filter((k) => main.target[k] !== exp.expected[k]);
      return { ok: false, reason: `DATABASE_URL does not match the expected target (differs on: ${which.join(', ')}): nothing was written` };
    }
    if (env.DIRECT_URL !== undefined && String(env.DIRECT_URL).trim() !== '') {
      const direct = parseDatabaseUrl(env.DIRECT_URL);
      if (direct.reason) return { ok: false, reason: `DIRECT_URL cannot be used as a write target (${direct.reason}): nothing was written` };
      if (!sameTarget(direct.target, exp.expected)) {
        return { ok: false, reason: 'DIRECT_URL describes another target than the expected one: nothing was written' };
      }
    }
    if (io) {
      for (const rel of ENV_FILE_CANDIDATES) {
        const abs = `${io.root}/${rel}`;
        if (!io.exists(abs)) continue;
        const vars = findDbVarsInEnvText(io.read(abs));
        for (const [name, raw] of Object.entries(vars)) {
          const parsed = parseDatabaseUrl(raw);
          if (parsed.reason || !sameTarget(parsed.target, exp.expected)) {
            return { ok: false, reason: `env file ${rel} defines ${name} for another or ambiguous target: nothing was written` };
          }
        }
      }
    }
    return { ok: true, target: main.target };
  } catch {
    return { ok: false, reason: 'the target check failed internally (fail-closed): nothing was written' };
  }
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

/**
 * Returns the process exit code (0 ok, 2 refused). Every dependency is injectable so the refusal paths
 * can be tested without any database: `createClient` is called only AFTER the target check passed for a
 * write run, so a refused run never even builds a client.
 */
async function main({
  env = process.env,
  argv = process.argv,
  createClient = () => new PrismaClient(),
  io = {
    root: require('path').resolve(__dirname, '..'),
    exists: (p) => require('fs').existsSync(p),
    read: (p) => require('fs').readFileSync(p, 'utf8'),
  },
  log = console.log,
  logError = console.error,
} = {}) {
  const dryRun = argv.includes('--dry-run');
  const allowFlag = env.ALLOW_PRODUCTION_PLAN_SEED;
  const writeRequested = isWriteAllowed({ dryRun, allowFlag });

  const target = describeDatabaseTarget(env);
  log(
    'Database target (host / port / name only):',
    target ? `${target.host} / ${target.port} / ${target.database}` : '(DATABASE_URL missing or malformed)'
  );

  if (writeRequested) {
    const confirmation = checkExpectedTarget(env, io);
    if (!confirmation.ok) {
      logError(`REFUSED: ${confirmation.reason}`);
      return 2;
    }
  }

  const prisma = createClient();
  try {
    const plans = buildPlans(env);
    const stripeEnvPresence = getStripeEnvPresence(env);

    // Read-only: which plans already exist.
    const existingPlans = await prisma.plan.findMany({ select: { name: true } });

    printSummary({ existingPlans, plans, stripeEnvPresence });

    if (!writeRequested) {
      log(
        dryRun
          ? 'Dry run: no write performed.'
          : 'ALLOW_PRODUCTION_PLAN_SEED is not set to "true": no write performed. ' +
              'Set ALLOW_PRODUCTION_PLAN_SEED=true explicitly to actually create the missing plans.'
      );
      return 0;
    }

    log('ALLOW_PRODUCTION_PLAN_SEED=true and the full target is confirmed — creating missing plans now in one transaction (existing plans are never modified)...');
    await prisma.$transaction(
      plans.map((plan) =>
        prisma.plan.upsert({
          where: { name: plan.name },
          update: {},
          create: plan,
        })
      )
    );
    log('Done.');
    return 0;
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
  describeDatabaseTarget,
  checkExpectedTarget,
  parseDatabaseUrl,
  readExpectedTarget,
  findDbVarsInEnvText,
  EXPECTED_TARGET_VARS,
  ENV_FILE_CANDIDATES,
  main,
  printSummary,
};

// Only run when executed directly (`node prisma/seed-plans-production.js`)
// — requiring this file from a test imports the pure helpers above
// without ever opening a Prisma connection or writing anything.
if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      // never print the raw error: a Prisma error can embed connection details
      console.error(`Plan seed failed (${(e && e.code) || (e && e.name) || 'error'}).`);
      process.exit(1);
    });
}
