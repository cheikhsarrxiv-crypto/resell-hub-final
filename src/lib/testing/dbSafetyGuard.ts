/**
 * R3-C.2.1 — fail-closed safety guard for every test that may touch a real
 * PostgreSQL database.
 *
 * The ONLY database a test run is allowed to reach is the dedicated, local,
 * disposable R3-C cluster:
 *
 *     host     localhost | 127.0.0.1
 *     port     5433
 *     database adksy_r3c_test
 *     user     adksy_r3c_test
 *
 * Everything else — a remote host, any Supabase / pooler / cloud URL, the
 * default 5432 port, another database, another role, a malformed or
 * ambiguous URL, contradictory DATABASE_URL / DIRECT_URL, connection-string
 * parameters that could redirect the connection, or external-service
 * credentials in the environment — is refused. The guard validates the
 * URL's actual content; an environment flag saying "this is a test" is never
 * treated as proof.
 *
 * This file is deliberately written with erasable TypeScript only (no enums,
 * no parameter properties, no `import` of project aliases) so that it can be
 * imported by Node's built-in type stripping from the runner scripts as well
 * as by Vitest and tsc.
 *
 * Error messages carry reason CODES only: they never contain a URL, a host,
 * a user name, a password or any other part of the connection string.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const R3C_ALLOWED_TARGET = Object.freeze({
  hosts: Object.freeze(['localhost', '127.0.0.1']),
  port: '5433',
  database: 'adksy_r3c_test',
  user: 'adksy_r3c_test',
});

/** Connection-string parameters that cannot redirect or reconfigure the target. */
const ALLOWED_QUERY_PARAMS = Object.freeze([
  'schema',
  'connection_limit',
  'pool_timeout',
  'connect_timeout',
  'sslmode',
]);

/**
 * Credentials of external services. A DB test run must not have any of them:
 * several live tests would otherwise talk to Supabase Storage, Stripe, eBay,
 * Etsy or an e-mail provider.
 */
export const EXTERNAL_CREDENTIAL_VARS = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'STRIPE_SECRET_KEY',
  'EBAY_CLIENT_SECRET',
  'EBAY_BUY_API_CLIENT_SECRET',
  'ETSY_CLIENT_SECRET',
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'MAILGUN_API_KEY',
]);

export type GuardReason =
  | 'DATABASE_URL_MISSING'
  | 'DIRECT_URL_MISSING'
  | 'URL_MALFORMED'
  | 'PROTOCOL_NOT_POSTGRES'
  | 'HOST_NOT_ALLOWED'
  | 'PORT_NOT_ALLOWED'
  | 'DATABASE_NOT_ALLOWED'
  | 'USER_NOT_ALLOWED'
  | 'PASSWORD_MISSING'
  | 'QUERY_PARAM_NOT_ALLOWED'
  | 'SCHEMA_NOT_ALLOWED'
  | 'URLS_DISAGREE'
  | 'EXTERNAL_CREDENTIALS_PRESENT'
  | 'RUNTIME_TARGET_MISMATCH'
  | 'ENV_FILE_TARGET_NOT_ALLOWED';

export interface ParsedTarget {
  host: string;
  port: string;
  database: string;
  user: string;
}

export type GuardResult =
  | { ok: true; target: ParsedTarget }
  | { ok: false; reasons: GuardReason[] };

type EnvLike = Record<string, string | undefined>;

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Validate ONE connection URL; returns the parsed target or the reasons it was refused. */
export function evaluateTestDatabaseUrl(raw: string): { target?: ParsedTarget; reasons: GuardReason[] } {
  return checkUrl(raw);
}

function checkUrl(raw: string): { target?: ParsedTarget; reasons: GuardReason[] } {
  const reasons: GuardReason[] = [];

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reasons: ['URL_MALFORMED'] };
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    reasons.push('PROTOCOL_NOT_POSTGRES');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!R3C_ALLOWED_TARGET.hosts.includes(host)) {
    reasons.push('HOST_NOT_ALLOWED');
  }

  // An omitted port means the default 5432: not the dedicated cluster.
  if (url.port !== R3C_ALLOWED_TARGET.port) {
    reasons.push('PORT_NOT_ALLOWED');
  }

  let database = '';
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    reasons.push('URL_MALFORMED');
  }
  if (database !== R3C_ALLOWED_TARGET.database) {
    reasons.push('DATABASE_NOT_ALLOWED');
  }

  let user = '';
  try {
    user = decodeURIComponent(url.username);
  } catch {
    reasons.push('URL_MALFORMED');
  }
  if (user !== R3C_ALLOWED_TARGET.user) {
    reasons.push('USER_NOT_ALLOWED');
  }

  if (url.password.length === 0) {
    reasons.push('PASSWORD_MISSING');
  }

  for (const [key, value] of url.searchParams.entries()) {
    if (!ALLOWED_QUERY_PARAMS.includes(key)) {
      reasons.push('QUERY_PARAM_NOT_ALLOWED');
    } else if (key === 'schema' && value !== 'public') {
      reasons.push('SCHEMA_NOT_ALLOWED');
    }
  }

  const unique = [...new Set(reasons)];
  if (unique.length > 0) return { reasons: unique };
  return { target: { host, port: url.port, database, user }, reasons: [] };
}

/**
 * Pure evaluation of an environment. Never throws, never reads files, never
 * connects, never returns any part of a URL.
 */
export function evaluateTestDatabaseEnv(env: EnvLike): GuardResult {
  const reasons: GuardReason[] = [];

  const databaseUrl = env.DATABASE_URL;
  const directUrl = env.DIRECT_URL;

  if (!isNonEmpty(databaseUrl)) reasons.push('DATABASE_URL_MISSING');
  if (!isNonEmpty(directUrl)) reasons.push('DIRECT_URL_MISSING');

  const parsed: ParsedTarget[] = [];
  for (const raw of [databaseUrl, directUrl]) {
    if (!isNonEmpty(raw)) continue;
    const result = checkUrl(raw);
    reasons.push(...result.reasons);
    if (result.target) parsed.push(result.target);
  }

  // Both URLs must exist, be valid, and describe exactly the same target.
  if (parsed.length === 2) {
    const [a, b] = parsed;
    if (a.host !== b.host || a.port !== b.port || a.database !== b.database || a.user !== b.user) {
      reasons.push('URLS_DISAGREE');
    }
  }

  for (const name of EXTERNAL_CREDENTIAL_VARS) {
    if (isNonEmpty(env[name])) {
      reasons.push('EXTERNAL_CREDENTIALS_PRESENT');
      break;
    }
  }

  const unique = [...new Set(reasons)];
  if (unique.length > 0 || parsed.length !== 2) {
    return { ok: false, reasons: unique.length > 0 ? unique : ['URL_MALFORMED'] };
  }
  return { ok: true, target: parsed[0] };
}

export class DbSafetyError extends Error {
  readonly reasons: GuardReason[];
  /** Relative names of the env files that carry an unauthorized DB target (names only, never contents). */
  readonly files: string[];
  constructor(reasons: GuardReason[], files: string[] = []) {
    super(
      `DB safety guard refused the test database target (${reasons.join(', ')}` +
        `${files.length > 0 ? `; env files: ${files.join(', ')}` : ''}). ` +
        'No connection was attempted. Only the dedicated local R3-C database is allowed.'
    );
    this.name = 'DbSafetyError';
    this.reasons = reasons;
    this.files = files;
  }
}

/** Throws DbSafetyError unless the environment targets exactly the dedicated R3-C database. */
export function assertSafeTestDatabase(env: EnvLike = process.env): ParsedTarget {
  const result = evaluateTestDatabaseEnv(env);
  if (!result.ok) throw new DbSafetyError(result.reasons);
  return result.target;
}

/**
 * Policy used by the Vitest setup file, which runs before EVERY test file
 * (so before any module-level `new PrismaClient()` of the live tests):
 *  - no DB variable at all  -> nothing can connect; mocked / non-DB tests run normally;
 *  - any DB variable set    -> it MUST pass the guard, otherwise the run is aborted.
 */
export function enforceGuardForTestRun(env: EnvLike = process.env, projectRoot?: string): 'no-db' | 'guarded' {
  // Files that Prisma / Vite load by themselves are checked even when the process environment has no DB variable:
  // Prisma auto-loads `.env` and `prisma/.env`, which Vite's loadEnv does not see.
  if (projectRoot) assertNoUnsafeEnvFiles(projectRoot);
  const anyDbVariable = isNonEmpty(env.DATABASE_URL) || isNonEmpty(env.DIRECT_URL);
  if (!anyDbVariable) return 'no-db';
  assertSafeTestDatabase(env);
  return 'guarded';
}

// ---------------------------------------------------------------------------
// R3-C.8 — environment FILES that can feed a database target to Prisma / Vite
// ---------------------------------------------------------------------------

/**
 * Files, relative to the project root, from which Prisma (CLI and client:
 * `.env` and `prisma/.env`) or Vite/Vitest (`loadEnv`: `.env`, `.env.local`,
 * `.env.<mode>`, `.env.<mode>.local`) may take DATABASE_URL / DIRECT_URL.
 * Example/template files are deliberately not scanned: nothing loads them.
 */
export const ENV_FILE_CANDIDATES = Object.freeze([
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.test',
  '.env.test.local',
  '.env.production',
  '.env.production.local',
  'prisma/.env',
]);

export type DbVarName = 'DATABASE_URL' | 'DIRECT_URL';

/** Extracts DATABASE_URL / DIRECT_URL assignments from dotenv text. Pure; never logs. */
export function findDbVarsInEnvText(text: string): Partial<Record<DbVarName, string>> {
  const found: Partial<Record<DbVarName, string>> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(DATABASE_URL|DIRECT_URL)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.includes(quote, 1)) {
      value = value.slice(1, value.indexOf(quote, 1));
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (value.length > 0) found[m[1] as DbVarName] = value; // later assignment wins, like dotenv
  }
  return found;
}

export interface EnvFileFinding {
  file: string;
  reasons: GuardReason[];
}

/** Pure: which of the given env files carry a DB target that the guard would refuse? */
export function evaluateEnvFileTexts(files: Array<{ file: string; text: string }>): EnvFileFinding[] {
  const findings: EnvFileFinding[] = [];
  for (const { file, text } of files) {
    const vars = findDbVarsInEnvText(text);
    const reasons: GuardReason[] = [];
    for (const raw of Object.values(vars)) {
      if (raw) reasons.push(...checkUrl(raw).reasons);
    }
    if (vars.DATABASE_URL && vars.DIRECT_URL && vars.DATABASE_URL !== vars.DIRECT_URL) {
      // two different strings: only acceptable if they still describe the same target
      const a = checkUrl(vars.DATABASE_URL).target;
      const b = checkUrl(vars.DIRECT_URL).target;
      if (!a || !b || a.host !== b.host || a.port !== b.port || a.database !== b.database || a.user !== b.user) {
        reasons.push('URLS_DISAGREE');
      }
    }
    if (reasons.length > 0) findings.push({ file, reasons: [...new Set(reasons)] });
  }
  return findings;
}

/** Reads the candidate env files under `root` (in memory only) and returns the unsafe ones. */
export function scanProjectEnvFiles(
  root: string,
  io: { exists: (p: string) => boolean; read: (p: string) => string } = {
    exists: existsSync,
    read: (p) => readFileSync(p, 'utf8'),
  }
): EnvFileFinding[] {
  const present: Array<{ file: string; text: string }> = [];
  for (const rel of ENV_FILE_CANDIDATES) {
    const abs = path.join(root, rel);
    if (io.exists(abs)) present.push({ file: rel, text: io.read(abs) });
  }
  return evaluateEnvFileTexts(present);
}

/** Throws unless every present env file is free of any non-authorized DB target. */
export function assertNoUnsafeEnvFiles(root: string, io?: Parameters<typeof scanProjectEnvFiles>[1]): void {
  const findings = scanProjectEnvFiles(root, io);
  if (findings.length > 0) {
    throw new DbSafetyError(['ENV_FILE_TARGET_NOT_ALLOWED'], findings.map((f) => f.file));
  }
}

export interface RuntimeIdentity {
  database: string | null;
  user: string | null;
  port: number | string | null;
}

/**
 * Second layer, after connecting: the server must really be the dedicated
 * cluster. `identity` comes from `select current_database(), current_user,
 * inet_server_port()`.
 */
export function assertRuntimeIdentity(identity: RuntimeIdentity): void {
  const ok =
    identity.database === R3C_ALLOWED_TARGET.database &&
    identity.user === R3C_ALLOWED_TARGET.user &&
    String(identity.port) === R3C_ALLOWED_TARGET.port;
  if (!ok) throw new DbSafetyError(['RUNTIME_TARGET_MISMATCH']);
}
