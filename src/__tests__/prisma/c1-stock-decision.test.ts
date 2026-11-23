/**
 * C1 — evidence-based decision about reserve_product_stock() / CHECK (quantity >= 0).
 * Static checks only: no database, no network, no migration.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const migrationsDir = path.join(ROOT, 'prisma/migrations');
const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const allSql = migrationFolders.map((m) => ({ m, sql: readFileSync(path.join(migrationsDir, m, 'migration.sql'), 'utf8') }));

describe('B — the committed migrations contain neither the function nor the CHECK', () => {
  it('there are 19 migrations (the 18 historical ones + S8 add_order_currency) and none is called stock_race_fix', () => {
    expect(migrationFolders).toHaveLength(19);
    expect(migrationFolders.some((m) => /stock_race/i.test(m))).toBe(false);
    expect(existsSync(path.join(migrationsDir, 'stock_race_fix'))).toBe(false);
  });
  it('no migration creates reserve_product_stock or any function', () => {
    for (const { m, sql } of allSql) {
      expect(/reserve_product_stock/i.test(sql), m).toBe(false);
      expect(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql), m).toBe(false);
    }
  });
  it('no migration adds a CHECK constraint (the only "CHECK" word is inside a comment)', () => {
    for (const { m, sql } of allSql) {
      const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      expect(/\bCHECK\b/i.test(code), m).toBe(false);
    }
  });
});

describe('A — what the current code really does', () => {
  it('the production sale paths reserve stock with ProductService.reserveInventory, never StockService', () => {
    for (const rel of ['src/services/OrderService.ts', 'src/services/marketplace/OrdersSyncService.ts']) {
      const src = read(rel);
      expect(src).toContain('ProductService.reserveInventory');
      expect(src).not.toMatch(/StockService\.(reserveStock|releaseStock)/);
    }
  });
  it('reserveInventory is one conditional UPDATE guarded by available >= quantity', () => {
    const src = read('src/services/ProductService.ts');
    const body = src.slice(src.indexOf('static async reserveInventory'), src.indexOf('static async releaseInventory'));
    expect(body).toMatch(/inventory\.updateMany/);
    expect(body).toMatch(/available:\s*\{\s*gte:\s*quantity\s*\}/);
    expect(body).toMatch(/Insufficient inventory/);
  });
  it('StockService is only used by the development-only test route (plus comments)', () => {
    const route = read('src/app/api/test/stock-race-condition/route.ts');
    expect(route).toContain("process.env.NODE_ENV !== 'development'");
    const importers: string[] = [];
    (function walk(dir: string) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
          if (/from ['"]@\/services\/StockService['"]/.test(readFileSync(p, 'utf8'))) importers.push(path.relative(ROOT, p).split(path.sep).join('/'));
        }
      }
    })(path.join(ROOT, 'src'));
    expect(importers).toEqual(['src/app/api/test/stock-race-condition/route.ts']);
  });
  it("StockService still calls the 2-argument SQL function that no migration creates, and now says so", () => {
    const src = read('src/services/StockService.ts');
    expect(src).toMatch(/reserve_product_stock\(\$\{productId\}, \$\{quantity\}\)/);
    expect(src).toContain('C1 NOTE');
    expect(src).toContain('NO migration in prisma/migrations creates');
  });
});

describe('documentation no longer asserts what the repository cannot prove', () => {
  it('the schema comment no longer claims the CHECK exists in production', () => {
    const schema = read('prisma/schema.prisma');
    expect(schema).not.toMatch(/\/\/ DB-level CHECK \(quantity >= 0\) exists in production/); // the original assertion is gone
    expect(schema).toContain('C6/C1 NOTE on a previous comment'); // ...and survives only as a quoted, refuted claim
    expect(schema).toContain('C1 decision: no migration is created');
    expect(schema).toContain('UNVERIFIED');
  });
  it.each([
    'AUDIT_STRICT_PHASE_2_9_3.md', 'FINAL_SECURITY_AUDIT.md', 'PHASE_2.8.1_BLOCKERS_STATUS.md', 'PHASE_2.8.1_COMPLETE_AUDIT.md',
    'PHASE_2.8.1_FINAL_AUDIT.md', 'PHASE_2.8.1_SUMMARY.md', 'PHASE_2.8.3_REAL_ENVIRONMENT_REPORT.md', 'POSTGRES_REAL_TEST_GUIDE.md',
    'STOCK_RACE_CONDITION_AUDIT.md', 'STOCK_RACE_CONDITION_TEST_GUIDE.md',
  ])('%s carries the correction banner', (rel) => {
    const head = read(rel).slice(0, 1200);
    expect(head).toContain('C1 CORRECTION');
    expect(head).toContain('ProductService.reserveInventory');
  });
  it('the AiUsageService comment no longer presents StockService as a proven precedent', () => {
    expect(read('src/services/ai/AiUsageService.ts')).toContain('that precedent is not');
  });
});

describe('C1 changed no structure', () => {
  it('the 18 historical migrations are unchanged; the only later one is the additive S8 order-currency column', () => {
    const sorted = [...migrationFolders].sort();
    expect(sorted[17]).toBe('20261008160000_make_user_password_nullable');
    expect(sorted[18]).toBe('20261121000000_add_order_currency');
    const sql = readFileSync(path.join(migrationsDir, sorted[18], 'migration.sql'), 'utf8')
      .split(String.fromCharCode(10)).filter((l) => !l.trim().startsWith('--')).join(String.fromCharCode(10)).trim();
    expect(sql).toBe('ALTER TABLE "Order" ADD COLUMN "currency" TEXT;');
  });
});
