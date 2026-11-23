/**
 * R3-C.8 — env FILES and inherited variables can no longer smuggle a database
 * target past the guard. Pure / temp-directory tests: no database, no network;
 * the env files used here are synthetic files created in an OS temp directory.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DbSafetyError,
  ENV_FILE_CANDIDATES,
  assertNoUnsafeEnvFiles,
  enforceGuardForTestRun,
  evaluateEnvFileTexts,
  findDbVarsInEnvText,
  scanProjectEnvFiles,
} from '../dbSafetyGuard';
import { buildGuardedEnv, repoRoot } from '../../../../scripts/db/lib/guardedEnv.mjs';

const FAKE_PW = 'unit-test-not-a-real-secret';
const OK_URL = `postgresql://adksy_r3c_test:${FAKE_PW}@127.0.0.1:5433/adksy_r3c_test?schema=public`;
const SUPABASE_URL = 'postgresql://postgres.abcdefghijklmnop:Sup4-secret-pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
const REMOTE_URL = 'postgresql://app_user:Rem0te-secret-pw@db.example.com:5432/appdb';

const temps: string[] = [];
function tempRoot(files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'adksy-c8-'));
  temps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}
function fakeCredentials(): string {
  const root = tempRoot({ 'pgpass': `127.0.0.1:5433:adksy_r3c_test:adksy_r3c_test:${FAKE_PW}\n` });
  return path.join(root, 'pgpass');
}
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

describe('findDbVarsInEnvText (pure parser)', () => {
  it('reads plain, exported, quoted, commented and CRLF assignments', () => {
    const text = [
      '# comment',
      'FOO=bar',
      `DATABASE_URL="${OK_URL}"`,
      `export DIRECT_URL='${OK_URL}'`,
      '  DATABASE_URL_OTHER=nope',
    ].join('\r\n');
    expect(findDbVarsInEnvText(text)).toEqual({ DATABASE_URL: OK_URL, DIRECT_URL: OK_URL });
  });

  it('strips a trailing inline comment on unquoted values and ignores empty values', () => {
    expect(findDbVarsInEnvText(`DATABASE_URL=${OK_URL} # local`)).toEqual({ DATABASE_URL: OK_URL });
    expect(findDbVarsInEnvText('DATABASE_URL=\nDIRECT_URL=""')).toEqual({});
  });

  it('the last assignment wins, like dotenv', () => {
    expect(findDbVarsInEnvText(`DATABASE_URL=${REMOTE_URL}\nDATABASE_URL=${OK_URL}`)).toEqual({ DATABASE_URL: OK_URL });
  });

  it('does not treat similarly named variables as database targets', () => {
    expect(findDbVarsInEnvText('SHADOW_DATABASE_URL=x\nMY_DATABASE_URL=y\nDATABASE_URL_X=z')).toEqual({});
  });
});

describe('evaluateEnvFileTexts / scanProjectEnvFiles', () => {
  it('accepts files that only describe the authorized local target', () => {
    expect(evaluateEnvFileTexts([{ file: '.env', text: `DATABASE_URL=${OK_URL}\nDIRECT_URL=${OK_URL}` }])).toEqual([]);
  });

  it.each([
    ['.env', SUPABASE_URL],
    ['.env.local', REMOTE_URL],
    ['.env.test', SUPABASE_URL],
    ['.env.test.local', REMOTE_URL],
    ['.env.development', REMOTE_URL],
    ['.env.production', SUPABASE_URL],
    ['prisma/.env', SUPABASE_URL],
  ])('refuses %s carrying a non-authorized DATABASE_URL', (file, url) => {
    const root = tempRoot({ [file]: `DATABASE_URL=${url}\n` });
    const findings = scanProjectEnvFiles(root);
    expect(findings.map((f) => f.file)).toEqual([file]);
    expect(findings[0].reasons).toContain('HOST_NOT_ALLOWED');
  });

  it('refuses a non-authorized DIRECT_URL even when DATABASE_URL is fine', () => {
    const root = tempRoot({ '.env': `DATABASE_URL=${OK_URL}\nDIRECT_URL=${REMOTE_URL}\n` });
    expect(scanProjectEnvFiles(root).map((f) => f.file)).toEqual(['.env']);
  });

  it('refuses two URLs that differ in target even if each is individually well formed', () => {
    const other = OK_URL.replace('127.0.0.1', 'localhost');
    const root = tempRoot({ '.env': `DATABASE_URL=${OK_URL}\nDIRECT_URL=${other}\n` });
    // same target spelled differently (127.0.0.1 vs localhost) -> ambiguous
    expect(scanProjectEnvFiles(root)[0].reasons).toContain('URLS_DISAGREE');
  });

  it('ignores template files nothing loads (.env.example, .env.sample)', () => {
    const root = tempRoot({ '.env.example': `DATABASE_URL=${SUPABASE_URL}\n`, '.env.sample': `DATABASE_URL=${REMOTE_URL}\n` });
    expect(scanProjectEnvFiles(root)).toEqual([]);
  });

  it('a project without env files has nothing to refuse', () => {
    expect(scanProjectEnvFiles(tempRoot())).toEqual([]);
  });

  it('covers exactly the files Prisma and Vite load', () => {
    expect([...ENV_FILE_CANDIDATES]).toEqual(
      expect.arrayContaining(['.env', '.env.local', '.env.test', '.env.test.local', 'prisma/.env'])
    );
  });

  it('assertNoUnsafeEnvFiles throws a DbSafetyError that names the file but never shows the URL', () => {
    const root = tempRoot({ 'prisma/.env': `DATABASE_URL=${SUPABASE_URL}\n` });
    let error: unknown;
    try {
      assertNoUnsafeEnvFiles(root);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DbSafetyError);
    const message = (error as Error).message;
    expect(message).toContain('ENV_FILE_TARGET_NOT_ALLOWED');
    expect(message).toContain('prisma/.env');
    for (const leaked of ['Sup4-secret-pw', 'supabase', 'abcdefghijklmnop', 'postgresql://', 'postgres.']) {
      expect(message.includes(leaked), `message must not contain ${leaked}`).toBe(false);
    }
  });
});

describe('the Vitest setup policy now covers env files even with no DB variable in the environment', () => {
  it('prisma/.env with a remote target and an EMPTY process environment is refused (the C.7 gap)', () => {
    const root = tempRoot({ 'prisma/.env': `DATABASE_URL=${SUPABASE_URL}\nDIRECT_URL=${SUPABASE_URL}\n` });
    expect(() => enforceGuardForTestRun({}, root)).toThrow(DbSafetyError);
  });

  it('no env files and no DB variable: nothing can connect, tests run', () => {
    expect(enforceGuardForTestRun({}, tempRoot())).toBe('no-db');
  });

  it('a conforming env file and a conforming environment pass', () => {
    const root = tempRoot({ '.env': `DATABASE_URL=${OK_URL}\nDIRECT_URL=${OK_URL}\n` });
    expect(enforceGuardForTestRun({ DATABASE_URL: OK_URL, DIRECT_URL: OK_URL }, root)).toBe('guarded');
  });

  it('a hostile env file is refused even if the process environment is conforming', () => {
    const root = tempRoot({ '.env.local': `DATABASE_URL=${REMOTE_URL}\n` });
    expect(() => enforceGuardForTestRun({ DATABASE_URL: OK_URL, DIRECT_URL: OK_URL }, root)).toThrow(/ENV_FILE_TARGET_NOT_ALLOWED/);
  });
});

describe('buildGuardedEnv (shared by the test runner and the db:* scripts)', () => {
  const creds = () => fakeCredentials();

  it('rebuilds the database environment from the private credentials file and passes the guard', () => {
    const { env, target } = buildGuardedEnv({ baseEnv: {}, root: tempRoot(), credentialsFile: creds() });
    expect(target).toEqual({ host: '127.0.0.1', port: '5433', database: 'adksy_r3c_test', user: 'adksy_r3c_test' });
    expect(env.DATABASE_URL).toBe(env.DIRECT_URL);
    expect(String(env.DATABASE_URL)).toContain('@127.0.0.1:5433/adksy_r3c_test');
  });

  it('removes every external-service credential from the child environment', () => {
    const { env } = buildGuardedEnv({
      baseEnv: { SUPABASE_SERVICE_ROLE_KEY: 'x', STRIPE_SECRET_KEY: 'y', RESEND_API_KEY: 'z', KEEP_ME: '1' },
      root: tempRoot(),
      credentialsFile: creds(),
    });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.KEEP_ME).toBe('1');
  });

  it.each([
    ['DATABASE_URL exported in the shell', { DATABASE_URL: SUPABASE_URL, DIRECT_URL: OK_URL }],
    ['DIRECT_URL exported in the shell', { DATABASE_URL: OK_URL, DIRECT_URL: REMOTE_URL }],
    ['both exported, both remote', { DATABASE_URL: SUPABASE_URL, DIRECT_URL: SUPABASE_URL }],
    ['only DATABASE_URL exported (and remote)', { DATABASE_URL: REMOTE_URL }],
  ])('refuses %s instead of silently overriding it', (_name, baseEnv) => {
    expect(() => buildGuardedEnv({ baseEnv, root: tempRoot(), credentialsFile: creds() })).toThrow(DbSafetyError);
  });

  it('accepts shell variables that are exactly the authorized target', () => {
    const { target } = buildGuardedEnv({ baseEnv: { DATABASE_URL: OK_URL, DIRECT_URL: OK_URL }, root: tempRoot(), credentialsFile: creds() });
    expect(target.database).toBe('adksy_r3c_test');
  });

  it('refuses when an env file carries a remote target, whatever the shell says', () => {
    const root = tempRoot({ 'prisma/.env': `DATABASE_URL=${SUPABASE_URL}\n` });
    expect(() => buildGuardedEnv({ baseEnv: {}, root, credentialsFile: creds() })).toThrow(/prisma\/\.env/);
  });

  it('refuses when the credentials file is missing or has no entry for the dedicated database (fail-closed)', () => {
    expect(() => buildGuardedEnv({ baseEnv: {}, root: tempRoot(), credentialsFile: path.join(tempRoot(), 'nope') })).toThrow(/credentials file not reachable/);
    const other = tempRoot({ pgpass: `127.0.0.1:5433:other_db:other_user:pw\n` });
    expect(() => buildGuardedEnv({ baseEnv: {}, root: tempRoot(), credentialsFile: path.join(other, 'pgpass') })).toThrow(/no credentials entry/);
  });

  it('no refusal message contains a URL, a password or a host', () => {
    for (const baseEnv of [{ DATABASE_URL: SUPABASE_URL, DIRECT_URL: SUPABASE_URL }, { DATABASE_URL: REMOTE_URL }]) {
      try {
        buildGuardedEnv({ baseEnv, root: tempRoot(), credentialsFile: creds() });
        throw new Error('expected a refusal');
      } catch (error) {
        const m = (error as Error).message;
        for (const leaked of ['Sup4-secret-pw', 'Rem0te-secret-pw', 'supabase.com', 'db.example.com', 'postgresql://', FAKE_PW]) {
          expect(m.includes(leaked), `must not contain ${leaked}`).toBe(false);
        }
      }
    }
  });

  it('the project root is derived from the script location (absolute, ends with this project)', () => {
    expect(path.isAbsolute(repoRoot)).toBe(true);
    expect(path.basename(repoRoot)).toBe(path.basename(path.resolve(__dirname, '..', '..', '..', '..')));
  });
});
