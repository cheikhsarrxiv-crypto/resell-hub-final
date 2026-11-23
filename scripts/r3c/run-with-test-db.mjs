#!/usr/bin/env node
/**
 * R3-C — the only supported way to run DB tests against the dedicated local
 * PostgreSQL test cluster. (Database maintenance has its own guarded entry
 * point: scripts/db/guarded-prisma.mjs, behind the `db:*` npm scripts.)
 *
 *   node scripts/r3c/run-with-test-db.mjs check
 *   node scripts/r3c/run-with-test-db.mjs vitest <test file> [<test file> ...]
 *   node scripts/r3c/run-with-test-db.mjs prisma migrate deploy
 *   node scripts/r3c/run-with-test-db.mjs prisma migrate status
 *
 * Fail-closed, via the shared scripts/db/lib/guardedEnv.mjs (R3-C.8):
 *  - env files that Prisma / Vite would load (`.env*`, `prisma/.env`) must not carry
 *    any other database target;
 *  - DATABASE_URL / DIRECT_URL exported in the shell must be absent or the authorized
 *    target — otherwise the command is refused;
 *  - the child environment is rebuilt from the private credentials file (never printed,
 *    never written to disk) with every external-service credential removed;
 *  - the guard validates that exact environment before anything is started.
 *
 * Only Vitest on EXPLICIT test files (never a directory, glob or global run), or
 * Prisma `migrate deploy|status`, can be started. Everything else is refused.
 */
import { existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildGuardedEnv, describeTarget, repoRoot } from '../db/lib/guardedEnv.mjs';

function fail(message) {
  console.error(`[r3c-runner] REFUSED: ${message}`);
  process.exit(2);
}

function guardedEnvOrExit() {
  try {
    return buildGuardedEnv();
  } catch (error) {
    fail(error.message);
  }
}

function run(args, env) {
  const child = spawn(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit', shell: false });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'check') {
  const { target } = guardedEnvOrExit();
  console.log(`[r3c-runner] guard OK: ${describeTarget(target)}`);
  process.exit(0);
}

if (command === 'vitest') {
  if (rest.length === 0) fail('Vitest needs explicit test files; a global run is not allowed');
  const files = rest.map((f) => {
    if (f.startsWith('-')) fail('Vitest flags are not accepted');
    const abs = path.resolve(repoRoot, f);
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
    if (rel.startsWith('..') || !rel.startsWith('src/') || !/\.test\.tsx?$/.test(rel)) {
      fail(`not an explicit test file under src/: ${f}`);
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) fail(`test file not found: ${f}`);
    return rel;
  });
  const { env } = guardedEnvOrExit();
  // One shared database: test files run one after the other (the harness suites compare table counts).
  run([path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--no-file-parallelism', ...files], env);
} else if (command === 'prisma') {
  const allowed = [['migrate', 'deploy'], ['migrate', 'status']];
  if (!allowed.some((a) => a.length === rest.length && a.every((x, i) => x === rest[i]))) {
    fail('only "prisma migrate deploy" and "prisma migrate status" are allowed');
  }
  const { env } = guardedEnvOrExit();
  run([path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js'), ...rest], env);
} else {
  fail('usage: check | vitest <test files> | prisma migrate deploy|status');
}
