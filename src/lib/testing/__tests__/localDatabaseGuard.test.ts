/**
 * Unit tests for the local-database guard used by the real PostgreSQL
 * stock-reservation integration suite. Pure-function tests only — no
 * Docker, no PrismaClient, no real database, no network. Synthetic env
 * objects are passed explicitly; process.env itself is never read or
 * mutated here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  checkLocalTestDatabaseUrl,
  checkIntegrationDatabaseEnv,
  assertIntegrationDatabaseEnv,
  EXPECTED_LOCAL_TEST_DB,
} from '@/lib/testing/localDatabaseGuard';

const VALID_URL = `postgresql://test:test@localhost:${EXPECTED_LOCAL_TEST_DB.port}/${EXPECTED_LOCAL_TEST_DB.database}`;

describe('checkLocalTestDatabaseUrl — accepted local forms', () => {
  it('accepts localhost with the expected port and database', () => {
    expect(checkLocalTestDatabaseUrl(VALID_URL)).toEqual({ ok: true });
  });

  it('accepts 127.0.0.1', () => {
    const url = `postgresql://test:test@127.0.0.1:${EXPECTED_LOCAL_TEST_DB.port}/${EXPECTED_LOCAL_TEST_DB.database}`;
    expect(checkLocalTestDatabaseUrl(url)).toEqual({ ok: true });
  });

  it('accepts the IPv6 loopback literal [::1]', () => {
    const url = `postgresql://test:test@[::1]:${EXPECTED_LOCAL_TEST_DB.port}/${EXPECTED_LOCAL_TEST_DB.database}`;
    expect(checkLocalTestDatabaseUrl(url)).toEqual({ ok: true });
  });

  it('accepts the postgres:// scheme alias', () => {
    const url = `postgres://test:test@localhost:${EXPECTED_LOCAL_TEST_DB.port}/${EXPECTED_LOCAL_TEST_DB.database}`;
    expect(checkLocalTestDatabaseUrl(url)).toEqual({ ok: true });
  });
});

describe('checkLocalTestDatabaseUrl — rejected inputs', () => {
  it('rejects a missing value', () => {
    expect(checkLocalTestDatabaseUrl(undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(checkLocalTestDatabaseUrl(null)).toEqual({ ok: false, reason: 'missing' });
    expect(checkLocalTestDatabaseUrl('')).toEqual({ ok: false, reason: 'missing' });
    expect(checkLocalTestDatabaseUrl('   ')).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a malformed URL', () => {
    const result = checkLocalTestDatabaseUrl('not a url at all');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/malformed/);
  });

  it('rejects a genuinely remote host', () => {
    const result = checkLocalTestDatabaseUrl(
      `postgresql://user:pass@db.supabase.co:${EXPECTED_LOCAL_TEST_DB.port}/${EXPECTED_LOCAL_TEST_DB.database}`
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not localhost/);
  });

  it('rejects credentials crafted to contain "@localhost" before the real remote host (the substring-match bypass this guard replaces)', () => {
    // new URL() resolves the host as whatever follows the LAST unescaped
    // "@" — here that's evil.example.com, not localhost. A naive
    // substring/regex check on the raw string would have wrongly matched
    // "@localhost:" and accepted this as local.
    const trick = `postgresql://user:p@localhost@evil.example.com:${EXPECTED_LOCAL_TEST_DB.port}/${EXPECTED_LOCAL_TEST_DB.database}`;
    const result = checkLocalTestDatabaseUrl(trick);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not localhost/);
    // The rejection reason must never leak the raw URL/credentials.
    expect(result.reason).not.toContain('evil.example.com');
    expect(result.reason).not.toContain('localhost@');
  });

  it('rejects a local host without an explicit port (no silent default-port fallback)', () => {
    const result = checkLocalTestDatabaseUrl(`postgresql://test:test@localhost/${EXPECTED_LOCAL_TEST_DB.database}`);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/port/);
  });

  it('rejects a local host on the wrong port', () => {
    const result = checkLocalTestDatabaseUrl(`postgresql://test:test@localhost:5432/${EXPECTED_LOCAL_TEST_DB.database}`);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/port/);
  });

  it('rejects a local host with the wrong database name', () => {
    const result = checkLocalTestDatabaseUrl(`postgresql://test:test@localhost:${EXPECTED_LOCAL_TEST_DB.port}/some_other_db`);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/database name/);
  });

  it('rejects a non-Postgres protocol', () => {
    const result = checkLocalTestDatabaseUrl(`mysql://test:test@localhost:${EXPECTED_LOCAL_TEST_DB.port}/${EXPECTED_LOCAL_TEST_DB.database}`);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/protocol/);
  });

  it('never includes the raw URL value in a rejection reason', () => {
    const secretUrl = `postgresql://realuser:s3cr3t-password@db.supabase.co:5432/production`;
    const result = checkLocalTestDatabaseUrl(secretUrl);
    expect(result.ok).toBe(false);
    expect(result.reason).not.toContain('s3cr3t-password');
    expect(result.reason).not.toContain('realuser');
    expect(result.reason).not.toContain('db.supabase.co');
  });
});

describe('checkIntegrationDatabaseEnv — both variables checked independently', () => {
  it('passes when both DATABASE_URL and DIRECT_URL are the expected local URL', () => {
    const result = checkIntegrationDatabaseEnv({ DATABASE_URL: VALID_URL, DIRECT_URL: VALID_URL });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('fails and names DIRECT_URL when it is missing even though DATABASE_URL is valid', () => {
    const result = checkIntegrationDatabaseEnv({ DATABASE_URL: VALID_URL });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ variable: 'DIRECT_URL', reason: 'missing' }]);
  });

  it('fails and names DATABASE_URL when it is remote even though DIRECT_URL is valid (the stale-ambient-variable scenario)', () => {
    const result = checkIntegrationDatabaseEnv({
      DATABASE_URL: 'postgresql://user:pass@db.supabase.co:5432/real_production_db',
      DIRECT_URL: VALID_URL,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].variable).toBe('DATABASE_URL');
  });

  it('fails and names both when they disagree with each other and with the expected target', () => {
    const result = checkIntegrationDatabaseEnv({
      DATABASE_URL: VALID_URL,
      DIRECT_URL: `postgresql://test:test@localhost:5432/${EXPECTED_LOCAL_TEST_DB.database}`, // wrong port
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ variable: 'DIRECT_URL', reason: expect.stringMatching(/port/) }]);
  });

  it('fails when neither variable is set', () => {
    const result = checkIntegrationDatabaseEnv({});
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { variable: 'DATABASE_URL', reason: 'missing' },
      { variable: 'DIRECT_URL', reason: 'missing' },
    ]);
  });
});

describe('assertIntegrationDatabaseEnv — fail-fast behavior', () => {
  it('does not throw for a valid local pair', () => {
    expect(() => assertIntegrationDatabaseEnv({ DATABASE_URL: VALID_URL, DIRECT_URL: VALID_URL })).not.toThrow();
  });

  it('throws synchronously for an invalid pair, before any async/DB work could happen', () => {
    expect(() => assertIntegrationDatabaseEnv({})).toThrow(/Refusing to run/);
  });

  it('throws with a message naming the failing variables but never a secret value', () => {
    try {
      assertIntegrationDatabaseEnv({
        DATABASE_URL: 'postgresql://realuser:s3cr3t@db.supabase.co:5432/production',
        DIRECT_URL: undefined,
      });
      throw new Error('expected assertIntegrationDatabaseEnv to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/DATABASE_URL/);
      expect(message).toMatch(/DIRECT_URL/);
      expect(message).not.toContain('s3cr3t');
      expect(message).not.toContain('realuser');
      expect(message).not.toContain('db.supabase.co');
    }
  });
});

describe('vitest.integration.config.ts — no .env loading, no silent override', () => {
  it('does not load dotenv/.env files or reassign process.env', () => {
    const configPath = path.join(process.cwd(), 'vitest.integration.config.ts');
    const source = fs.readFileSync(configPath, 'utf-8');
    // Strip line comments first: the file's own explanatory comments
    // mention "loadEnv"/"dotenv" by name to say they're deliberately
    // absent, which would otherwise make this check match its own
    // explanation instead of real code.
    const codeOnly = source
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');

    expect(codeOnly).not.toMatch(/loadEnv/);
    expect(codeOnly).not.toMatch(/dotenv/);
    expect(codeOnly).not.toMatch(/Object\.assign\(\s*process\.env/);
  });
});
