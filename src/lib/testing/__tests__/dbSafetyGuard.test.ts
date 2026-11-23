/**
 * R3-C.2.1 — the DB safety guard accepts exactly one target and refuses
 * everything else. Pure unit test: no DB, no network, no environment reads
 * (every case passes its own environment object).
 */
import { describe, it, expect } from 'vitest';
import {
  R3C_ALLOWED_TARGET,
  EXTERNAL_CREDENTIAL_VARS,
  DbSafetyError,
  assertRuntimeIdentity,
  assertSafeTestDatabase,
  enforceGuardForTestRun,
  evaluateTestDatabaseEnv,
} from '../dbSafetyGuard';

// A syntactically valid password that is NOT a real credential.
const FAKE_PW = 'unit-test-not-a-real-secret';
const good = `postgresql://adksy_r3c_test:${FAKE_PW}@localhost:5433/adksy_r3c_test?schema=public`;
const withDb = (db: string) => `postgresql://adksy_r3c_test:${FAKE_PW}@localhost:5433/${db}?schema=public`;
const env = (over: Record<string, string | undefined> = {}) => ({ DATABASE_URL: good, DIRECT_URL: good, ...over });

function reasonsOf(e: Record<string, string | undefined>) {
  const r = evaluateTestDatabaseEnv(e);
  return r.ok ? [] : r.reasons;
}

describe('allowed target', () => {
  it('accepts the dedicated local R3-C database on 5433 (localhost)', () => {
    const r = evaluateTestDatabaseEnv(env());
    expect(r).toEqual({
      ok: true,
      target: { host: 'localhost', port: '5433', database: 'adksy_r3c_test', user: 'adksy_r3c_test' },
    });
  });

  it('accepts 127.0.0.1, with or without the schema parameter, and a percent-encoded password', () => {
    const u = `postgresql://adksy_r3c_test:p%40ss%2Fword@127.0.0.1:5433/adksy_r3c_test`;
    expect(evaluateTestDatabaseEnv({ DATABASE_URL: u, DIRECT_URL: u }).ok).toBe(true);
  });

  it('accepts the postgres:// scheme and the harmless pool parameters', () => {
    const u = `postgres://adksy_r3c_test:${FAKE_PW}@localhost:5433/adksy_r3c_test?schema=public&connection_limit=3&pool_timeout=10&connect_timeout=5&sslmode=prefer`;
    expect(evaluateTestDatabaseEnv({ DATABASE_URL: u, DIRECT_URL: u }).ok).toBe(true);
  });

  it('assertSafeTestDatabase returns the parsed target without credentials', () => {
    const target = assertSafeTestDatabase(env());
    expect(Object.keys(target).sort()).toEqual(['database', 'host', 'port', 'user']);
    expect(JSON.stringify(target)).not.toContain(FAKE_PW);
  });

  it('exposes exactly the approved target constants', () => {
    expect(R3C_ALLOWED_TARGET.port).toBe('5433');
    expect(R3C_ALLOWED_TARGET.database).toBe('adksy_r3c_test');
    expect(R3C_ALLOWED_TARGET.user).toBe('adksy_r3c_test');
    expect([...R3C_ALLOWED_TARGET.hosts]).toEqual(['localhost', '127.0.0.1']);
  });
});

describe('refused targets', () => {
  const cases: Array<[string, Record<string, string | undefined>, string]> = [
    ['DATABASE_URL absent', env({ DATABASE_URL: undefined }), 'DATABASE_URL_MISSING'],
    ['DIRECT_URL absent', env({ DIRECT_URL: undefined }), 'DIRECT_URL_MISSING'],
    ['DATABASE_URL empty', env({ DATABASE_URL: '   ' }), 'DATABASE_URL_MISSING'],
    ['both absent', {}, 'DATABASE_URL_MISSING'],
    ['a remote host', env({ DATABASE_URL: good.replace('localhost', 'db.example.com'), DIRECT_URL: good.replace('localhost', 'db.example.com') }), 'HOST_NOT_ALLOWED'],
    ['a Supabase direct host', env({ DATABASE_URL: `postgresql://adksy_r3c_test:${FAKE_PW}@db.abcdefghijklmnop.supabase.co:5433/adksy_r3c_test`, DIRECT_URL: `postgresql://adksy_r3c_test:${FAKE_PW}@db.abcdefghijklmnop.supabase.co:5433/adksy_r3c_test` }), 'HOST_NOT_ALLOWED'],
    ['a Supabase pooler host', env({ DATABASE_URL: `postgresql://postgres.abcdefghijklmnop:${FAKE_PW}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true`, DIRECT_URL: `postgresql://postgres:${FAKE_PW}@db.abcdefghijklmnop.supabase.co:5432/postgres` }), 'HOST_NOT_ALLOWED'],
    ['a production-looking host', env({ DATABASE_URL: `postgresql://adksy_r3c_test:${FAKE_PW}@prod-db.adksy.org:5433/adksy_r3c_test`, DIRECT_URL: `postgresql://adksy_r3c_test:${FAKE_PW}@prod-db.adksy.org:5433/adksy_r3c_test` }), 'HOST_NOT_ALLOWED'],
    ['a LAN address', env({ DATABASE_URL: good.replace('localhost', '192.168.1.20'), DIRECT_URL: good.replace('localhost', '192.168.1.20') }), 'HOST_NOT_ALLOWED'],
    ['0.0.0.0', env({ DATABASE_URL: good.replace('localhost', '0.0.0.0'), DIRECT_URL: good.replace('localhost', '0.0.0.0') }), 'HOST_NOT_ALLOWED'],
    ['a look-alike host (localhost.evil.example)', env({ DATABASE_URL: good.replace('localhost', 'localhost.evil.example'), DIRECT_URL: good.replace('localhost', 'localhost.evil.example') }), 'HOST_NOT_ALLOWED'],
    ['credentials trick (user@evil host)', env({ DATABASE_URL: `postgresql://adksy_r3c_test:pw@evil.example:5433/adksy_r3c_test@localhost`, DIRECT_URL: good }), 'HOST_NOT_ALLOWED'],
    ['the default port 5432', env({ DATABASE_URL: good.replace(':5433', ':5432'), DIRECT_URL: good.replace(':5433', ':5432') }), 'PORT_NOT_ALLOWED'],
    ['an omitted port', env({ DATABASE_URL: good.replace(':5433', ''), DIRECT_URL: good.replace(':5433', '') }), 'PORT_NOT_ALLOWED'],
    ['another port', env({ DATABASE_URL: good.replace(':5433', ':5434'), DIRECT_URL: good.replace(':5433', ':5434') }), 'PORT_NOT_ALLOWED'],
    ['an unknown database', env({ DATABASE_URL: withDb('adksy_other'), DIRECT_URL: withDb('adksy_other') }), 'DATABASE_NOT_ALLOWED'],
    ['the postgres database', env({ DATABASE_URL: withDb('postgres'), DIRECT_URL: withDb('postgres') }), 'DATABASE_NOT_ALLOWED'],
    ['a database that merely contains "test"', env({ DATABASE_URL: withDb('my_test_db'), DIRECT_URL: withDb('my_test_db') }), 'DATABASE_NOT_ALLOWED'],
    ['a different role', env({ DATABASE_URL: good.replace('//adksy_r3c_test:', '//postgres:'), DIRECT_URL: good.replace('//adksy_r3c_test:', '//postgres:') }), 'USER_NOT_ALLOWED'],
    ['a missing password', env({ DATABASE_URL: `postgresql://adksy_r3c_test@localhost:5433/adksy_r3c_test`, DIRECT_URL: `postgresql://adksy_r3c_test@localhost:5433/adksy_r3c_test` }), 'PASSWORD_MISSING'],
    ['a non-postgres scheme', env({ DATABASE_URL: good.replace('postgresql:', 'mysql:'), DIRECT_URL: good.replace('postgresql:', 'mysql:') }), 'PROTOCOL_NOT_POSTGRES'],
    ['a malformed URL', env({ DATABASE_URL: 'not a url', DIRECT_URL: 'not a url' }), 'URL_MALFORMED'],
    ['a multi-host URL', env({ DATABASE_URL: `postgresql://adksy_r3c_test:${FAKE_PW}@localhost:5433,remote.example:5433/adksy_r3c_test`, DIRECT_URL: good }), 'URL_MALFORMED'],
    ['a host override parameter', env({ DATABASE_URL: `${good}&host=db.example.com`, DIRECT_URL: good }), 'QUERY_PARAM_NOT_ALLOWED'],
    ['a hostaddr override parameter', env({ DATABASE_URL: `${good}&hostaddr=10.0.0.5`, DIRECT_URL: good }), 'QUERY_PARAM_NOT_ALLOWED'],
    ['a dbname override parameter', env({ DATABASE_URL: `${good}&dbname=postgres`, DIRECT_URL: good }), 'QUERY_PARAM_NOT_ALLOWED'],
    ['a socket host parameter', env({ DATABASE_URL: `postgresql://adksy_r3c_test:${FAKE_PW}@localhost:5433/adksy_r3c_test?host=/var/run/postgresql`, DIRECT_URL: good }), 'QUERY_PARAM_NOT_ALLOWED'],
    ['a pgbouncer parameter', env({ DATABASE_URL: `${good}&pgbouncer=true`, DIRECT_URL: good }), 'QUERY_PARAM_NOT_ALLOWED'],
    ['another schema', env({ DATABASE_URL: good.replace('schema=public', 'schema=other'), DIRECT_URL: good }), 'SCHEMA_NOT_ALLOWED'],
  ];

  it.each(cases)('%s', (_name, e, reason) => {
    const r = evaluateTestDatabaseEnv(e);
    expect(r.ok).toBe(false);
    expect(reasonsOf(e)).toContain(reason);
    expect(() => assertSafeTestDatabase(e)).toThrow(DbSafetyError);
  });

  it('contradictory parameters: DATABASE_URL and DIRECT_URL describe different targets', () => {
    const other = `postgresql://adksy_r3c_test:${FAKE_PW}@127.0.0.1:5433/adksy_r3c_test`;
    // both individually valid, but not the same host spelling -> must be refused as ambiguous
    expect(reasonsOf({ DATABASE_URL: good, DIRECT_URL: other })).toContain('URLS_DISAGREE');
  });

  it('contradiction between a valid URL and a forbidden one reports the forbidden target', () => {
    const remote = good.replace('localhost', 'db.example.com');
    expect(reasonsOf({ DATABASE_URL: good, DIRECT_URL: remote })).toContain('HOST_NOT_ALLOWED');
  });

  it.each(EXTERNAL_CREDENTIAL_VARS.map((n) => [n]))('refuses when %s is present in the environment', (name) => {
    expect(reasonsOf(env({ [name]: 'present' }))).toContain('EXTERNAL_CREDENTIALS_PRESENT');
  });

  it('a "test"-style environment flag is not proof of safety', () => {
    const remote = good.replace('localhost', 'db.example.com');
    const e = env({ DATABASE_URL: remote, DIRECT_URL: remote, NODE_ENV: 'test', TEST: 'true', IS_TEST: '1', ADKSY_TEST_DB: 'true', VITEST: 'true' });
    expect(evaluateTestDatabaseEnv(e).ok).toBe(false);
  });

  it('empty-string credential variables are not "present"', () => {
    expect(evaluateTestDatabaseEnv(env({ SUPABASE_SERVICE_ROLE_KEY: '' })).ok).toBe(true);
  });
});

describe('error messages never leak connection details', () => {
  const secretish = 'S3cr3t-Pa55word-xyz';
  const evilHost = 'evil-db.supabase.co';
  const evil = `postgresql://leaky_user:${secretish}@${evilHost}:5432/leaky_db?host=${evilHost}`;

  it('the thrown message contains reason codes only', () => {
    let message = '';
    try {
      assertSafeTestDatabase({ DATABASE_URL: evil, DIRECT_URL: evil, SUPABASE_SERVICE_ROLE_KEY: 'key-value-123' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DB safety guard refused');
    expect(message).toContain('HOST_NOT_ALLOWED');
    for (const leaked of [secretish, evilHost, 'leaky_user', 'leaky_db', 'key-value-123', 'postgresql://']) {
      expect(message.includes(leaked), `message must not contain ${leaked}`).toBe(false);
    }
  });

  it('evaluate() results never contain input fragments either', () => {
    const r = evaluateTestDatabaseEnv({ DATABASE_URL: evil, DIRECT_URL: evil });
    expect(JSON.stringify(r).includes(secretish)).toBe(false);
    expect(JSON.stringify(r).includes(evilHost)).toBe(false);
  });
});

describe('enforceGuardForTestRun (the Vitest setup policy)', () => {
  it('no DB variable: nothing can connect, mocked tests run unchanged', () => {
    expect(enforceGuardForTestRun({})).toBe('no-db');
    expect(enforceGuardForTestRun({ DATABASE_URL: '', DIRECT_URL: undefined })).toBe('no-db');
  });

  it('the authorized target: allowed', () => {
    expect(enforceGuardForTestRun(env())).toBe('guarded');
  });

  it('ANY DB variable that is not the authorized target aborts the run', () => {
    expect(() => enforceGuardForTestRun({ DATABASE_URL: good })).toThrow(DbSafetyError); // DIRECT_URL missing
    expect(() => enforceGuardForTestRun({ DIRECT_URL: good })).toThrow(DbSafetyError); // DATABASE_URL missing
    expect(() => enforceGuardForTestRun({ DATABASE_URL: 'postgresql://u:p@db.supabase.co:5432/postgres', DIRECT_URL: 'postgresql://u:p@db.supabase.co:5432/postgres' })).toThrow(DbSafetyError);
  });
});

describe('assertRuntimeIdentity (second layer, after connecting)', () => {
  it('accepts the dedicated cluster identity', () => {
    expect(() => assertRuntimeIdentity({ database: 'adksy_r3c_test', user: 'adksy_r3c_test', port: 5433 })).not.toThrow();
    expect(() => assertRuntimeIdentity({ database: 'adksy_r3c_test', user: 'adksy_r3c_test', port: '5433' })).not.toThrow();
  });

  it.each([
    [{ database: 'postgres', user: 'adksy_r3c_test', port: 5433 }],
    [{ database: 'adksy_r3c_test', user: 'postgres', port: 5433 }],
    [{ database: 'adksy_r3c_test', user: 'adksy_r3c_test', port: 5432 }],
    [{ database: null, user: null, port: null }],
  ])('refuses a mismatching server identity %#', (identity) => {
    expect(() => assertRuntimeIdentity(identity)).toThrow(/RUNTIME_TARGET_MISMATCH/);
  });
});
