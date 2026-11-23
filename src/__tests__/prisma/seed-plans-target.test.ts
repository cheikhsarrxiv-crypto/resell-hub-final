/**
 * R4/R5 follow-up — prisma/seed-plans-production.js writes only when the WHOLE target
 * (host + port + database name) equals what the operator explicitly named.
 * No test here contacts a database: refusals are checked with an injected client that must
 * never be created, and the write path with an in-memory fake.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = path.resolve(__dirname, '../../..');
const seed = require(path.join(ROOT, 'prisma/seed-plans-production.js'));
const source = readFileSync(path.join(ROOT, 'prisma/seed-plans-production.js'), 'utf8');

const URL_OK = 'postgresql://app_user:Sup3r-Secret-pw@db.example.test:5432/appdb?sslmode=require';
const EXPECTED = {
  PLAN_SEED_EXPECTED_DB_HOST: 'db.example.test',
  PLAN_SEED_EXPECTED_DB_PORT: '5432',
  PLAN_SEED_EXPECTED_DB_NAME: 'appdb',
};
const env = (over: Record<string, string | undefined> = {}) =>
  ({ DATABASE_URL: URL_OK, ALLOW_PRODUCTION_PLAN_SEED: 'true', ...EXPECTED, ...over }) as Record<string, string | undefined>;
type Io = { root: string; exists: (p: string) => boolean; read: (p: string) => string };
const noFiles: Io = { root: '/virtual', exists: () => false, read: () => '' };
const withFiles = (files: Record<string, string>) => ({
  root: '/virtual',
  exists: (p: string) => p.replace('/virtual/', '') in files,
  read: (p: string) => files[p.replace('/virtual/', '')],
});

function fakePrisma() {
  const calls: string[] = [];
  const client = {
    plan: {
      findMany: async () => (calls.push('read'), []),
      upsert: (a: unknown) => (calls.push('upsert'), a),
    },
    $transaction: async (ops: unknown[]) => (calls.push(`transaction:${ops.length}`), ops),
    $disconnect: async () => void calls.push('disconnect'),
  };
  return { calls, client };
}

async function run(e: Record<string, string | undefined>, io: Io = noFiles, argv = ['node', 'seed']) {
  const { calls, client } = fakePrisma();
  const out: string[] = [];
  const errs: string[] = [];
  let created = 0;
  const code = await seed.main({
    env: e, argv, io,
    createClient: () => (created++, client),
    log: (...a: unknown[]) => out.push(a.join(' ')),
    logError: (...a: unknown[]) => errs.push(a.join(' ')),
  });
  return { code, calls, out: out.join('\n'), errs: errs.join('\n'), created };
}

const refusedCleanly = (r: Awaited<ReturnType<typeof run>>) => {
  expect(r.code).toBe(2);
  expect(r.errs).toContain('REFUSED');
  expect(r.created).toBe(0); // no client at all
  expect(r.calls).toEqual([]); // no read, no write
  for (const leaked of ['Sup3r-Secret-pw', 'app_user', 'postgresql://', 'sslmode']) {
    expect(`${r.out}\n${r.errs}`.includes(leaked), `must not leak ${leaked}`).toBe(false);
  }
};

describe('1. the right, explicitly expected target', () => {
  it('is accepted and written in a single transaction of 5 upserts', async () => {
    const r = await run(env());
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(['read', 'upsert', 'upsert', 'upsert', 'upsert', 'upsert', 'transaction:5', 'disconnect']);
    expect(r.out).toContain('db.example.test / 5432 / appdb');
  });

  it('prints only a non-sensitive target (no user, password, parameters or URI)', async () => {
    const r = await run(env());
    for (const leaked of ['Sup3r-Secret-pw', 'app_user', 'postgresql://', 'sslmode', URL_OK]) expect(r.out).not.toContain(leaked);
  });

  it('is case-insensitive on the host and treats an absent URL port as 5432', () => {
    const e = env({ DATABASE_URL: 'postgresql://u:p@DB.Example.Test/appdb', PLAN_SEED_EXPECTED_DB_HOST: 'DB.EXAMPLE.TEST' });
    expect(seed.checkExpectedTarget(e, noFiles).ok).toBe(true);
  });

  it('a DIRECT_URL describing the same target is accepted', () => {
    const e = env({ DIRECT_URL: 'postgresql://other_user:p2@db.example.test:5432/appdb' });
    expect(seed.checkExpectedTarget(e, noFiles).ok).toBe(true);
  });

  it('a harmless env file for the same target is accepted', () => {
    const io = withFiles({ '.env': `DATABASE_URL="${URL_OK}"\n# comment\nOTHER=1\n` });
    expect(seed.checkExpectedTarget(env(), io).ok).toBe(true);
  });
});

describe('2-4. any single difference in host, port or database name refuses', () => {
  it('different host', async () => refusedCleanly(await run(env({ PLAN_SEED_EXPECTED_DB_HOST: 'db.other.test' }))));
  it('different port', async () => refusedCleanly(await run(env({ PLAN_SEED_EXPECTED_DB_PORT: '6543' }))));
  it('different database name on the SAME host (the case a hostname-only check misses)', async () => {
    const r = await run(env({ PLAN_SEED_EXPECTED_DB_NAME: 'other_db' }));
    refusedCleanly(r);
    expect(r.errs).toContain('database');
  });
  it('the URL names the other database on the expected host', async () => {
    refusedCleanly(await run(env({ DATABASE_URL: 'postgresql://app_user:Sup3r-Secret-pw@db.example.test:5432/production' })));
  });
  it('the refusal says which part differs, never the values', () => {
    const r = seed.checkExpectedTarget(env({ PLAN_SEED_EXPECTED_DB_HOST: 'x.test', PLAN_SEED_EXPECTED_DB_PORT: '1' }), noFiles);
    expect(r.reason).toContain('host, port');
    expect(r.reason).not.toMatch(/db\.example\.test|appdb/);
  });
});

describe('5. missing variables', () => {
  for (const name of Object.keys(EXPECTED)) {
    it(`without ${name}`, async () => refusedCleanly(await run(env({ [name]: undefined }))));
    it(`with an empty/blank ${name}`, async () => refusedCleanly(await run(env({ [name]: '   ' }))));
  }
  it('without any expected value (only the opt-in flag, the old minimal setup)', async () => {
    refusedCleanly(await run({ DATABASE_URL: URL_OK, ALLOW_PRODUCTION_PLAN_SEED: 'true' }));
  });
  it('without DATABASE_URL', async () => refusedCleanly(await run(env({ DATABASE_URL: undefined }))));
  it('with an invalid expected port', async () => {
    for (const bad of ['abc', '0', '70000', '-1', '54 32']) refusedCleanly(await run(env({ PLAN_SEED_EXPECTED_DB_PORT: bad })));
  });
  it('the legacy host-only configuration no longer authorises a write', () => {
    expect(seed.checkExpectedTarget({ DATABASE_URL: URL_OK, PLAN_SEED_EXPECTED_DB_HOST: 'db.example.test' }, noFiles).ok).toBe(false);
  });
});

describe('6. ambiguous URL', () => {
  const ambiguous: Array<[string, string]> = [
    ['host= override', `${URL_OK}&host=evil.example.test`],
    ['hostaddr= override', `${URL_OK}&hostaddr=203.0.113.9`],
    ['port= override', `${URL_OK}&port=6543`],
    ['dbname= override', `${URL_OK}&dbname=production`],
    ['options= override', `${URL_OK}&options=-c%20search_path%3Dpublic`],
    ['service= file', `${URL_OK}&service=prod`],
    ['uppercase parameter', `${URL_OK}&HOST=evil.example.test`],
    ['several hosts', 'postgresql://u:p@db.example.test:5432,evil.example.test:5432/appdb'],
    ['no database', 'postgresql://u:p@db.example.test:5432/'],
    ['no host (socket)', 'postgresql:///appdb?host=/var/run/postgresql'],
    ['not postgres', 'mysql://u:p@db.example.test:5432/appdb'],
    ['malformed', 'not a url'],
  ];
  it.each(ambiguous)('%s -> refused, nothing created, no leak', async (_n, url) => {
    refusedCleanly(await run(env({ DATABASE_URL: url })));
  });
  it('harmless parameters (sslmode, schema, pgbouncer, connection_limit) stay allowed', () => {
    const e = env({ DATABASE_URL: `${URL_OK}&schema=public&pgbouncer=true&connection_limit=1` });
    expect(seed.checkExpectedTarget(e, noFiles).ok).toBe(true);
  });
});

describe('7. alternative or contradictory URL', () => {
  const direct: Array<[string, string]> = [
    ['another host', 'postgresql://u:p@db.other.test:5432/appdb'],
    ['another port', 'postgresql://u:p@db.example.test:6543/appdb'],
    ['another database', 'postgresql://u:p@db.example.test:5432/other'],
    ['ambiguous', 'postgresql://u:p@db.example.test:5432/appdb?host=evil.test'],
    ['malformed', '::::'],
  ];
  it.each(direct)('DIRECT_URL with %s -> refused', async (_n, url) => {
    refusedCleanly(await run(env({ DIRECT_URL: url })));
  });
  it('a blank DIRECT_URL is ignored (it is not a second target)', () => {
    expect(seed.checkExpectedTarget(env({ DIRECT_URL: '  ' }), noFiles).ok).toBe(true);
  });
});

describe('8. dangerous .env files', () => {
  const files: Array<[string, Record<string, string>]> = [
    ['.env with another host', { '.env': 'DATABASE_URL=postgresql://u:p@evil.example.test:5432/appdb' }],
    ['prisma/.env with another database', { 'prisma/.env': 'DATABASE_URL="postgresql://u:p@db.example.test:5432/production"' }],
    ['.env.production with another port', { '.env.production': 'DIRECT_URL=postgresql://u:p@db.example.test:6543/appdb' }],
    ['.env.local ambiguous', { '.env.local': `DATABASE_URL=${URL_OK}&host=evil.test` }],
    ['exported assignment', { '.env': 'export DATABASE_URL=postgresql://u:p@evil.example.test:5432/appdb' }],
    ['later assignment wins', { '.env': `DATABASE_URL=${URL_OK}\nDATABASE_URL=postgresql://u:p@evil.example.test:5432/appdb` }],
    ['unparseable value', { '.env': 'DATABASE_URL=%%%' }],
  ];
  it.each(files)('%s -> refused, only the file name is reported', async (_n, f) => {
    const r = await run(env(), withFiles(f));
    refusedCleanly(r);
    expect(r.errs).toMatch(/env file \S*\.env\S* defines/);
    expect(r.errs).not.toContain('evil.example.test');
  });
  it('the list of inspected files covers what Prisma and dotenv can load', () => {
    for (const f of ['.env', '.env.local', '.env.production', 'prisma/.env']) expect(seed.ENV_FILE_CANDIDATES).toContain(f);
  });
  it('the real project root is scanned by default when main() runs unconfigured (no .env with another target is present)', () => {
    expect(source).toMatch(/root:\s*require\('path'\)\.resolve\(__dirname, '\.\.'\)/);
  });
});

describe('9. the guard itself fails', () => {
  it('an exception while reading an env file refuses (fail-closed), without leaking', async () => {
    const io = { root: '/virtual', exists: () => true, read: () => { throw new Error(`EACCES ${URL_OK}`); } };
    const r = await run(env(), io);
    refusedCleanly(r);
    expect(r.errs).toContain('failed internally');
  });
  it('an unexpected env shape (non-string values) refuses rather than crashing or allowing', () => {
    const weird = { ...env(), DATABASE_URL: { toString() { throw new Error('boom'); } } } as unknown as Record<string, string>;
    expect(seed.checkExpectedTarget(weird, noFiles).ok).toBe(false);
  });
  it('a null/undefined env never authorises a write', () => {
    expect(seed.checkExpectedTarget({} as never, noFiles).ok).toBe(false);
  });
});

describe('10. no write when the check fails; unaffected modes still work', () => {
  it('a refused run performs no read and no write and creates no client', async () => {
    for (const bad of [{ PLAN_SEED_EXPECTED_DB_NAME: 'other' }, { PLAN_SEED_EXPECTED_DB_PORT: undefined }, { DATABASE_URL: `${URL_OK}&host=x.test` }]) {
      const r = await run(env(bad));
      expect(r.calls.filter((c) => c === 'upsert' || c.startsWith('transaction'))).toEqual([]);
      refusedCleanly(r);
    }
  });
  it('dry-run never writes even with a perfect target, and needs no expected variables', async () => {
    const perfect = await run(env(), noFiles, ['node', 'seed', '--dry-run']);
    expect(perfect.code).toBe(0);
    expect(perfect.calls).toEqual(['read', 'disconnect']);
    const bare = await run({ DATABASE_URL: URL_OK }, noFiles, ['node', 'seed', '--dry-run']);
    expect(bare.code).toBe(0);
    expect(bare.calls).toEqual(['read', 'disconnect']);
  });
  it('without the opt-in flag nothing is written, whatever the target variables say', async () => {
    const r = await run(env({ ALLOW_PRODUCTION_PLAN_SEED: undefined }));
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(['read', 'disconnect']);
    const wrong = await run(env({ ALLOW_PRODUCTION_PLAN_SEED: 'TRUE' }));
    expect(wrong.calls).toEqual(['read', 'disconnect']);
  });
  it('a failing transaction surfaces and still disconnects (no partial plan set)', async () => {
    const { client, calls } = fakePrisma();
    client.$transaction = async () => { throw new Error('rollback'); };
    await expect(seed.main({ env: env(), argv: ['node', 'seed'], io: noFiles, createClient: () => client, log: () => {}, logError: () => {} })).rejects.toThrow('rollback');
    expect(calls.at(-1)).toBe('disconnect');
  });
  it('no expected value is hardcoded in the script, and the entry point never prints a raw error', () => {
    expect(source).not.toMatch(/db\.example|supabase|adksy\.org|pooler/i);
    expect(source).not.toMatch(/process\.env\.PLAN_SEED_EXPECTED_DB_(HOST|PORT|NAME)\s*(\|\||\?\?)\s*['"]/);
    expect(source).not.toMatch(/console\.error\(e\)/);
  });
});

describe('real script behaviour (child process; refusals happen before any client or connection)', () => {
  const runReal = (extra: Record<string, string>) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'prisma/seed-plans-production.js')], {
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...extra } as unknown as NodeJS.ProcessEnv,
      cwd: tmpdir(), encoding: 'utf8', timeout: 60_000,
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  it('a write run with a mismatching database name exits 2, prints only the safe target, leaks nothing', () => {
    const r = runReal({ DATABASE_URL: URL_OK, ALLOW_PRODUCTION_PLAN_SEED: 'true', ...EXPECTED, PLAN_SEED_EXPECTED_DB_NAME: 'other' });
    expect(r.code).toBe(2);
    expect(r.out).toContain('db.example.test / 5432 / appdb');
    expect(r.out).toContain('REFUSED');
    for (const leaked of ['Sup3r-Secret-pw', 'app_user', 'postgresql://', 'sslmode']) expect(r.out).not.toContain(leaked);
  });
  it('a write run with only the opt-in flag exits 2 as well', () => {
    expect(runReal({ DATABASE_URL: URL_OK, ALLOW_PRODUCTION_PLAN_SEED: 'true' }).code).toBe(2);
  });
});
