/**
 * B.11.1-R — the OAuth state must be SINGLE-USE on the server, not only deleted from the browser.
 *
 * The real callback route runs with a mocked session, workspace check, plan limit, connection service and a
 * Prisma mock whose `webhookLog.create` enforces the real unique key (workspaceId, marketplace, eventId) of the
 * schema (atomic: a second insert of the same key throws P2002, exactly like the database would). No network,
 * no database, no OAuth.
 *
 * "Replay" = the SAME callback URL with the SAME cookie value presented again, i.e. a copy of the cookie that
 * the browser's delete instruction does not reach (second tab, exfiltrated cookie, proxy, parallel request).
 */
import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { authMock, verifyWorkspaceAccessMock, handleOAuthCallbackMock, getConnectionMock, isLimitReachedMock, ledger, createMock } = vi.hoisted(() => {
  const ledger = new Map<string, any>();
  return {
    authMock: vi.fn(),
    verifyWorkspaceAccessMock: vi.fn(),
    handleOAuthCallbackMock: vi.fn(),
    getConnectionMock: vi.fn(),
    isLimitReachedMock: vi.fn(),
    ledger,
    // atomic like a unique index: check + insert with no await in between
    createMock: vi.fn(async ({ data }: any) => {
      const key = `${data.workspaceId}|${data.marketplace}|${data.eventId}`;
      if (ledger.has(key)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      ledger.set(key, data);
      return { id: key, ...data };
    }),
  };
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/security', async (importOriginal) => ({ ...(await importOriginal<any>()), verifyWorkspaceAccess: verifyWorkspaceAccessMock }));
vi.mock('@/services/SubscriptionService', () => ({ SubscriptionService: { isLimitReached: isLimitReachedMock } }));
vi.mock('@/lib/prisma', () => ({ prisma: { webhookLog: { create: createMock } } }));
vi.mock('@/services/marketplace/MarketplaceConnectionService', () => ({
  MarketplaceConnectionService: class {
    constructor(public config: unknown) {}
    getConnection = getConnectionMock;
    handleOAuthCallback = handleOAuthCallbackMock;
  },
}));

import { NextRequest } from 'next/server';
import { createBoundStateCookieValue, OAUTH_STATE_TTL_SECONDS } from '@/lib/oauthStateBinding';
import * as callbackRoute from '@/app/api/marketplace/callback/[marketplace]/route';

const STATE = 'c'.repeat(64);
const WS_A = 'ws-A';
const WS_B = 'ws-B';
const subject = (o: Partial<{ workspaceId: string; userId: string }> = {}) => ({ marketplace: 'ebay', workspaceId: WS_A, userId: 'user-A', ...o });
const login = (workspaceId = WS_A, id = 'user-A') => authMock.mockResolvedValue({ user: { id, workspaceId } });

const call = (cookie: string | undefined, query = `code=code123&state=${STATE}`) =>
  callbackRoute.GET(
    new NextRequest(`https://preview.example.test/api/marketplace/callback/ebay?${query}`, { headers: cookie ? { cookie: `oauth_state_ebay=${cookie}` } : {} }),
    { params: { marketplace: 'ebay' } }
  );
const location = (r: Response) => r.headers.get('location') ?? '';

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  Object.assign(process.env, {
    EBAY_SANDBOX_MODE: 'true', EBAY_CLIENT_ID: 'Adksy-Adksy-SBX-0123456789-abcdef01', EBAY_CLIENT_SECRET: 'SBX-secret-not-real', EBAY_REDIRECT_URI: 'Adksy-Adksy-Adksy-abcdefg',
  });
  delete process.env.VERCEL_ENV;
  delete process.env.NEXTAUTH_URL;
  ledger.clear();
  vi.clearAllMocks();
  verifyWorkspaceAccessMock.mockImplementation(async (id: string) => id);
  isLimitReachedMock.mockResolvedValue(false);
  getConnectionMock.mockResolvedValue(null);
  handleOAuthCallbackMock.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 5)); // lets a concurrent callback interleave, like a real HTTP exchange
    return { connectionId: 'c', marketplace: 'ebay', status: 'connected' };
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('single-use state: the server remembers a consumed state (not only the browser)', () => {
  it('normal callback: one exchange, connected', async () => {
    login();
    const cookie = createBoundStateCookieValue(STATE, subject());
    const res = await call(cookie);
    expect(location(res)).toContain('status=connected');
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
  });

  it('REPLAY after a successful callback: the SAME cookie value + SAME url is refused, still exactly ONE exchange', async () => {
    login();
    const cookie = createBoundStateCookieValue(STATE, subject());
    await call(cookie);
    const replay = await call(cookie); // browser delete did not reach this copy of the cookie
    expect(replay.status).toBe(400);
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
  });

  it('the repeated callback many times: one exchange, one connection write path, all others 400', async () => {
    login();
    const cookie = createBoundStateCookieValue(STATE, subject());
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await call(cookie)).status);
    expect(results.filter((s) => s === 307)).toHaveLength(1);
    expect(results.filter((s) => s === 400)).toHaveLength(4);
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
  });

  it('REPLAY after a callback whose EXCHANGE FAILED: still refused (the state was consumed before the exchange)', async () => {
    login();
    handleOAuthCallbackMock.mockRejectedValueOnce(new Error('upstream failure'));
    const cookie = createBoundStateCookieValue(STATE, subject());
    const first = await call(cookie);
    expect(location(first)).toContain('status=error');
    const replay = await call(cookie);
    expect(replay.status).toBe(400);
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
  });

  it('CONCURRENCY: two callbacks with the same state + cookie in parallel -> exactly one exchange, one 307 and one 400', async () => {
    login();
    const cookie = createBoundStateCookieValue(STATE, subject());
    const [a, b] = await Promise.all([call(cookie), call(cookie)]);
    expect([a.status, b.status].sort()).toEqual([307, 400]);
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
  });

  it('CONCURRENCY: ten parallel callbacks -> exactly one exchange', async () => {
    login();
    const cookie = createBoundStateCookieValue(STATE, subject());
    const all = await Promise.all(Array.from({ length: 10 }, () => call(cookie)));
    expect(all.filter((r) => r.status === 307)).toHaveLength(1);
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
  });

  it('two different flows (different states) are independent: both succeed once', async () => {
    login();
    const other = 'd'.repeat(64);
    const r1 = await call(createBoundStateCookieValue(STATE, subject()));
    const r2 = await call(createBoundStateCookieValue(other, subject()), `code=c2&state=${other}`);
    expect(location(r1)).toContain('status=connected');
    expect(location(r2)).toContain('status=connected');
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(2);
  });

  it('the consumption record stores a hash of the state, never the state, the code or a token', async () => {
    login();
    await call(createBoundStateCookieValue(STATE, subject()));
    const rows = JSON.stringify([...ledger.values()]);
    expect(rows).not.toContain(STATE);
    expect(rows).not.toContain('code123');
    expect(ledger.size).toBe(1);
    expect([...ledger.values()][0]).toMatchObject({ workspaceId: WS_A });
  });

  it('FAIL CLOSED: if the consumption record cannot be written (database error), nothing is exchanged and the error is generic', async () => {
    login();
    createMock.mockRejectedValueOnce(Object.assign(new Error('connection refused postgres://secret-host/db'), { code: 'P1001' }));
    const res = await call(createBoundStateCookieValue(STATE, subject()));
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    expect(res.status === 400 || res.status === 307).toBe(true);
    if (res.status === 307) expect(location(res)).toContain('status=error');
    expect(location(res) + (await res.text().catch(() => ''))).not.toContain('secret-host');
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('secret-host');
  });
});

describe('rejections never consume nor exchange, and never touch another workspace', () => {
  it('altered state / altered cookie: 400, no exchange, nothing recorded', async () => {
    login();
    const cookie = createBoundStateCookieValue(STATE, subject());
    const parts = cookie.split('.');
    const altered = [parts[0], parts[1], parts[2], parts[3].replace(/^./, parts[3][0] === '0' ? '1' : '0')].join('.');
    expect((await call(altered)).status).toBe(400);
    expect((await call(cookie, `code=c&state=${'e'.repeat(64)}`)).status).toBe(400);
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    expect(ledger.size).toBe(0);
  });

  it('expired state: 400, no exchange, nothing recorded; the same expired cookie stays refused', async () => {
    login();
    const old = createBoundStateCookieValue(STATE, subject(), Date.now() - (OAUTH_STATE_TTL_SECONDS + 60) * 1000);
    expect((await call(old)).status).toBe(400);
    expect((await call(old)).status).toBe(400);
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    expect(ledger.size).toBe(0);
  });

  it('workspace changed / user changed: 400, no exchange, nothing recorded, no foreign workspace touched', async () => {
    const cookie = createBoundStateCookieValue(STATE, subject()); // started by ws-A / user-A
    login(WS_B, 'user-A');
    expect((await call(cookie)).status).toBe(400);
    login(WS_A, 'user-B');
    expect((await call(cookie)).status).toBe(400);
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(ledger.size).toBe(0);
  });

  it('REPLAY after a rejected callback: a rejected attempt (wrong workspace) does not burn the legitimate owner\'s flow, and the owner can still finish ONCE', async () => {
    const cookie = createBoundStateCookieValue(STATE, subject());
    login(WS_B);
    expect((await call(cookie)).status).toBe(400); // attacker/other session
    login(WS_A); // the legitimate owner, cookie still in their browser
    const ok = await call(cookie);
    expect(location(ok)).toContain('status=connected');
    expect((await call(cookie)).status).toBe(400); // and not twice
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
    expect(handleOAuthCallbackMock.mock.calls[0][0]).toBe(WS_A);
  });

  it('a state consumed by workspace A cannot be reused through workspace B even if B had a cookie with that state', async () => {
    login(WS_A);
    await call(createBoundStateCookieValue(STATE, subject()));
    login(WS_B, 'user-B');
    const res = await call(createBoundStateCookieValue(STATE, subject({ workspaceId: WS_B, userId: 'user-B' })));
    // B's own cookie is a different, independently bound flow: it is B's, allowed once, and writes only for B
    expect(handleOAuthCallbackMock.mock.calls.map((c) => c[0])).toEqual([WS_A, WS_B]);
    expect(location(res)).toContain('status=connected');
  });

  it('error bodies are generic: no state, code, cookie or secret', async () => {
    login();
    const cookie = createBoundStateCookieValue(STATE, subject());
    await call(cookie);
    const replay = await call(cookie, `code=SECRET-CODE-9&state=${STATE}`);
    const text = (await replay.text()) + JSON.stringify((console.error as any).mock.calls);
    for (const s of [STATE, 'SECRET-CODE-9', cookie, 'SBX-secret-not-real']) expect(text).not.toContain(s);
  });
});

describe('wiring (source order)', () => {
  it('the durable consumption happens after the cookie verification and BEFORE the config, the plan check and any code exchange', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('src/app/api/marketplace/callback/[marketplace]/route.ts', 'utf-8');
    const verify = src.indexOf('verifyBoundState(expectedState');
    const consume = src.indexOf('await consumeOAuthState(');
    const config = src.indexOf('getMarketplaceConnectionConfig(');
    const limit = src.indexOf('isLimitReached(');
    const exchange = src.indexOf('service.handleOAuthCallback(');
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(consume);
    expect(consume).toBeLessThan(config);
    expect(consume).toBeLessThan(limit);
    expect(consume).toBeLessThan(exchange);
  });
});
