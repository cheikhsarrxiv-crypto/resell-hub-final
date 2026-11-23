/**
 * R3-C.8 — shared, fail-closed construction of the ONLY database environment
 * that DB tests and database maintenance commands may use.
 *
 * Used by:
 *   - scripts/r3c/run-with-test-db.mjs   (guarded Vitest / migrate deploy|status)
 *   - scripts/db/guarded-prisma.mjs      (the npm `db:*` scripts)
 *
 * Rules, all enforced before anything is started:
 *  1. No env FILE that Prisma or Vite would load (`.env`, `.env.local`, `.env.test`,
 *     `prisma/.env`, ...) may carry a DB target other than the dedicated local test
 *     database. Files are read in memory; their contents are never printed.
 *  2. DATABASE_URL / DIRECT_URL inherited from the shell must be absent or already be
 *     exactly the authorized target; otherwise the command is refused (a mistaken
 *     export of a remote URL is reported, not silently overridden).
 *  3. The child environment is rebuilt from the private credentials file of the local
 *     cluster, with every external-service credential removed.
 *  4. The resulting environment is validated by the same guard Vitest uses.
 *
 * The project root is derived from this file's location, never from the current
 * directory, so running a script from another directory changes nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  R3C_ALLOWED_TARGET,
  EXTERNAL_CREDENTIAL_VARS,
  DbSafetyError,
  assertNoUnsafeEnvFiles,
  assertSafeTestDatabase,
  evaluateTestDatabaseEnv,
} from '../../../src/lib/testing/dbSafetyGuard.ts';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DEFAULT_CREDENTIALS_FILE = '\\\\wsl$\\Ubuntu-22.04\\home\\cheik\\.adksy-r3c\\pgpass';

/** Thrown for every refusal; its message never contains a URL or a secret. */
export class GuardedRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'GuardedRefusal';
  }
}

export function readPassword(file) {
  if (!existsSync(file)) {
    throw new GuardedRefusal('credentials file not reachable (is the Ubuntu WSL distribution running?)');
  }
  const wanted = ['127.0.0.1', R3C_ALLOWED_TARGET.port, R3C_ALLOWED_TARGET.database, R3C_ALLOWED_TARGET.user];
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.split(':').slice(0, 4).join(':') === wanted.join(':'));
  if (!line) throw new GuardedRefusal('no credentials entry for the dedicated test database');
  const password = line.split(':').slice(4).join(':');
  if (!password) throw new GuardedRefusal('empty password entry');
  return password;
}

/**
 * Builds the child environment for a guarded command.
 * @param {{ baseEnv?: Record<string,string|undefined>, credentialsFile?: string, root?: string }} [options]
 */
export function buildGuardedEnv(options = {}) {
  const baseEnv = options.baseEnv ?? process.env;
  const root = options.root ?? repoRoot;
  const credentialsFile = options.credentialsFile ?? baseEnv.ADKSY_R3C_PGPASS_FILE ?? DEFAULT_CREDENTIALS_FILE;

  // 1. env files that Prisma / Vite would load by themselves
  assertNoUnsafeEnvFiles(root);

  // 2. variables exported in the shell: absent, or exactly the authorized target
  const inherited = { DATABASE_URL: baseEnv.DATABASE_URL, DIRECT_URL: baseEnv.DIRECT_URL };
  const hasInherited = Object.values(inherited).some((v) => typeof v === 'string' && v.trim() !== '');
  if (hasInherited) {
    const result = evaluateTestDatabaseEnv(inherited);
    if (!result.ok) throw new DbSafetyError(result.reasons);
  }

  // 3. rebuild the environment from the private credentials file; drop external credentials
  const env = { ...baseEnv };
  for (const name of EXTERNAL_CREDENTIAL_VARS) delete env[name];
  const password = readPassword(credentialsFile);
  const url =
    `postgresql://${R3C_ALLOWED_TARGET.user}:${encodeURIComponent(password)}` +
    `@127.0.0.1:${R3C_ALLOWED_TARGET.port}/${R3C_ALLOWED_TARGET.database}?schema=public`;
  env.DATABASE_URL = url;
  env.DIRECT_URL = url;
  env.NODE_ENV = 'test';

  // 4. final validation of the exact environment the child will receive
  const target = assertSafeTestDatabase(env);
  return { env, target };
}

export function describeTarget(target) {
  return `${target.host}:${target.port} / ${target.database} / ${target.user} (credentials not shown)`;
}
