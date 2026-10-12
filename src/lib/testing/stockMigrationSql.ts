/**
 * Single source of truth for reading the stock-reservation migration's
 * SQL out of its one real location on disk, instead of letting any test
 * (static or real-PostgreSQL) keep its own hand-typed copy of the
 * function/constraint text. A copy can silently drift from the migration
 * it's supposed to mirror the moment either one is edited alone; reading
 * the file directly cannot drift, by construction.
 *
 * Pure file-reading/string-slicing only — no SQL execution, no database,
 * no Prisma. Used by:
 *   - src/lib/testing/__tests__/stockMigrationGuards.test.ts (static:
 *     asserts properties of the text these functions return)
 *   - tests/integration/stock-service.postgres.test.ts (real: executes
 *     the exact statements these functions extract, against a real
 *     local PostgreSQL — never run in this session)
 */
import fs from 'fs';
import path from 'path';

const MIGRATION_RELATIVE_PATH = 'prisma/migrations/20261012120000_fix_reserve_product_stock/migration.sql';

export function readStockMigrationSql(cwd: string = process.cwd()): string {
  return fs.readFileSync(path.join(cwd, MIGRATION_RELATIVE_PATH), 'utf-8');
}

function extractDoBlock(sql: string, openTag: string, closeTag: string, label: string): string {
  const start = sql.indexOf(openTag);
  if (start === -1) {
    throw new Error(`Could not find "${openTag}" (${label}) in the stock migration SQL.`);
  }
  const closeIdx = sql.indexOf(closeTag, start);
  if (closeIdx === -1) {
    throw new Error(`Found "${openTag}" but not its closing "${closeTag}" (${label}) in the stock migration SQL.`);
  }
  return sql.slice(start, closeIdx + closeTag.length);
}

/** The guard-1 DO block: checks for an existing same-signature function, then creates it. */
export function extractCreateFunctionStatement(sql: string): string {
  return extractDoBlock(sql, 'DO $create_function$', '$create_function$;', 'guard 1 / CREATE FUNCTION');
}

/** The guard-2 DO block: checks for pre-existing negative quantities, then adds the CHECK constraint. */
export function extractAddCheckConstraintStatement(sql: string): string {
  return extractDoBlock(sql, 'DO $add_check_constraint$', '$add_check_constraint$;', 'guard 2 / ADD CONSTRAINT');
}
