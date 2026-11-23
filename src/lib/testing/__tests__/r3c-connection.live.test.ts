/**
 * R3-C.2.1 — LIVE connection check against the dedicated local PostgreSQL
 * test database. Run ONLY through the guarded runner:
 *
 *   node scripts/r3c/run-with-test-db.mjs vitest src/lib/testing/__tests__/r3c-connection.live.test.ts
 *
 * It only connects and reads metadata, inside a READ ONLY transaction. It
 * never creates, alters or deletes anything and never prints the connection
 * string. Without the guarded environment the whole file is skipped.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertRuntimeIdentity, enforceGuardForTestRun } from '../dbSafetyGuard';

// The setup file already aborts any run with a non-authorized DB target; this
// is the explicit, second check for this file.
const guarded = enforceGuardForTestRun(process.env) === 'guarded';

describe.skipIf(!guarded)('R3-C dedicated test database — connection and read-only metadata', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('connects to exactly the dedicated cluster (database, role, port)', async () => {
    const rows = await prisma.$queryRaw<Array<{ db: string; usr: string; port: number | null }>>`
      select current_database() as db, current_user as usr, inet_server_port() as port`;
    expect(rows).toHaveLength(1);
    assertRuntimeIdentity({ database: rows[0].db, user: rows[0].usr, port: rows[0].port });
  });

  it('the role is not a superuser and cannot create databases or roles', async () => {
    const rows = await prisma.$queryRaw<Array<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>>`
      select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user`;
    expect(rows[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false });
  });

  it('reads server metadata inside a READ ONLY transaction (no write possible)', async () => {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const version = await tx.$queryRaw<Array<{ v: string }>>`select split_part(version(), ' ', 2) as v`;
      const readOnly = await tx.$queryRaw<Array<{ ro: string }>>`select current_setting('transaction_read_only') as ro`;
      return { version: version[0].v, readOnly: readOnly[0].ro };
    });
    expect(result.version).toMatch(/^14\./);
    expect(result.readOnly).toBe('on');
  });

  it('cannot reach another database of the cluster', async () => {
    const rows = await prisma.$queryRaw<Array<{ can_postgres: boolean; can_template1: boolean }>>`
      select has_database_privilege(current_user, 'postgres', 'CONNECT') as can_postgres,
             has_database_privilege(current_user, 'template1', 'CONNECT') as can_template1`;
    expect(rows[0]).toEqual({ can_postgres: false, can_template1: false });
  });

  it('reports (does not assert) how many application tables exist', async () => {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      select count(*)::bigint as n from pg_tables where schemaname not in ('pg_catalog','information_schema')`;
    // Informational only: 0 before migrations, >0 after `prisma migrate deploy`.
    expect(typeof rows[0].n).toBe('bigint');
  });
});
