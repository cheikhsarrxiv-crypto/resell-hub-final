/**
 * R4/R5 — the seeds are repaired and secured. No database is contacted by any
 * test in this file (refusals happen before a client exists; the rest is
 * static or pure).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SEED_PATH = path.join(ROOT, 'prisma/seed.js');
const seed = require(SEED_PATH);

const seedSource = readFileSync(SEED_PATH, 'utf8');

const SUPABASE_URL = 'postgresql://postgres.abcdefghijklmnop:Sup4-secret-pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
const OK_URL = 'postgresql://adksy_r3c_test:unit-test-not-a-real-secret@127.0.0.1:5433/adksy_r3c_test?schema=public';

const temps: string[] = [];
afterAll(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

function runSeed(args: string[], extraEnv: Record<string, string> = {}) {
  const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', NODE_NO_WARNINGS: '1', ...extraEnv } as unknown as NodeJS.ProcessEnv;
  const r = spawnSync(process.execPath, [SEED_PATH, ...args], { env, cwd: tmpdir(), encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('prisma/seed.js — static safety properties', () => {
  it('contains no hardcoded credential and prints none', () => {
    expect(seedSource).not.toMatch(/demo1234/i);
    expect(seedSource).not.toMatch(/bcrypt\.hash\(\s*['"]/); // never hashes a literal
    const logLines = seedSource.split('\n').filter((l) => /console\.(log|error)/.test(l));
    for (const line of logLines) expect(line).not.toMatch(/\bpassword\b[^'"]*\$\{|\$\{[^}]*password|passwordHash/i);
  });

  it('the documentation no longer advertises a password', () => {
    for (const doc of ['README.md', 'QUICK_START.md', 'PROJECT_SUMMARY.md']) {
      expect(fs.readFileSync(path.join(ROOT, doc), 'utf8')).not.toMatch(/demo1234/);
    }
  });

  it('never deletes or resets anything', () => {
    for (const forbidden of ['deleteMany', '.delete(', 'TRUNCATE', 'executeRaw', 'queryRaw', 'DROP ']) {
      expect(seedSource).not.toContain(forbidden);
    }
  });

  it('every upsert keeps existing rows untouched (`update: {}`)', () => {
    const starts = [...seedSource.matchAll(/\.upsert\(/g)].map((m) => m.index as number);
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (const at of starts) expect(seedSource.slice(at, at + 260)).toContain('update: {}');
  });

  it('the target is validated before any Prisma client exists, and no client is created at import', () => {
    const guardCall = seedSource.indexOf('await assertSafeSeedTarget(env)');
    const clientCreation = seedSource.indexOf('new PrismaClient(');
    expect(guardCall).toBeGreaterThan(-1);
    expect(clientCreation).toBeGreaterThan(guardCall);
    expect(seedSource).not.toMatch(/^const prisma = new PrismaClient/m);
    expect(seedSource).toContain('require.main === module');
  });

  it('the demo graph is one transaction and uses Marketplace.name (not id) for connections', () => {
    expect(seedSource).toContain('prisma.$transaction(');
    expect(seedSource).not.toMatch(/marketplaceId:\s*\w+\.id/);
  });

  it('error output goes through safeErrorLine (no Prisma invocation dump)', () => {
    expect(seedSource).toContain('console.error(safeErrorLine(error))');
    expect(seedSource).not.toMatch(/console\.error\(\s*e(rror)?\s*\)/);
  });
});

describe('prisma/seed.js — pure helpers', () => {
  it('the demo password is optional; absent means no password', () => {
    expect(seed.resolveDemoPassword({})).toBeNull();
    expect(seed.resolveDemoPassword({ ADKSY_DEMO_USER_PASSWORD: '' })).toBeNull();
  });

  it('a too-short password is refused without echoing it', () => {
    let message = '';
    try {
      seed.resolveDemoPassword({ ADKSY_DEMO_USER_PASSWORD: 'short-pw-1' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(String(seed.MIN_DEMO_PASSWORD_LENGTH));
    expect(message).not.toContain('short-pw-1');
  });

  it('a long enough password is returned as given', () => {
    expect(seed.resolveDemoPassword({ ADKSY_DEMO_USER_PASSWORD: 'a-long-enough-pass' })).toBe('a-long-enough-pass');
  });

  it('only --dry-run is accepted as an argument', () => {
    expect(seed.parseArgs([])).toEqual({ dryRun: false });
    expect(seed.parseArgs(['--dry-run'])).toEqual({ dryRun: true });
    for (const bad of [['--force'], ['--url=postgresql://x'], ['reset'], ['--dry-run', '--drop']]) {
      expect(() => seed.parseArgs(bad)).toThrow(/argument not accepted/);
    }
  });

  it('safeErrorLine never includes the message of a Prisma-like error (it can contain a password hash)', () => {
    const hash = '$2a$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWX0123456';
    const error = Object.assign(new Error(`Invalid prisma.user.upsert() invocation: data: { password: "${hash}" }`), { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['slug'] } });
    const line = seed.safeErrorLine(error);
    expect(line).toContain('P2002');
    expect(line).toContain('slug');
    expect(line).not.toContain(hash);
    expect(line).not.toContain('password');
  });

  it('plans: five plans, AI on every plan, Enterprise never gets a Stripe Price ID, price IDs come from the environment only', () => {
    const none = seed.buildPlans({});
    expect(none.map((p: { name: string }) => p.name)).toEqual(['free', 'starter', 'pro', 'business', 'enterprise']);
    expect(none.every((p: { aiAssistant: boolean }) => p.aiAssistant)).toBe(true);
    expect(none.every((p: { stripePriceIdMonthly: string | null }) => p.stripePriceIdMonthly === null)).toBe(true);
    const withEnv = seed.buildPlans({ STRIPE_PRICE_ID_PRO_MONTHLY: 'price_from_env', STRIPE_PRICE_ID_STARTER_MONTHLY: 'price_s' });
    expect(withEnv.find((p: { name: string }) => p.name === 'pro').stripePriceIdMonthly).toBe('price_from_env');
    expect(withEnv.find((p: { name: string }) => p.name === 'enterprise').stripePriceIdMonthly).toBeNull();
    expect(seedSource).not.toMatch(/stripePriceId\w*:\s*['"]price_/);
  });
});

describe('prisma/seed.js — fail-closed target (real child process, no database reachable in any case)', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['no DB variable at all', {}],
    ['Supabase pooler URL', { DATABASE_URL: SUPABASE_URL, DIRECT_URL: SUPABASE_URL }],
    ['a production-looking host', { DATABASE_URL: 'postgresql://u:p@prod-db.adksy.org:5432/app', DIRECT_URL: 'postgresql://u:p@prod-db.adksy.org:5432/app' }],
    ['the default port 5432 on localhost', { DATABASE_URL: OK_URL.replace(':5433', ':5432'), DIRECT_URL: OK_URL.replace(':5433', ':5432') }],
    ['another database name', { DATABASE_URL: OK_URL.replace('/adksy_r3c_test?', '/other?'), DIRECT_URL: OK_URL.replace('/adksy_r3c_test?', '/other?') }],
    ['only DATABASE_URL', { DATABASE_URL: OK_URL }],
    ['contradictory URLs', { DATABASE_URL: OK_URL, DIRECT_URL: SUPABASE_URL }],
    ['external credentials present', { DATABASE_URL: OK_URL, DIRECT_URL: OK_URL, SUPABASE_SERVICE_ROLE_KEY: 'x' }],
    ['a redirecting URL parameter', { DATABASE_URL: `${OK_URL}&host=db.example.com`, DIRECT_URL: OK_URL }],
  ];

  it.each(cases)('%s -> refused (exit 2) before any client or connection, no secret in the output', (_name, env) => {
    const r = runSeed(['--dry-run'], env);
    expect(r.code).toBe(2);
    expect(r.out).toContain('REFUSED');
    for (const leaked of ['Sup4-secret-pw', 'supabase.com', 'abcdefghijklmnop', 'unit-test-not-a-real-secret', 'postgresql://']) {
      expect(r.out.includes(leaked), `output must not contain ${leaked}`).toBe(false);
    }
  });

  it('the authorized target passes the guard in dry-run mode: nothing is written and no password is printed', () => {
    const r = runSeed(['--dry-run'], { DATABASE_URL: OK_URL, DIRECT_URL: OK_URL, ADKSY_DEMO_USER_PASSWORD: 'a-very-long-demo-pass' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('Dry run');
    expect(r.out).toContain('127.0.0.1:5433 / adksy_r3c_test');
    expect(r.out).not.toContain('a-very-long-demo-pass');
    expect(r.out).not.toContain('unit-test-not-a-real-secret');
  });

  it('a too-short demo password is refused before anything else, without being echoed', () => {
    const r = runSeed(['--dry-run'], { DATABASE_URL: OK_URL, DIRECT_URL: OK_URL, ADKSY_DEMO_USER_PASSWORD: 'tooshort1' });
    expect(r.code).toBe(2);
    expect(r.out).not.toContain('tooshort1');
  });

  it('unknown arguments are refused', () => {
    const r = runSeed(['--force'], { DATABASE_URL: OK_URL, DIRECT_URL: OK_URL });
    expect(r.code).toBe(2);
    expect(r.out).toContain('argument not accepted');
  });

  it('an env file (prisma/.env) carrying a remote target refuses the seed even with a conforming environment', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'adksy-seed-'));
    temps.push(root);
    mkdirSync(path.join(root, 'prisma'), { recursive: true });
    mkdirSync(path.join(root, 'src/lib/testing'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'src/lib/testing/dbSafetyGuard.ts'), path.join(root, 'src/lib/testing/dbSafetyGuard.ts'));
    writeFileSync(path.join(root, 'prisma/.env'), `DATABASE_URL=${SUPABASE_URL}\n`);
    await expect(seed.assertSafeSeedTarget({ DATABASE_URL: OK_URL, DIRECT_URL: OK_URL }, root)).rejects.toThrow(/ENV_FILE_TARGET_NOT_ALLOWED/);
  });

  it('if the guard cannot be loaded the seed refuses instead of continuing unguarded', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'adksy-seed-noguard-'));
    temps.push(empty);
    await expect(seed.assertSafeSeedTarget({ DATABASE_URL: OK_URL, DIRECT_URL: OK_URL }, empty)).rejects.toThrow(/could not be loaded/);
  });

  it('npm run db:seed goes through the guarded wrapper and needs the explicit confirmation', () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(scripts['db:seed']).toBe('node scripts/db/guarded-prisma.mjs seed');
    expect(scripts['db:seed']).not.toMatch(/prisma\/seed\.js/);
  });
});

// prisma/seed-plans-production.js target confirmation: see seed-plans-target.test.ts

describe('scripts/fetch-etsy-taxonomy.ts — reviewed, no change required', () => {
  const source = readFileSync(path.join(ROOT, 'scripts/fetch-etsy-taxonomy.ts'), 'utf8');
  it('only upserts the global EtsyTaxonomyNode reference table: no delete, no tenant data, no credential in the source', () => {
    expect(source).toContain('etsyTaxonomyNode.upsert');
    for (const forbidden of ['deleteMany', '.delete(', 'workspace', 'user.', 'executeRaw']) expect(source).not.toContain(forbidden);
    expect(source).not.toMatch(/x-api-key['"]?\s*:\s*['"][A-Za-z0-9]{8,}/);
  });
});
