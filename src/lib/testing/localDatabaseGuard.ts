/**
 * Guard against running the real-PostgreSQL stock-reservation integration
 * suite (tests/integration/stock-service.postgres.test.ts) against
 * anything other than the one isolated local test database it's meant
 * for. That suite runs real DDL (CREATE FUNCTION, ALTER TABLE ... ADD
 * CONSTRAINT) and deletes real rows — a mistaken connection to a shared
 * or remote database would not be a test failure, it would be an
 * incident.
 *
 * Pure, dependency-free functions only (no PrismaClient, no fs, no
 * process.exit) so they're fully unit-testable without a database or
 * Docker — see __tests__/localDatabaseGuard.test.ts.
 *
 * Deliberately strict in both directions: a URL is accepted only when
 * `new URL()` parses it AND its resolved hostname/port/pathname exactly
 * match the expected local test database — never a substring match on
 * the raw string, which previously missed that `new URL()` resolves the
 * real host as whatever follows the LAST unescaped "@", not the first
 * occurrence of "localhost" anywhere in the string (e.g. a crafted
 * `postgresql://user:p@localhost@evil.example.com:5432/db` really
 * connects to evil.example.com, not localhost, and must be rejected).
 */

export const EXPECTED_LOCAL_TEST_DB = {
  port: '5433',
  database: 'stock_test',
} as const;

const ALLOWED_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ALLOWED_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

export interface UrlCheckResult {
  ok: boolean;
  /** Never includes the raw URL or any credential/value — category only. */
  reason?: string;
}

function normalizeHostname(hostname: string): string {
  // new URL(...).hostname keeps brackets around an IPv6 literal (e.g. "[::1]").
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

/**
 * Checks a single connection-string-shaped value against the expected
 * local test database. Never throws — always returns a result, so a
 * caller can check both DATABASE_URL and DIRECT_URL independently and
 * report exactly which one is wrong.
 */
export function checkLocalTestDatabaseUrl(
  rawUrl: string | undefined | null,
  expected: { port: string; database: string } = EXPECTED_LOCAL_TEST_DB
): UrlCheckResult {
  if (!rawUrl || rawUrl.trim() === '') {
    return { ok: false, reason: 'missing' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'malformed (not a parseable URL)' };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: `unexpected protocol "${parsed.protocol}" (expected postgres/postgresql)` };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!ALLOWED_LOCAL_HOSTS.has(hostname)) {
    return { ok: false, reason: 'host is not localhost, 127.0.0.1, or ::1' };
  }

  // No implicit default-port fallback: the expected port is intentionally
  // non-standard (5433, to avoid colliding with any already-running local
  // Postgres on 5432), so an omitted port is a mismatch, not an allowance.
  if (parsed.port !== expected.port) {
    return { ok: false, reason: `port does not match the expected local test database port (${expected.port})` };
  }

  const database = parsed.pathname.replace(/^\//, '');
  if (database !== expected.database) {
    return {
      ok: false,
      reason: `database name does not match the expected local test database name ("${expected.database}")`,
    };
  }

  return { ok: true };
}

export interface EnvCheckResult {
  ok: boolean;
  errors: Array<{ variable: string; reason: string }>;
}

/**
 * Checks DATABASE_URL and DIRECT_URL independently — both must resolve to
 * the exact same expected local test database (Prisma's schema-changing
 * commands, like `prisma db push`, use DIRECT_URL preferentially, while
 * the application/test queries use DATABASE_URL; if only one were
 * checked, a stale DIRECT_URL could silently redirect schema changes to
 * a real/remote database even though DATABASE_URL looks safe).
 */
export function checkIntegrationDatabaseEnv(
  env: Record<string, string | undefined> = process.env,
  expected: { port: string; database: string } = EXPECTED_LOCAL_TEST_DB
): EnvCheckResult {
  const errors: EnvCheckResult['errors'] = [];
  for (const variable of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const result = checkLocalTestDatabaseUrl(env[variable], expected);
    if (!result.ok) {
      errors.push({ variable, reason: result.reason ?? 'invalid' });
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Throws a descriptive error (naming only the failing variable names and
 * categorized reasons — never a value) when the environment isn't a
 * valid local test database target. Intended to be called at the very
 * top of the real integration test file, before any PrismaClient is
 * constructed — so an invalid configuration aborts test collection
 * itself, with no database connection ever attempted, rather than
 * silently degrading to describe.skip (which exits 0 and looks like
 * nothing was wrong).
 */
export function assertIntegrationDatabaseEnv(
  env: Record<string, string | undefined> = process.env,
  expected: { port: string; database: string } = EXPECTED_LOCAL_TEST_DB
): void {
  const result = checkIntegrationDatabaseEnv(env, expected);
  if (!result.ok) {
    const details = result.errors.map((e) => `  - ${e.variable}: ${e.reason}`).join('\n');
    throw new Error(
      `Refusing to run the PostgreSQL stock-reservation integration suite: ` +
        `DATABASE_URL and DIRECT_URL must both point at the isolated local test database ` +
        `(host localhost/127.0.0.1/::1, port ${expected.port}, database "${expected.database}").\n${details}\n` +
        `See tests/integration/stock-service.postgres.test.ts and scripts/run-stock-integration-tests.sh for the exact setup.`
    );
  }
}
