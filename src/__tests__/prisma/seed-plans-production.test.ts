/**
 * Static/behavioral tests for prisma/seed-plans-production.js — the
 * Plan-only production seed script prepared alongside the audit that
 * found prisma/seed.js unsafe to run against production (it also creates
 * a demo user/workspace/products/orders).
 *
 * These tests never open a database connection: requiring the script
 * only evaluates its top-level `require('@prisma/client')` (importing
 * the class, not connecting) and exports its pure helper functions —
 * main() only runs when the file is executed directly
 * (`require.main === module`), which is never true when Vitest requires
 * it here. No test in this file calls main(), instantiates PrismaClient,
 * or touches any real DATABASE_URL — real or test — by design.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCRIPT_PATH = path.resolve(__dirname, '../../../prisma/seed-plans-production.js');
const seedPlans = require(SCRIPT_PATH);

const ENV_VARS = [
  'STRIPE_PRICE_ID_STARTER_MONTHLY',
  'STRIPE_PRICE_ID_STARTER_ANNUAL',
  'STRIPE_PRICE_ID_PRO_MONTHLY',
  'STRIPE_PRICE_ID_PRO_ANNUAL',
  'STRIPE_PRICE_ID_BUSINESS_MONTHLY',
  'STRIPE_PRICE_ID_BUSINESS_ANNUAL',
];

function clearStripeEnv() {
  for (const name of ENV_VARS) delete process.env[name];
}

describe('seed-plans-production.js — buildPlans', () => {
  beforeEach(clearStripeEnv);
  afterEach(clearStripeEnv);

  it('builds exactly the 5 expected plans, in the field values copied from prisma/seed.js', () => {
    const plans = seedPlans.buildPlans({});
    expect(plans.map((p: any) => p.name)).toEqual(['free', 'starter', 'pro', 'business', 'enterprise']);

    const free = plans.find((p: any) => p.name === 'free');
    expect(free.price).toBe(0);
    expect(free.stripePriceIdMonthly).toBeNull();
    expect(free.stripePriceIdAnnual).toBeNull();

    const starter = plans.find((p: any) => p.name === 'starter');
    expect(starter.price).toBe(19);

    const pro = plans.find((p: any) => p.name === 'pro');
    expect(pro.price).toBe(49);
    expect(pro.fulfillmentEnabled).toBe(true);

    const business = plans.find((p: any) => p.name === 'business');
    expect(business.price).toBe(99);
    expect(business.aiAssistant).toBe(true);

    const enterprise = plans.find((p: any) => p.name === 'enterprise');
    expect(enterprise.price).toBe(0);
    expect(enterprise.aiAssistant).toBe(true);
  });

  it('never hardcodes a Stripe Price ID — missing env vars become null, never a fabricated value', () => {
    const plans = seedPlans.buildPlans({});
    const starter = plans.find((p: any) => p.name === 'starter');
    const pro = plans.find((p: any) => p.name === 'pro');
    const business = plans.find((p: any) => p.name === 'business');

    expect(starter.stripePriceIdMonthly).toBeNull();
    expect(starter.stripePriceIdAnnual).toBeNull();
    expect(pro.stripePriceIdMonthly).toBeNull();
    expect(pro.stripePriceIdAnnual).toBeNull();
    expect(business.stripePriceIdMonthly).toBeNull();
    expect(business.stripePriceIdAnnual).toBeNull();
  });

  it('reads the real Price ID from env when present, for Starter/Pro/Business only', () => {
    const plans = seedPlans.buildPlans({
      STRIPE_PRICE_ID_STARTER_MONTHLY: 'price_starter_m',
      STRIPE_PRICE_ID_PRO_ANNUAL: 'price_pro_a',
      STRIPE_PRICE_ID_BUSINESS_MONTHLY: 'price_business_m',
    });

    expect(plans.find((p: any) => p.name === 'starter').stripePriceIdMonthly).toBe('price_starter_m');
    expect(plans.find((p: any) => p.name === 'pro').stripePriceIdAnnual).toBe('price_pro_a');
    expect(plans.find((p: any) => p.name === 'business').stripePriceIdMonthly).toBe('price_business_m');
  });

  it('Enterprise NEVER receives a Stripe Price ID, even if the env vars happen to be set', () => {
    const plans = seedPlans.buildPlans({
      STRIPE_PRICE_ID_STARTER_MONTHLY: 'price_x',
      STRIPE_PRICE_ID_PRO_MONTHLY: 'price_y',
      STRIPE_PRICE_ID_BUSINESS_MONTHLY: 'price_z',
    });
    const enterprise = plans.find((p: any) => p.name === 'enterprise');
    expect(enterprise.stripePriceIdMonthly).toBeNull();
    expect(enterprise.stripePriceIdAnnual).toBeNull();
  });
});

describe('seed-plans-production.js — getMissingPlanNames', () => {
  it('returns only the names absent from the existing rows', () => {
    const plans = seedPlans.buildPlans({});
    const existing = [{ name: 'free' }];
    expect(seedPlans.getMissingPlanNames(existing, plans)).toEqual(['starter', 'pro', 'business', 'enterprise']);
  });

  it('returns an empty list when every plan already exists', () => {
    const plans = seedPlans.buildPlans({});
    const existing = plans.map((p: any) => ({ name: p.name }));
    expect(seedPlans.getMissingPlanNames(existing, plans)).toEqual([]);
  });
});

describe('seed-plans-production.js — isWriteAllowed (the safety gate)', () => {
  it('never writes in dry-run mode, regardless of the allow flag', () => {
    expect(seedPlans.isWriteAllowed({ dryRun: true, allowFlag: 'true' })).toBe(false);
    expect(seedPlans.isWriteAllowed({ dryRun: true, allowFlag: undefined })).toBe(false);
  });

  it('never writes when ALLOW_PRODUCTION_PLAN_SEED is unset or anything other than the exact string "true"', () => {
    expect(seedPlans.isWriteAllowed({ dryRun: false, allowFlag: undefined })).toBe(false);
    for (const value of ['1', 'yes', 'TRUE', 'True', ' true']) {
      expect(seedPlans.isWriteAllowed({ dryRun: false, allowFlag: value })).toBe(false);
    }
  });

  it('only writes when explicitly allowed AND not a dry run', () => {
    expect(seedPlans.isWriteAllowed({ dryRun: false, allowFlag: 'true' })).toBe(true);
  });
});

describe('seed-plans-production.js — getStripeEnvPresence', () => {
  beforeEach(clearStripeEnv);
  afterEach(clearStripeEnv);

  it('reports presence only, for exactly the 6 variables prisma/seed.js already uses — never a value', () => {
    process.env.STRIPE_PRICE_ID_STARTER_MONTHLY = 'price_real_value';
    const presence = seedPlans.getStripeEnvPresence(process.env);

    expect(Object.keys(presence).sort()).toEqual([...ENV_VARS].sort());
    expect(presence.STRIPE_PRICE_ID_STARTER_MONTHLY).toBe(true);
    expect(presence.STRIPE_PRICE_ID_STARTER_ANNUAL).toBe(false);
    expect(JSON.stringify(presence)).not.toContain('price_real_value');
  });
});

describe('seed-plans-production.js — scope discipline (static source checks)', () => {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');

  it('only ever calls prisma.plan.* — no other Prisma model is touched', () => {
    const modelCalls = source.match(/prisma\.(\w+)\./g) || [];
    const models = new Set(modelCalls.map((m) => m.split('.')[1]));
    expect(Array.from(models)).toEqual(['plan']);
  });

  it('contains no .create(/.upsert(/.update(/.delete( call on any forbidden model', () => {
    const forbidden = [
      'user.create', 'user.upsert', 'user.update', 'user.delete',
      'workspace.create', 'workspace.upsert', 'workspace.update', 'workspace.delete',
      'product.create', 'listing.create', 'order.create', 'subscription.create',
      'fulfillmentOrder.create', 'shipment.create', 'marketplaceConnection.create',
      'deleteMany', '.delete(',
    ];
    for (const pattern of forbidden) {
      expect(source).not.toContain(pattern);
    }
  });

  it('never hardcodes a Stripe price_ literal', () => {
    // The word "price_" only appears inside comments/usage examples in
    // this file, never as an assigned literal like `= 'price_...'`.
    expect(source).not.toMatch(/stripePriceId\w*:\s*['"]price_/);
  });

  it('does not require or reference prisma/seed.js', () => {
    expect(source).not.toMatch(/require\(.*seed\.js.*\)/);
  });

  it('main() only runs when the file is executed directly, never on require', () => {
    expect(source).toContain('require.main === module');
  });
});

describe('prisma/seed.js — unchanged by this task', () => {
  it('still contains its original demo-data responsibilities (proves it was not trimmed or altered)', () => {
    const seedJsPath = path.resolve(__dirname, '../../../prisma/seed.js');
    const source = fs.readFileSync(seedJsPath, 'utf8');
    expect(source).toContain("prisma.workspace.create");
    expect(source).toContain("demo@reselling.local");
    expect(source).toContain('prisma.plan.upsert');
  });
});
