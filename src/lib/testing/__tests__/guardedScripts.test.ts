/**
 * R3-C.8 — the guarded entry points (`npm run db:*` -> scripts/db/guarded-prisma.mjs,
 * and scripts/r3c/run-with-test-db.mjs) refuse everything unsafe BEFORE starting any
 * child process, and in dry-run mode accept the authorized commands.
 *
 * These tests spawn the real scripts with a synthetic credentials file (fake password)
 * and a minimal environment. Every case is either a refusal or `--dry-run`/`check`:
 * Prisma, Vitest and PostgreSQL are never started, no database is contacted.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FAKE_PW = 'unit-test-not-a-real-secret';
const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const prismaScript = path.join(projectRoot, 'scripts', 'db', 'guarded-prisma.mjs');
const runnerScript = path.join(projectRoot, 'scripts', 'r3c', 'run-with-test-db.mjs');

const temp = mkdtempSync(path.join(tmpdir(), 'adksy-c8-scripts-'));
const credentials = path.join(temp, 'pgpass');
writeFileSync(credentials, `127.0.0.1:5433:adksy_r3c_test:adksy_r3c_test:${FAKE_PW}\n`);
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const REMOTE = 'postgresql://postgres.abcdefghijklmnop:Sup4-secret-pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';

function run(script: string, args: string[], extraEnv: Record<string, string> = {}, cwd: string = projectRoot) {
  const env = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    NODE_NO_WARNINGS: '1',
    ADKSY_R3C_PGPASS_FILE: credentials,
    ...extraEnv,
  };
  const r = spawnSync(process.execPath, [script, ...args], { env: env as unknown as NodeJS.ProcessEnv, cwd, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const noLeak = (text: string) => {
  for (const leaked of [FAKE_PW, 'Sup4-secret-pw', 'supabase.com', 'abcdefghijklmnop', 'postgresql://']) {
    expect(text.includes(leaked), `output must not contain ${leaked}`).toBe(false);
  }
};

describe('db:* scripts (guarded-prisma.mjs) — authorized commands, dry run only', () => {
  it('check validates the target and prints it without credentials', () => {
    const r = run(prismaScript, ['check']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('guard OK: 127.0.0.1:5433 / adksy_r3c_test / adksy_r3c_test');
    noLeak(r.out);
  });

  it.each(['status', 'deploy', 'studio'])('%s --dry-run is accepted and starts nothing', (command) => {
    const r = run(prismaScript, [command, '--dry-run']);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`dry run: "${command}" would run on 127.0.0.1:5433`);
    noLeak(r.out);
  });

  it.each(['push', 'reset', 'seed'])('%s --confirm-local-test-db --dry-run is accepted and starts nothing', (command) => {
    const r = run(prismaScript, [command, '--confirm-local-test-db', '--dry-run']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('dry run');
  });

  it('works the same when launched from another working directory', () => {
    const r = run(prismaScript, ['check'], {}, tmpdir());
    expect(r.code).toBe(0);
    expect(r.out).toContain('guard OK');
  });
});

describe('db:* scripts — refusals (exit code 2, nothing started, no secret in the output)', () => {
  it.each(['push', 'reset', 'seed'])('%s without --confirm-local-test-db', (command) => {
    const r = run(prismaScript, [command]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('--confirm-local-test-db');
    noLeak(r.out);
  });

  it.each([
    ['dev'], ['migrate'], ['migrate', 'dev'], ['db', 'push'], ['generate'], ['execute'], ['--help'], [],
  ])('unknown command %j', (...args) => {
    const r = run(prismaScript, args);
    expect(r.code).toBe(2);
    expect(r.out).toContain('REFUSED');
  });

  it.each([
    ['reset', '--confirm-local-test-db', '--force'],
    ['push', '--confirm-local-test-db', '--accept-data-loss'],
    ['status', '--schema=other.prisma'],
    ['deploy', '--url=postgresql://x'],
    ['seed', '--confirm-local-test-db', 'extra'],
    ['studio', '--port=5555'],
  ])('no flag forwarding: %j', (...args) => {
    const r = run(prismaScript, args);
    expect(r.code).toBe(2);
    expect(r.out).toContain('argument not accepted');
    noLeak(r.out);
  });

  it.each([
    ['DATABASE_URL exported (remote)', { DATABASE_URL: REMOTE, DIRECT_URL: REMOTE }],
    ['only DATABASE_URL exported (remote)', { DATABASE_URL: REMOTE }],
    ['only DIRECT_URL exported (remote)', { DIRECT_URL: REMOTE }],
  ])('%s', (_name, shell) => {
    for (const args of [['check'], ['status', '--dry-run'], ['reset', '--confirm-local-test-db', '--dry-run']]) {
      const r = run(prismaScript, args, shell);
      expect(r.code).toBe(2);
      expect(r.out).toContain('REFUSED');
      noLeak(r.out);
    }
  });

  it('refuses when the credentials file is not reachable (fail-closed)', () => {
    const r = run(prismaScript, ['check'], { ADKSY_R3C_PGPASS_FILE: path.join(temp, 'missing') });
    expect(r.code).toBe(2);
    expect(r.out).toContain('credentials file not reachable');
  });
});

describe('the guarded test runner (run-with-test-db.mjs) shares the same protections', () => {
  it('check passes with the synthetic credentials', () => {
    const r = run(runnerScript, ['check']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('guard OK');
    noLeak(r.out);
  });

  it('refuses an exported remote DATABASE_URL (it is no longer silently overridden)', () => {
    const r = run(runnerScript, ['check'], { DATABASE_URL: REMOTE, DIRECT_URL: REMOTE });
    expect(r.code).toBe(2);
    noLeak(r.out);
  });

  it.each([
    [['vitest']],
    [['vitest', 'src']],
    [['vitest', '--coverage']],
    [['vitest', 'package.json']],
    [['prisma', 'migrate', 'dev']],
    [['prisma', 'migrate', 'reset']],
    [['prisma', 'db', 'push']],
    [['prisma', 'db', 'seed']],
    [['bogus']],
  ])('refuses %j', (args) => {
    const r = run(runnerScript, args as string[]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('REFUSED');
  });
});

describe('npm scripts route every database command through the guard', () => {
  const scripts = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).scripts as Record<string, string>;

  it('no db:* script calls prisma or the seed directly', () => {
    for (const [name, command] of Object.entries(scripts)) {
      if (!name.startsWith('db:')) continue;
      expect(command, name).toMatch(/^node scripts\/db\/guarded-prisma\.mjs (check|status|deploy|push|reset|seed|studio)$/);
    }
  });

  it('the destructive commands are all still defined, and only through the wrapper', () => {
    for (const name of ['db:push', 'db:reset', 'db:seed', 'db:studio']) expect(scripts[name]).toContain('guarded-prisma.mjs');
  });

  it('no script anywhere in package.json runs prisma migrate dev / reset / db push directly', () => {
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, name).not.toMatch(/prisma\s+(migrate\s+(dev|reset)|db\s+(push|seed|execute))/);
      expect(command, name).not.toMatch(/node\s+prisma\/seed(-plans-production)?\.js/);
    }
  });
});
