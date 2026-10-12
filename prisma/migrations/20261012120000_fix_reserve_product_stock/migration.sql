-- Stock-reservation hardening: reserve_product_stock() previously existed
-- only as inconsistent documentation (three contradictory versions across
-- STOCK_RACE_CONDITION_AUDIT.md, STOCK_RACE_CONDITION_TEST_GUIDE.md and
-- POSTGRES_REAL_TEST_GUIDE.md — mismatched argument counts, unquoted
-- lowercase table/column names, or a non-executable body) and was never
-- present in any tracked migration. This creates the real function the
-- application actually calls (StockService.ts, 3-argument signature:
-- productId, workspaceId, quantity), plus the non-negative-stock
-- safeguard the same audit found missing from every tracked migration.
--
-- NOT applied to any database from this environment: no network route to
-- any Postgres instance here, and this preparation was explicitly scoped
-- to local files only. Prepared for review and for manual application
-- against a local/isolated test database first; must stay unapplied
-- against any shared/staging/production database until separately,
-- explicitly authorized.
--
-- Both guards below are automated (not just documented): this migration
-- aborts itself with RAISE EXCEPTION, before touching anything, if either
-- precondition fails. Neither guard drops, replaces, or corrects anything
-- on its own — an operator who hits one of these exceptions must resolve
-- the real cause by hand (inspect the conflicting function, or the
-- offending rows) and only then re-run this migration.
--
-- The dangerous statement in each case (CREATE FUNCTION / ADD CONSTRAINT)
-- is nested as dynamic SQL (EXECUTE) *inside* the same DO block as its
-- precondition check, deliberately not left as a separate top-level
-- statement after it. This holds regardless of whatever transaction
-- behavior the migration runner applies to the file as a whole (not
-- independently verified in this session — see the migration-tooling
-- note at the end of this file): even if a RAISE EXCEPTION somehow didn't
-- abort/rollback the rest of the script under some runner, the gated
-- statement still can't execute, because it was never a statement of its
-- own to begin with.

-- Guard 1: refuse to silently replace an unknown pre-existing function of
-- the exact same signature this migration creates. CREATE OR REPLACE
-- FUNCTION only ever replaces a function with an identical parameter-type
-- signature — a different signature (e.g. the 2-argument or differently-
-- ordered 3-argument versions found only in prose docs, never in a
-- tracked migration) would be left as a separate overload, untouched,
-- which this guard does not change. It also never drops any such other
-- overload itself.
--
-- p_quantity is BIGINT, not INTEGER: confirmed by a real local PostgreSQL
-- run that Prisma's $queryRaw sends 0/negative integer literals to
-- Postgres typed as int8 (bigint), while positive integer literals are
-- sent as int4 (integer) — an inconsistency in Prisma's own raw-query
-- parameter type inference, not a choice made here. PostgreSQL's
-- function-overload resolution does not implicitly narrow bigint to
-- integer, so a strictly-INTEGER parameter made calls with 0/-1/-100
-- fail with "function ... does not exist" instead of reaching this
-- function's own IF p_quantity <= 0 check below. BIGINT accepts both
-- shapes: an int4 argument still resolves via PostgreSQL's ordinary
-- implicit int4→int8 widening, so real application calls (always a
-- validated positive integer by the time StockService.ts reaches this
-- function) are unaffected.
DO $create_function$
BEGIN
  IF to_regprocedure('reserve_product_stock(text, text, bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'reserve_product_stock(text, text, bigint) already exists with an unknown function body. Refusing to silently replace it. Inspect it manually (for example, in psql: \df+ reserve_product_stock), then either drop that exact signature yourself or adapt this migration, and re-run. This migration never drops or replaces an existing function automatically.';
  END IF;

  EXECUTE $create_fn_sql$
    CREATE FUNCTION reserve_product_stock(
      p_product_id TEXT,
      p_workspace_id TEXT,
      p_quantity BIGINT
    )
    RETURNS TABLE (success BOOLEAN, message TEXT, "newQuantity" INTEGER)
    LANGUAGE plpgsql
    AS $fn_body$
    BEGIN
      IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RETURN QUERY SELECT FALSE, 'Invalid quantity'::TEXT, NULL::INTEGER;
        RETURN;
      END IF;

      -- Atomic conditional UPDATE: product identity, workspace ownership
      -- and sufficient stock are all checked in the same WHERE clause as
      -- the write itself, under the row lock the UPDATE takes — no
      -- separate SELECT ... FOR UPDATE needed, and no window for a
      -- concurrent transaction to invalidate the check between reading
      -- and writing. Zero rows returned (and so success defaults out of
      -- this function entirely) covers: product doesn't exist, wrong
      -- workspace, or insufficient stock — StockService.ts already
      -- treats an empty result as "Failed to reserve stock". No
      -- SECURITY DEFINER clause: runs as SECURITY INVOKER (Postgres's
      -- default), under the caller's own privileges.
      RETURN QUERY
        UPDATE "Product"
        SET quantity = quantity - p_quantity
        WHERE id = p_product_id
          AND "workspaceId" = p_workspace_id
          AND quantity >= p_quantity
        RETURNING TRUE, 'Stock reserved'::TEXT, quantity;
    END;
    $fn_body$;
  $create_fn_sql$;
END;
$create_function$;

-- Guard 2: refuse to add CHECK (quantity >= 0) over data that already
-- violates it. ADD CONSTRAINT validates against every existing row and
-- would otherwise fail outright with Postgres's own generic error; this
-- raises a clearer one first and, either way, never corrects or deletes
-- the offending rows itself — that decision is left to a human.
DO $add_check_constraint$
DECLARE
  v_negative_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_negative_count FROM "Product" WHERE quantity < 0;

  IF v_negative_count > 0 THEN
    RAISE EXCEPTION 'Refusing to add CHECK (quantity >= 0) on "Product": % existing row(s) already violate it. Investigate and resolve them manually — this migration never corrects or deletes data automatically. Re-run only after they are fixed.', v_negative_count;
  END IF;

  EXECUTE $add_check_sql$
    ALTER TABLE "Product" ADD CONSTRAINT product_quantity_non_negative CHECK (quantity >= 0)
  $add_check_sql$;
END;
$add_check_constraint$;

-- Migration-tooling note: CREATE FUNCTION, ALTER TABLE ... ADD CONSTRAINT,
-- and DO blocks (with RAISE EXCEPTION / dynamic EXECUTE) are all ordinary
-- transactional DDL/PL/pgSQL in PostgreSQL itself — nothing here is a
-- non-transactional operation like CREATE INDEX CONCURRENTLY. What is
-- NOT independently verified in this session is whether Prisma's own
-- migration runner (`prisma migrate deploy`/`dev`) wraps this entire
-- file in one all-or-nothing transaction, or applies it some other way —
-- confirming that would require either reading Prisma's current
-- documentation or actually running a migration against a real
-- database, neither available here. The two guards above are written to
-- be safe either way, since each dangerous statement is nested inside
-- the same DO block as its own precondition check (see the note at the
-- top of this file) — not relying on any particular transaction
-- behavior at the whole-file level.
