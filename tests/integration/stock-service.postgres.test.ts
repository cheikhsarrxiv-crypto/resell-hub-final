/**
 * Stock-reservation hardening — REAL PostgreSQL integration tests.
 *
 * Unlike src/services/__tests__/StockService.test.ts (mocked prisma, no
 * database), these tests run reserve_product_stock() against an actual
 * PostgreSQL instance, to validate what a mock cannot: atomicity under
 * real concurrency, the CHECK constraint, and the function's exact SQL
 * semantics (quoted "Product"/"workspaceId", 3-argument signature).
 *
 * NEVER RUN AGAINST A REMOTE/SUPABASE DATABASE. assertIntegrationDatabaseEnv()
 * below throws — synchronously, before any PrismaClient is constructed —
 * unless BOTH DATABASE_URL and DIRECT_URL resolve (via real URL parsing,
 * not a substring/regex check on the raw string) to exactly
 * localhost/127.0.0.1/::1, port 5433, database "stock_test". An invalid
 * configuration aborts test collection itself with a non-zero exit code;
 * it never silently degrades to describe.skip (which would exit 0 and
 * look like a pass). See src/lib/testing/localDatabaseGuard.ts and its
 * tests for why both variables are checked (Prisma's schema-changing
 * commands, like `prisma db push`, use DIRECT_URL preferentially; only
 * guarding DATABASE_URL would leave a stale DIRECT_URL able to redirect
 * schema changes to a real database even though DATABASE_URL looks safe).
 *
 * This file was written but has NEVER been executed in this session (no
 * database connection was made while preparing it — see the mission's
 * explicit restrictions). Running it requires the manual setup below, or
 * scripts/run-stock-integration-tests.sh, which automates it with safe,
 * ownership-checked Docker container creation/cleanup.
 *
 * ---------------------------------------------------------------------
 * HOW TO RUN (manual, after separate authorization — not run from here):
 *
 *   docker run -d --name adksy-stock-test \
 *     -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=stock_test \
 *     -p 5433:5432 postgres:15-alpine
 *
 *   export DATABASE_URL="postgresql://test:test@localhost:5433/stock_test"
 *   export DIRECT_URL="$DATABASE_URL"
 *   npx prisma db push          # creates tables from schema.prisma (no app data)
 *
 *   npm run test:integration:postgres
 *
 *   docker rm -f adksy-stock-test   # teardown when done
 *
 * Or simply: bash scripts/run-stock-integration-tests.sh
 * ---------------------------------------------------------------------
 *
 * This file does NOT keep its own copy of the function/constraint SQL —
 * it reads prisma/migrations/20261012120000_fix_reserve_product_stock/
 * migration.sql directly (via src/lib/testing/stockMigrationSql.ts) and
 * executes exactly those statements, unmodified. A hand-typed duplicate
 * here could silently drift from the real migration the moment either
 * one changed alone; reading the file directly cannot drift, by
 * construction — see src/lib/testing/__tests__/stockMigrationGuards.test.ts's
 * "single source of truth" tests, which fail if this file ever grows its
 * own independent copy again.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertIntegrationDatabaseEnv } from '@/lib/testing/localDatabaseGuard';
import {
  readStockMigrationSql,
  extractCreateFunctionStatement,
  extractAddCheckConstraintStatement,
} from '@/lib/testing/stockMigrationSql';

// Throws and aborts collection of this file entirely if invalid — no
// PrismaClient is constructed and no describe/it below ever runs in
// that case, so an invalid configuration never results in any database
// connection attempt.
assertIntegrationDatabaseEnv(process.env);

describe('reserve_product_stock() — real PostgreSQL', () => {
  const prisma = new PrismaClient();
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    // Idempotency for re-running against the same already-up throwaway
    // container (scripts/run-stock-integration-tests.sh always creates a
    // fresh one per invocation, so it doesn't need this — but a
    // developer iterating locally against one container they're keeping
    // up between runs does). This drops only what THIS exact migration
    // itself would have created on a prior run, by its own exact name/
    // signature — it does not simulate or fake any unknown prior
    // function or constraint. The migration's own "does this already
    // exist?" guards are still real and still run below: on a genuinely
    // fresh container (nothing dropped because nothing existed yet),
    // they see no pre-existing function and no negative-quantity rows,
    // and proceed to create/add for real — the same guard logic a first
    // real run would exercise, not an artificially pre-seeded scenario.
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reserve_product_stock(text, text, integer);');
    await prisma.$executeRawUnsafe('ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS product_quantity_non_negative;');

    const migrationSql = readStockMigrationSql();
    await prisma.$executeRawUnsafe(extractCreateFunctionStatement(migrationSql));
    await prisma.$executeRawUnsafe(extractAddCheckConstraintStatement(migrationSql));

    const user = await prisma.user.create({
      data: {
        email: `stock-integration-${Date.now()}@example.test`,
        name: 'Stock Integration Test',
        password: 'test-only-not-used-for-login',
      },
    });
    userId = user.id;

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Stock Integration Test Workspace',
        slug: `stock-integration-${Date.now()}`,
        country: 'US',
        userId,
      },
    });
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function createProduct(quantity: number) {
    return prisma.product.create({
      data: {
        workspaceId,
        sku: `STOCK-IT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: 'Stock Integration Test Product',
        description: 'Created by stock-service.postgres.test.ts',
        quantity,
        purchasePrice: 10,
        sellingPrice: 20,
      },
    });
  }

  it('reserves stock when sufficient, decrementing by exactly the requested quantity', async () => {
    const product = await createProduct(5);

    const [result] = await prisma.$queryRaw<
      Array<{ success: boolean; message: string; newQuantity: number | null }>
    >`SELECT * FROM reserve_product_stock(${product.id}, ${workspaceId}, 2)`;

    expect(result.success).toBe(true);
    expect(result.newQuantity).toBe(3);

    const reloaded = await prisma.product.findUnique({ where: { id: product.id } });
    expect(reloaded?.quantity).toBe(3);
  });

  it('fails cleanly, with no row changed, when stock is insufficient', async () => {
    const product = await createProduct(1);

    const result = await prisma.$queryRaw<
      Array<unknown>
    >`SELECT * FROM reserve_product_stock(${product.id}, ${workspaceId}, 5)`;

    expect(result).toHaveLength(0); // StockService.ts treats this as "Failed to reserve stock"

    const reloaded = await prisma.product.findUnique({ where: { id: product.id } });
    expect(reloaded?.quantity).toBe(1); // unchanged
  });

  it('fails cleanly for a nonexistent product, with no error thrown', async () => {
    const result = await prisma.$queryRaw<
      Array<unknown>
    >`SELECT * FROM reserve_product_stock('does-not-exist', ${workspaceId}, 1)`;
    expect(result).toHaveLength(0);
  });

  it('fails cleanly when the product belongs to a different workspace', async () => {
    const product = await createProduct(5);

    const result = await prisma.$queryRaw<
      Array<unknown>
    >`SELECT * FROM reserve_product_stock(${product.id}, 'some-other-workspace-id', 1)`;
    expect(result).toHaveLength(0);

    const reloaded = await prisma.product.findUnique({ where: { id: product.id } });
    expect(reloaded?.quantity).toBe(5); // unchanged — proves the function enforces workspaceId itself
  });

  it.each([0, -1, -100])('rejects invalid quantity %i inside the SQL function itself', async (qty) => {
    const product = await createProduct(5);

    const [result] = await prisma.$queryRaw<
      Array<{ success: boolean; message: string }>
    >`SELECT * FROM reserve_product_stock(${product.id}, ${workspaceId}, ${qty})`;

    expect(result.success).toBe(false);
    expect(result.message).toBe('Invalid quantity');

    const reloaded = await prisma.product.findUnique({ where: { id: product.id } });
    expect(reloaded?.quantity).toBe(5); // unchanged
  });

  it('under two concurrent reservations for the last unit, exactly one succeeds', async () => {
    const product = await createProduct(1);

    const reserveOne = () =>
      prisma.$queryRaw<
        Array<{ success: boolean }>
      >`SELECT * FROM reserve_product_stock(${product.id}, ${workspaceId}, 1)`;

    const [r1, r2] = await Promise.all([reserveOne(), reserveOne()]);

    const successCount = [r1, r2].filter((r) => r.length === 1 && r[0].success).length;
    expect(successCount).toBe(1);

    const reloaded = await prisma.product.findUnique({ where: { id: product.id } });
    expect(reloaded?.quantity).toBe(0);
  });

  it('under five concurrent reservations for one unit, exactly one succeeds and stock never goes negative', async () => {
    const product = await createProduct(1);

    const attempts = Array.from({ length: 5 }, () =>
      prisma.$queryRaw<
        Array<{ success: boolean }>
      >`SELECT * FROM reserve_product_stock(${product.id}, ${workspaceId}, 1)`
    );
    const results = await Promise.all(attempts);

    const successCount = results.filter((r) => r.length === 1 && r[0].success).length;
    expect(successCount).toBe(1);

    const reloaded = await prisma.product.findUnique({ where: { id: product.id } });
    expect(reloaded?.quantity).toBe(0);
    expect(reloaded!.quantity).toBeGreaterThanOrEqual(0);
  });

  it('the CHECK constraint rejects a direct attempt to force negative stock, bypassing the function', async () => {
    const product = await createProduct(1);

    await expect(
      prisma.$executeRaw`UPDATE "Product" SET quantity = -1 WHERE id = ${product.id}`
    ).rejects.toThrow();

    const reloaded = await prisma.product.findUnique({ where: { id: product.id } });
    expect(reloaded?.quantity).toBe(1); // the failed UPDATE changed nothing
  });
});
