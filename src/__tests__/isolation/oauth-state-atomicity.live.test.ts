/**
 * B.11.1-R.2 — REAL PostgreSQL proof that consumeOAuthState() consumes a state exactly once, through the real
 * unique index of WebhookLog, under concurrency. No mock, no Map: the real function, the real Prisma client and
 * the dedicated local test database.
 *
 * Run ONLY through the guarded runner (refuses any other target; the Vitest setup guard also runs first):
 *   node scripts/r3c/run-with-test-db.mjs vitest src/__tests__/isolation/oauth-state-atomicity.live.test.ts
 *
 * Fixtures: two synthetic users/workspaces (`@r3c.invalid`) + one sentinel WebhookLog row of the foreign
 * workspace. Everything created here is recorded by exact id and deleted by exact id (no pattern, no table-wide
 * delete). A snapshot of all pre-existing WebhookLog rows is compared before and after.
 */
import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { enforceGuardForTestRun } from '@/lib/testing/dbSafetyGuard';
import { connectGuardedPrisma } from '@/lib/testing/r3cHarness';
import { consumeOAuthState, oauthStateLedgerEventId, OAUTH_STATE_LEDGER_MARKETPLACE } from '@/lib/oauthStateConsumption';

const guarded = enforceGuardForTestRun(process.env) === 'guarded';
const newState = () => crypto.randomBytes(32).toString('hex');

describe.skipIf(!guarded)('B.11.1-R.2 — oauth state single-use on real PostgreSQL', () => {
  let prisma: PrismaClient;
  const runId = `r3cr2${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const ids = { users: [] as string[], workspaces: [] as string[], sentinel: '' };
  let wsA = '';
  let wsB = '';
  let preexistingSnapshot = '';
  let preexistingCount = 0;
  let createdLedgerIds: string[] = [];
  const stateDigest: string[] = []; // the raw states used by this test (to assert they are never stored)

  const snapshotPreexisting = async () => {
    const rows = await prisma.webhookLog.findMany({
      where: { id: { notIn: [ids.sentinel, ...createdLedgerIds].filter(Boolean) }, workspaceId: { notIn: ids.workspaces } },
      orderBy: { id: 'asc' },
    });
    return { count: rows.length, hash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  };

  beforeAll(async () => {
    prisma = await connectGuardedPrisma(); // asserts host/port/database/user identity of the live connection
    const before = await snapshotPreexisting();
    preexistingCount = before.count;
    preexistingSnapshot = before.hash;
    for (const side of ['a', 'b'] as const) {
      const tag = `${runId}-${side}`;
      const user = await prisma.user.create({ data: { email: `${tag}@r3c.invalid`, name: `R3C R2 ${side}`, emailVerified: true } });
      ids.users.push(user.id);
      const ws = await prisma.workspace.create({ data: { name: `R3C R2 ${side}`, slug: tag, userId: user.id } });
      ids.workspaces.push(ws.id);
      if (side === 'a') wsA = ws.id; else wsB = ws.id;
    }
    const sentinel = await prisma.webhookLog.create({
      data: { workspaceId: wsB, marketplace: 'stripe', eventId: `evt_${runId}`, eventType: 'sentinel', payload: 'sentinel', status: 'processed' },
    });
    ids.sentinel = sentinel.id;
  });

  afterAll(async () => {
    // safety net if a test failed before the cleanup test ran: exact ids only
    try {
      if (ids.workspaces.length) {
        await prisma.webhookLog.deleteMany({ where: { workspaceId: { in: ids.workspaces } } });
        await prisma.workspace.deleteMany({ where: { id: { in: ids.workspaces } } });
      }
      if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    } finally {
      await prisma?.$disconnect();
    }
  });

  it('SQL: the unique index the function relies on really exists in the database', async () => {
    const idx = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'WebhookLog' and indexdef like 'CREATE UNIQUE%'`;
    const composite = idx.find((i) => i.indexdef.includes('("workspaceId", marketplace, "eventId")'));
    expect(composite, JSON.stringify(idx)).toBeDefined();
    const flags = await prisma.$queryRaw<Array<{ indisunique: boolean; indisvalid: boolean }>>`
      select i.indisunique, i.indisvalid from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = ${composite!.indexname}`;
    expect(flags[0]).toEqual({ indisunique: true, indisvalid: true });
    // eslint-disable-next-line no-console
    console.log(`[R.2] unique index in use: ${composite!.indexdef}`);
  });

  it('case 1 — normal: first consumption inserts a real row, the second is a replay', async () => {
    const state = newState(); stateDigest.push(state);
    expect(await consumeOAuthState({ workspaceId: wsA, marketplace: 'ebay', state })).toBe('consumed');
    expect(await consumeOAuthState({ workspaceId: wsA, marketplace: 'ebay', state })).toBe('replay');
    expect(await consumeOAuthState({ workspaceId: wsA, marketplace: 'ebay', state })).toBe('replay');
    const rows = await prisma.webhookLog.findMany({ where: { workspaceId: wsA, marketplace: OAUTH_STATE_LEDGER_MARKETPLACE, eventId: oauthStateLedgerEventId('ebay', state) } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventType: 'oauth_state.consumed', status: 'processed', payload: '{}', connectionId: null });
  });

  it('case 2 — concurrency: 10 simultaneous consumptions of the SAME state -> exactly 1 consumed, 9 replay, 1 row', async () => {
    const state = newState(); stateDigest.push(state);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => consumeOAuthState({ workspaceId: wsA, marketplace: 'ebay', state })));
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0); // no error other than the handled duplicate
    const values = results.map((r) => (r as PromiseFulfilledResult<string>).value);
    expect(values.filter((v) => v === 'consumed')).toHaveLength(1);
    expect(values.filter((v) => v === 'replay')).toHaveLength(9);
    const rows = await prisma.webhookLog.count({ where: { workspaceId: wsA, marketplace: OAUTH_STATE_LEDGER_MARKETPLACE, eventId: oauthStateLedgerEventId('ebay', state) } });
    expect(rows).toBe(1);
    // eslint-disable-next-line no-console
    console.log(`[R.2] 10-way race: consumed=${values.filter((v) => v === 'consumed').length} replay=${values.filter((v) => v === 'replay').length} rows=${rows}`);
  });

  it('case 2b — repeated races: 30 rounds x 10 simultaneous calls (300 calls) -> every round has exactly one winner', async () => {
    let consumed = 0; let replay = 0; let errors = 0;
    for (let round = 0; round < 30; round++) {
      const state = newState(); stateDigest.push(state);
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => consumeOAuthState({ workspaceId: wsA, marketplace: 'ebay', state })));
      errors += results.filter((r) => r.status === 'rejected').length;
      const values = results.filter((r): r is PromiseFulfilledResult<'consumed' | 'replay'> => r.status === 'fulfilled').map((r) => r.value);
      expect(values.filter((v) => v === 'consumed'), `round ${round}`).toHaveLength(1);
      consumed += values.filter((v) => v === 'consumed').length;
      replay += values.filter((v) => v === 'replay').length;
    }
    expect({ consumed, replay, errors }).toEqual({ consumed: 30, replay: 270, errors: 0 });
    // eslint-disable-next-line no-console
    console.log(`[R.2] 30 rounds: consumed=${consumed} replay=${replay} errors=${errors}`);
  });

  it('case 2c — the constraint itself, from 10 INDEPENDENT database connections (distinct backend processes)', async () => {
    const clients = Array.from({ length: 10 }, () => new PrismaClient());
    const eventId = `r2c:${crypto.randomBytes(16).toString('hex')}`;
    try {
      // warm every connection first so the 10 inserts really start together on 10 different backends
      const pids = await Promise.all(clients.map((c) => c.$queryRaw<Array<{ pid: number }>>`select pg_backend_pid() as pid`));
      const distinct = new Set(pids.map((r) => r[0].pid));
      expect(distinct.size).toBe(10);
      const outcomes = await Promise.all(
        clients.map(async (c, i) => {
          try {
            await c.webhookLog.create({ data: { workspaceId: wsA, marketplace: OAUTH_STATE_LEDGER_MARKETPLACE, eventId, eventType: `r2c.${i}`, payload: '{}', status: 'processed' } });
            return 'inserted';
          } catch (e) {
            return (e as { code?: string }).code === 'P2002' ? 'duplicate' : `other:${(e as { code?: string }).code}`;
          }
        })
      );
      expect(outcomes.filter((o) => o === 'inserted')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(9);
      // eslint-disable-next-line no-console
      console.log(`[R.2] 10 independent connections (${distinct.size} distinct backends): inserted=1 duplicate=9`);
    } finally {
      await Promise.all(clients.map((c) => c.$disconnect()));
    }
  });

  it('case 3 — independent states in parallel: each consumed exactly once, one row per state, no artificial collision', async () => {
    const states = Array.from({ length: 12 }, () => newState());
    stateDigest.push(...states);
    const results = await Promise.all(states.map((state) => consumeOAuthState({ workspaceId: wsA, marketplace: 'ebay', state })));
    expect(results.every((r) => r === 'consumed')).toBe(true);
    const rows = await prisma.webhookLog.findMany({ where: { workspaceId: wsA, marketplace: OAUTH_STATE_LEDGER_MARKETPLACE, eventId: { in: states.map((s) => oauthStateLedgerEventId('ebay', s)) } } });
    expect(rows).toHaveLength(12);
    // the same states a second time, all in parallel: all replays
    const again = await Promise.all(states.map((state) => consumeOAuthState({ workspaceId: wsA, marketplace: 'ebay', state })));
    expect(again.every((r) => r === 'replay')).toBe(true);
  });

  it('keys are scoped: the same state value under another marketplace or another workspace is an independent flow', async () => {
    const state = newState(); stateDigest.push(state);
    expect(await consumeOAuthState({ workspaceId: wsA, marketplace: 'ebay', state })).toBe('consumed');
    expect(await consumeOAuthState({ workspaceId: wsA, marketplace: 'etsy', state })).toBe('consumed');
    expect(await consumeOAuthState({ workspaceId: wsB, marketplace: 'ebay', state })).toBe('consumed');
    expect(await consumeOAuthState({ workspaceId: wsA, marketplace: 'ebay', state })).toBe('replay');
    expect(await consumeOAuthState({ workspaceId: wsB, marketplace: 'ebay', state })).toBe('replay');
  });

  it('fail closed on a real database error: a workspace that does not exist (foreign key) is NOT reported as a replay', async () => {
    await expect(consumeOAuthState({ workspaceId: `${runId}-missing-workspace`, marketplace: 'ebay', state: newState() })).rejects.toBeDefined();
  });

  it('case 4 — isolation: rows belong to the fixture workspaces only, hold no raw state, and the sentinel and pre-existing rows are untouched', async () => {
    const mine = await prisma.webhookLog.findMany({ where: { marketplace: OAUTH_STATE_LEDGER_MARKETPLACE, workspaceId: { in: ids.workspaces } } });
    createdLedgerIds = mine.map((r) => r.id);
    expect(mine.length).toBeGreaterThan(0);
    // no oauth_state row anywhere else produced by this run: every row whose eventId carries one of our hashes is in our workspaces
    const everywhere = await prisma.webhookLog.findMany({ where: { marketplace: OAUTH_STATE_LEDGER_MARKETPLACE, workspaceId: { notIn: ids.workspaces } } });
    for (const row of everywhere) expect(stateDigest.some((s) => row.eventId === oauthStateLedgerEventId('ebay', s))).toBe(false);
    // no raw state stored, in any column
    const dump = JSON.stringify(mine);
    for (const s of stateDigest) expect(dump).not.toContain(s);
    // rows written by consumeOAuthState carry only '<marketplace>:<sha256>' (the 2c rows are this test's own raw inserts)
    for (const row of mine.filter((r) => r.eventType === 'oauth_state.consumed')) expect(row.eventId).toMatch(/^(ebay|etsy):[0-9a-f]{64}$/);
    // the foreign workspace only holds its own sentinel plus the independent flow of the scoping test
    const sentinel = await prisma.webhookLog.findUnique({ where: { id: ids.sentinel } });
    expect(sentinel).toMatchObject({ workspaceId: wsB, marketplace: 'stripe', eventType: 'sentinel', payload: 'sentinel', status: 'processed' });
    const after = await snapshotPreexisting();
    expect({ count: after.count, hash: after.hash }).toEqual({ count: preexistingCount, hash: preexistingSnapshot });
    // eslint-disable-next-line no-console
    console.log(`[R.2] ledger rows created=${mine.length}; pre-existing rows untouched=${after.count}`);
  });

  it('case 5 — cleanup: exactly the recorded rows are deleted, pre-existing data is unchanged', async () => {
    const mine = await prisma.webhookLog.findMany({ where: { workspaceId: { in: ids.workspaces } }, select: { id: true } });
    const exactIds = mine.map((r) => r.id); // includes the sentinel: all belong to the fixture workspaces
    expect(exactIds).toContain(ids.sentinel);
    for (const id of createdLedgerIds) expect(exactIds).toContain(id);
    const deleted = await prisma.webhookLog.deleteMany({ where: { id: { in: exactIds } } });
    expect(deleted.count).toBe(exactIds.length);
    await prisma.workspace.deleteMany({ where: { id: { in: ids.workspaces } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });

    expect(await prisma.webhookLog.count({ where: { id: { in: exactIds } } })).toBe(0);
    expect(await prisma.workspace.count({ where: { id: { in: ids.workspaces } } })).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: ids.users } } })).toBe(0);
    const after = await snapshotPreexisting();
    expect({ count: after.count, hash: after.hash }).toEqual({ count: preexistingCount, hash: preexistingSnapshot });
    // eslint-disable-next-line no-console
    console.log(`[R.2] cleanup: deleted ${deleted.count} ledger rows by exact id, ${ids.workspaces.length} workspaces, ${ids.users.length} users; pre-existing rows unchanged (${after.count})`);
    ids.workspaces = []; ids.users = []; // nothing left for the safety net
  });
});
