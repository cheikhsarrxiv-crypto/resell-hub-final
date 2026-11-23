# ADKSY — Database safety guard (R3-C.2.1 + R3-C.8)

Goal: it must be impossible to run a database test or a maintenance command against Supabase, Production, a remote host or an unknown database **by accident**. The only target any guarded command can ever reach is the dedicated local test database:

`127.0.0.1` (or `localhost`) · port `5433` · database `adksy_r3c_test` · role `adksy_r3c_test`

## Architecture

| Layer | File | What it does |
|---|---|---|
| Guard logic (pure, fail-closed) | `src/lib/testing/dbSafetyGuard.ts` | Validates a URL / environment; scans the env **files** Prisma and Vite load; errors carry reason codes (and env-file *names*) only — never a URL, host, user or password |
| Vitest setup | `src/lib/testing/vitestDbGuard.setup.ts` (`setupFiles`) | Runs before every test file, so before any module-level `new PrismaClient()`. Scans `.env*` / `prisma/.env` (root derived from the file's location, not the cwd) and validates `DATABASE_URL` / `DIRECT_URL` when set |
| Shared env builder | `scripts/db/lib/guardedEnv.mjs` | Refuses unsafe env files and unsafe shell variables, rebuilds the DB environment from the private credentials file, strips external-service credentials, re-validates |
| Maintenance entry point | `scripts/db/guarded-prisma.mjs` (`npm run db:*`) | Fixed command table; no flag forwarding; destructive commands need `--confirm-local-test-db`; `--dry-run` supported |
| Test runner | `scripts/r3c/run-with-test-db.mjs` | Explicit test files only (no global run), sequential, only `migrate deploy|status` |

## npm scripts

| Script | Runs | Notes |
|---|---|---|
| `npm run db:check` | guard only | prints the validated target, no credentials |
| `npm run db:migrate:status` / `db:migrate:deploy` | `prisma migrate status` / `deploy` | local test DB only |
| `npm run db:push -- --confirm-local-test-db` | `prisma db push --skip-generate` | local test DB only |
| `npm run db:reset -- --confirm-local-test-db` | `prisma migrate reset --force --skip-seed --skip-generate` | local test DB only |
| `npm run db:seed -- --confirm-local-test-db` | `node prisma/seed.js` | local test DB only |
| `npm run db:studio` | `prisma studio` | local test DB only |

There is intentionally **no** `migrate dev` script and no way to target any other database through npm.

## Bypass paths and how each is handled

| Path | Handling | Residual |
|---|---|---|
| `npm run db:*` | Routed through the wrapper; a test asserts no `db:*` script calls Prisma or the seed directly | none |
| `DATABASE_URL` / `DIRECT_URL` exported in the shell | Guarded commands **refuse** unless it is exactly the authorized target; Vitest setup refuses too | none for guarded commands |
| `.env`, `.env.local`, `.env.test`, `.env.test.local`, `.env.development*`, `.env.production*` | Scanned in memory; a non-authorized target in any of them aborts the command / the test run | none |
| `prisma/.env` (auto-loaded by Prisma, invisible to Vite) | Scanned by the Vitest setup **and** by the wrappers, even when the shell has no DB variable | none for guarded commands |
| `DIRECT_URL` differing from `DATABASE_URL` | Both required; must describe the same target | none |
| URL parameters (`host=`, `hostaddr=`, `dbname=`, `options=`, `pgbouncer=`…) | Only `schema=public`, pool/timeout and `sslmode` accepted | none |
| Launching from another directory | Roots come from the script / setup file location | none |
| Direct `vitest run` | Setup file applies to every test file | none |
| **Direct Prisma CLI (`npx prisma migrate dev`, `npx prisma db push`, …)** | **Cannot be intercepted by repository code.** It reads the shell or the env files; env files are guarded only when a guarded command or a Vitest run happens | **Open:** run Prisma only through `npm run db:*`. Never export a remote `DATABASE_URL` in a shell used for development |
| The application's own runtime (Next.js / Vercel) | Out of scope: it must use its deployment variables | by design |
| A test that sets `process.env.DATABASE_URL` after the setup file | No such test exists (searched); would not be detected | **Open (low)** |
| libpq `PG*` variables | Prisma ignores them; not used by any guarded command | none |

## Using the local database
1. Start Ubuntu + the cluster: `wsl -d Ubuntu-22.04 -u root -- bash -c "pg_ctlcluster 14 adksy_r3c start && sleep 6000"` (background).
2. `npm run db:check`, then `node scripts/r3c/run-with-test-db.mjs vitest <explicit test files>`.
3. Stop: `pg_ctlcluster 14 adksy_r3c stop`, then `wsl --terminate Ubuntu-22.04`.

Credentials: `/home/cheik/.adksy-r3c/pgpass` (mode 600, outside the repository); override the path for tests with `ADKSY_R3C_PGPASS_FILE`. They are never printed or written into the repository.

## Plan seed on a real database (`prisma/seed-plans-production.js`)

This is the only seed meant for a real environment (it creates missing `Plan` rows, never modifies an existing one). It is **never run by the tests or by Claude**. A write needs, all at once:

1. `ALLOW_PRODUCTION_PLAN_SEED=true`;
2. the **full target named by the operator**: `PLAN_SEED_EXPECTED_DB_HOST`, `PLAN_SEED_EXPECTED_DB_PORT`, `PLAN_SEED_EXPECTED_DB_NAME`, each equal to host / port / database name of `DATABASE_URL` (a hostname alone is not accepted: several databases can share a server). Never hardcoded: copy them from a dry run, which prints only `host / port / name`.

It refuses (exit code 2, before any client or connection is created) a missing or invalid expected value, any mismatch, an ambiguous URL (`host=`, `hostaddr=`, `port=`, `dbname=`, `options=`, `service=` ..., several hosts, no database, non-postgres scheme), a `DIRECT_URL` for another target, any `.env` / `prisma/.env` file naming another target, and any internal failure of the check. Messages are fixed sentences: no URL, user, password or parameter value.

Procedure: `node prisma/seed-plans-production.js --dry-run` -> read the target -> run with the four variables set for that one command -> unset them.
