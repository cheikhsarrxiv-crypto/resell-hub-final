/**
 * Static/structural tests for
 * prisma/migrations/20261012120000_fix_reserve_product_stock/migration.sql.
 *
 * These tests read the migration file as TEXT and assert properties of
 * its SOURCE (statement ordering, presence of guard clauses, preserved
 * signatures) via string/position checks. They do NOT execute any SQL,
 * connect to any database, or run Docker/Prisma — they cannot prove the
 * migration actually behaves this way on a real PostgreSQL engine, only
 * that its code is structured the way this file claims. Real behavior
 * (the two guards actually aborting, atomicity under real concurrency,
 * the CHECK constraint actually firing) is only provable by
 * tests/integration/stock-service.postgres.test.ts against a real local
 * PostgreSQL — never executed in this session either; see that file.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  readStockMigrationSql,
  extractCreateFunctionStatement,
  extractAddCheckConstraintStatement,
} from '@/lib/testing/stockMigrationSql';

let source: string;
/** Same file, with every `-- ...` line comment stripped. All structural
 * (position/order/absence) assertions below use this instead of the raw
 * source — the migration's own explanatory comments describe these same
 * guards in prose (mentioning "RAISE EXCEPTION", "SECURITY DEFINER", etc.
 * by name to say what is/isn't used), which would otherwise make a naive
 * search match the comment instead of the real SQL it's checking for. */
let code: string;

beforeAll(() => {
  source = readStockMigrationSql();
  code = source
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
});

function indexOfOrThrow(haystack: string, needle: string, label: string): number {
  const idx = haystack.indexOf(needle);
  if (idx === -1) {
    throw new Error(`Expected to find ${label} ("${needle}") in migration.sql, but it was not present.`);
  }
  return idx;
}

describe('stock migration — guard 1 (refuse to silently replace an unknown existing function)', () => {
  it('checks for an existing same-signature function, raises, and only then creates the new one — in that code order', () => {
    const block = extractCreateFunctionStatement(code);

    const checkIdx = indexOfOrThrow(block, "to_regprocedure('reserve_product_stock(text, text, bigint)')", 'the signature check');
    const raiseIdx = indexOfOrThrow(block, 'RAISE EXCEPTION', 'a RAISE EXCEPTION');
    const executeIdx = indexOfOrThrow(block, 'EXECUTE $create_fn_sql$', 'the gated EXECUTE for CREATE FUNCTION');
    const createIdx = indexOfOrThrow(block, 'CREATE FUNCTION reserve_product_stock', 'the CREATE FUNCTION statement');

    expect(checkIdx).toBeLessThan(raiseIdx);
    expect(raiseIdx).toBeLessThan(executeIdx);
    expect(executeIdx).toBeLessThan(createIdx);
  });

  it('never drops any function (does not remove other, differently-signed overloads)', () => {
    expect(code).not.toMatch(/DROP\s+FUNCTION/i);
  });

  it('CREATE FUNCTION is not a bare top-level statement outside the guard (no stray "CREATE OR REPLACE FUNCTION")', () => {
    // The old, unguarded version used CREATE OR REPLACE as a standalone
    // top-level statement; the guarded version creates it only via the
    // nested EXECUTE above, as a plain CREATE (never OR REPLACE, since
    // guard 1 already proved no same-signature function exists).
    expect(code).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
  });
});

describe('stock migration — guard 2 (refuse to add the CHECK constraint over already-invalid data)', () => {
  it('counts negative-quantity rows, raises, and only then adds the constraint — in that code order', () => {
    const block = extractAddCheckConstraintStatement(code);

    const countIdx = indexOfOrThrow(block, 'quantity < 0', 'the negative-quantity count check');
    const raiseIdx = indexOfOrThrow(block, 'RAISE EXCEPTION', 'a RAISE EXCEPTION');
    const executeIdx = indexOfOrThrow(block, 'EXECUTE $add_check_sql$', 'the gated EXECUTE for ADD CONSTRAINT');
    const addConstraintIdx = indexOfOrThrow(block, 'ADD CONSTRAINT product_quantity_non_negative', 'the ADD CONSTRAINT statement');

    expect(countIdx).toBeLessThan(raiseIdx);
    expect(raiseIdx).toBeLessThan(executeIdx);
    expect(executeIdx).toBeLessThan(addConstraintIdx);
  });

  it('never corrects or deletes the offending rows itself (no DELETE, no corrective UPDATE, inside this guard)', () => {
    const block = extractAddCheckConstraintStatement(code);
    expect(block).not.toMatch(/DELETE\s+FROM/i);
    expect(block).not.toMatch(/UPDATE\s+"Product"/i); // the function's own UPDATE lives in guard 1's block, not here
  });
});

describe('single source of truth — the real-PostgreSQL integration test has no SQL copy of its own', () => {
  let integrationTestSource: string;

  beforeAll(() => {
    integrationTestSource = fs.readFileSync(
      path.join(process.cwd(), 'tests/integration/stock-service.postgres.test.ts'),
      'utf-8'
    );
  });

  it('imports the shared reader/extractors instead of hand-typing the migration SQL', () => {
    expect(integrationTestSource).toMatch(/from ['"]@\/lib\/testing\/stockMigrationSql['"]/);
    expect(integrationTestSource).toContain('readStockMigrationSql');
    expect(integrationTestSource).toContain('extractCreateFunctionStatement');
    expect(integrationTestSource).toContain('extractAddCheckConstraintStatement');
  });

  it('has no independent copy of the function body or constraint (would silently drift from migration.sql if it did)', () => {
    expect(integrationTestSource).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+reserve_product_stock/i);
    expect(integrationTestSource).not.toMatch(/ADD\s+CONSTRAINT\s+product_quantity_non_negative/i);
    expect(integrationTestSource).not.toContain('RETURN QUERY'); // only appears inside the function body itself
  });
});

describe('stock migration — preserved properties', () => {
  it('still has no SECURITY DEFINER clause (runs as SECURITY INVOKER, the Postgres default)', () => {
    expect(code).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it('still takes exactly three parameters, in order: productId, workspaceId, quantity', () => {
    const paramBlockMatch = code.match(/CREATE FUNCTION reserve_product_stock\(([\s\S]*?)\)/);
    expect(paramBlockMatch).not.toBeNull();
    const params = paramBlockMatch![1];
    const pProductIdx = params.indexOf('p_product_id TEXT');
    const pWorkspaceIdx = params.indexOf('p_workspace_id TEXT');
    // BIGINT, not INTEGER: confirmed by a real local PostgreSQL run that
    // Prisma's $queryRaw sends 0/negative integer literals as int8 while
    // positive ones are sent as int4 — see the comment above guard 1 in
    // migration.sql. BIGINT accepts both via PostgreSQL's ordinary
    // implicit int4→int8 widening.
    const pQuantityIdx = params.indexOf('p_quantity BIGINT');
    expect(pProductIdx).toBeGreaterThanOrEqual(0);
    expect(pProductIdx).toBeLessThan(pWorkspaceIdx);
    expect(pWorkspaceIdx).toBeLessThan(pQuantityIdx);
  });

  it('still returns exactly the columns StockService.ts expects, with "newQuantity" quoted camelCase', () => {
    expect(code).toContain('RETURNS TABLE (success BOOLEAN, message TEXT, "newQuantity" INTEGER)');
  });

  it('is still declared LANGUAGE plpgsql', () => {
    expect(code).toMatch(/LANGUAGE\s+plpgsql/i);
  });

  it('still performs the reservation as a single atomic UPDATE ... RETURNING statement (no semicolon splits the check from the write)', () => {
    const updateIdx = indexOfOrThrow(code, 'UPDATE "Product"', 'the reservation UPDATE');
    const returningIdx = indexOfOrThrow(code, 'RETURNING TRUE', 'its RETURNING clause');
    expect(updateIdx).toBeLessThan(returningIdx);
    const between = code.slice(updateIdx, returningIdx);
    expect(between).not.toContain(';'); // same statement: no terminator between the write and its RETURNING
  });

  it('still rejects null/zero/negative quantity before touching any row', () => {
    expect(code).toMatch(/IF\s+p_quantity\s+IS\s+NULL\s+OR\s+p_quantity\s*<=\s*0\s+THEN/i);
  });
});
