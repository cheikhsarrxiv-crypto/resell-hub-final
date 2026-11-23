#!/usr/bin/env node
/**
 * R3-C.8 — guarded entry point for every database maintenance command.
 * The npm scripts `db:*` call this file; they no longer call `prisma` directly.
 *
 *   node scripts/db/guarded-prisma.mjs check
 *   node scripts/db/guarded-prisma.mjs status      (prisma migrate status)
 *   node scripts/db/guarded-prisma.mjs deploy      (prisma migrate deploy)
 *   node scripts/db/guarded-prisma.mjs push        (prisma db push)            needs --confirm-local-test-db
 *   node scripts/db/guarded-prisma.mjs reset       (prisma migrate reset)      needs --confirm-local-test-db
 *   node scripts/db/guarded-prisma.mjs seed        (node prisma/seed.js)       needs --confirm-local-test-db
 *   node scripts/db/guarded-prisma.mjs studio      (prisma studio)
 *
 * Every command runs ONLY against the dedicated local test database
 * (127.0.0.1:5433 / adksy_r3c_test). The database environment is rebuilt by
 * lib/guardedEnv.mjs; whatever DATABASE_URL / DIRECT_URL the shell or an env
 * file carries is either identical to that target or the command is refused.
 * There is deliberately NO `migrate dev`, no flag forwarding (`--force`,
 * `--schema`, `--url`, `--accept-data-loss`, ...) and no other target.
 *
 * `--dry-run` validates everything and prints what would run, without starting it.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGuardedEnv, describeTarget, GuardedRefusal, repoRoot } from './lib/guardedEnv.mjs';

const prismaCli = path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js');

/** command -> { args, destructive } ; the argument lists are fixed here, never taken from the command line. */
export const COMMANDS = Object.freeze({
  check: { args: null, destructive: false },
  status: { args: [prismaCli, 'migrate', 'status'], destructive: false },
  deploy: { args: [prismaCli, 'migrate', 'deploy'], destructive: false },
  push: { args: [prismaCli, 'db', 'push', '--skip-generate'], destructive: true },
  reset: { args: [prismaCli, 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate'], destructive: true },
  seed: { args: [path.join(repoRoot, 'prisma', 'seed.js')], destructive: true },
  studio: { args: [prismaCli, 'studio'], destructive: false },
});

const ALLOWED_FLAGS = new Set(['--dry-run', '--confirm-local-test-db']);

function refuse(message) {
  console.error(`[db-guard] REFUSED: ${message}`);
  process.exit(2);
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || !Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
    throw new GuardedRefusal(`unknown command; allowed: ${Object.keys(COMMANDS).join(' | ')}`);
  }
  for (const arg of rest) {
    if (!ALLOWED_FLAGS.has(arg)) throw new GuardedRefusal(`argument not accepted: ${arg.startsWith('-') ? arg.split('=')[0] : '<value>'}`);
  }
  const flags = new Set(rest);
  if (COMMANDS[command].destructive && !flags.has('--confirm-local-test-db')) {
    throw new GuardedRefusal(`"${command}" changes the local test database; add --confirm-local-test-db to confirm`);
  }
  return { command, dryRun: flags.has('--dry-run') };
}

async function main() {
  let parsed;
  let guarded;
  try {
    parsed = parseArgs(process.argv.slice(2));
    guarded = buildGuardedEnv();
  } catch (error) {
    refuse(error.message);
  }
  const { command, dryRun } = parsed;
  const { env, target } = guarded;

  if (command === 'check') {
    console.log(`[db-guard] guard OK: ${describeTarget(target)}`);
    return;
  }
  const { args } = COMMANDS[command];
  if (dryRun) {
    console.log(`[db-guard] dry run: "${command}" would run on ${describeTarget(target)}`);
    return;
  }
  console.log(`[db-guard] running "${command}" on ${describeTarget(target)}`);
  const child = spawn(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit', shell: false });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
}

// run only when executed directly (the module is also imported by tests)
if (path.resolve(process.argv[1] ?? '') === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
