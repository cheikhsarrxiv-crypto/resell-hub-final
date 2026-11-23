/**
 * B.11.1 — OAuth state bound to the workspace/user that started the flow.
 * Part 1: the pure mechanism (real crypto). Part 2: the real connect/callback routes with mocked session,
 * workspace check, plan limit and connection service (no network, no database, no eBay).
 */
import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { authMock, verifyWorkspaceAccessMock, handleOAuthCallbackMock, getConnectionMock, isLimitReachedMock, initiateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  verifyWorkspaceAccessMock: vi.fn(),
  handleOAuthCallbackMock: vi.fn(),
  getConnectionMock: vi.fn(),
  isLimitReachedMock: vi.fn(),
  initiateMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/security', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  verifyWorkspaceAccess: verifyWorkspaceAccessMock,
}));
// B.11.1-R: single-use is covered by oauth-state-replay.test.ts; here the ledger is a stub (no database)
vi.mock('@/lib/oauthStateConsumption', () => ({ consumeOAuthState: vi.fn(async () => 'consumed') }));
vi.mock('@/services/SubscriptionService', () => ({ SubscriptionService: { isLimitReached: isLimitReachedMock } }));
vi.mock('@/services/marketplace/MarketplaceConnectionService', () => ({
  MarketplaceConnectionService: class {
    constructor(public config: unknown) {}
    getConnection = getConnectionMock;
    handleOAuthCallback = handleOAuthCallbackMock;
    initiateConnection = initiateMock;
  },
}));

import { NextRequest } from 'next/server';
import { createBoundStateCookieValue, verifyBoundState, OAUTH_STATE_TTL_SECONDS } from '@/lib/oauthStateBinding';
import * as callbackRoute from '@/app/api/marketplace/callback/[marketplace]/route';
import * as connectRoute from '@/app/api/marketplace/connect/[marketplace]/route';

const STATE = 'a'.repeat(64);
const WS_A = 'ws-A';
const WS_B = 'ws-B';
const subject = (o: Partial<{ marketplace: string; workspaceId: string; userId: string }> = {}) => ({ marketplace: 'ebay', workspaceId: WS_A, userId: 'user-A', ...o });
const SANDBOX_ENV = {
  EBAY_SANDBOX_MODE: 'true',
  EBAY_CLIENT_ID: 'Adksy-Adksy-SBX-0123456789-abcdef01',
  EBAY_CLIENT_SECRET: 'SBX-secret-value-not-real',
  EBAY_REDIRECT_URI: 'Adksy-Adksy-Adksy-abcdefg',
};

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  for (const [k, v] of Object.entries(SANDBOX_ENV)) process.env[k] = v;
  delete process.env.VERCEL_ENV;
  delete process.env.NEXTAUTH_URL;
  vi.clearAllMocks();
  verifyWorkspaceAccessMock.mockImplementation(async (id: string) => id);
  isLimitReachedMock.mockResolvedValue(false);
  getConnectionMock.mockResolvedValue(null);
  handleOAuthCallbackMock.mockResolvedValue({ connectionId: 'c', marketplace: 'ebay', status: 'connected' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('bound state — mechanism', () => {
  it('accepts the workspace/user that started the flow', () => {
    const cookie = createBoundStateCookieValue(STATE, subject());
    expect(verifyBoundState(cookie, STATE, subject())).toEqual({ ok: true });
  });

  it('the cookie carries neither the workspace id nor the user id in clear', () => {
    const cookie = createBoundStateCookieValue(STATE, subject());
    expect(cookie).not.toContain(WS_A);
    expect(cookie).not.toContain('user-A');
    expect(cookie.startsWith(`v1.${STATE}.`)).toBe(true);
  });

  it('another workspace, another user or another marketplace is rejected and the cookie is consumed', () => {
    const cookie = createBoundStateCookieValue(STATE, subject());
    for (const other of [subject({ workspaceId: WS_B }), subject({ userId: 'user-B' }), subject({ marketplace: 'etsy' })]) {
      expect(verifyBoundState(cookie, STATE, other)).toEqual({ ok: false, reason: 'binding_mismatch', consume: true });
    }
  });

  it.each([
    ['absent cookie', undefined, 'missing_cookie'],
    ['empty cookie', '', 'missing_cookie'],
    ['a legacy bare-state cookie', STATE, 'malformed_cookie'],
    ['garbage', 'v1.x.y.z', 'malformed_cookie'],
    ['wrong version', `v2.${STATE}.1.${'0'.repeat(64)}`, 'malformed_cookie'],
  ])('%s -> rejected (%s)', (_n, cookie, reason) => {
    const v = verifyBoundState(cookie as string | undefined, STATE, subject());
    expect(v).toMatchObject({ ok: false, reason });
  });

  it('a different state in the URL than in the cookie is rejected (not consumed: it may be a forged link)', () => {
    const cookie = createBoundStateCookieValue(STATE, subject());
    expect(verifyBoundState(cookie, 'b'.repeat(64), subject())).toEqual({ ok: false, reason: 'state_mismatch', consume: false });
    expect(verifyBoundState(cookie, 'short', subject())).toMatchObject({ ok: false, reason: 'malformed_state' });
  });

  it('a tampered MAC, state-in-cookie, or timestamp is rejected', () => {
    const now = Date.now();
    const cookie = createBoundStateCookieValue(STATE, subject(), now);
    const [v, st, iat, mac] = cookie.split('.');
    const flipped = mac.replace(/^./, mac[0] === '0' ? '1' : '0');
    expect(verifyBoundState([v, st, iat, flipped].join('.'), STATE, subject(), now)).toMatchObject({ ok: false, reason: 'binding_mismatch' });
    expect(verifyBoundState([v, st, String(Number(iat) + 5), mac].join('.'), STATE, subject(), now)).toMatchObject({ ok: false, reason: 'binding_mismatch' });
    expect(verifyBoundState([v, 'c'.repeat(64), iat, mac].join('.'), STATE, subject(), now)).toMatchObject({ ok: false, reason: 'state_mismatch' });
  });

  it('expires after the TTL (and a timestamp from the future is refused)', () => {
    const now = Date.now();
    const cookie = createBoundStateCookieValue(STATE, subject(), now);
    expect(verifyBoundState(cookie, STATE, subject(), now + (OAUTH_STATE_TTL_SECONDS - 5) * 1000)).toEqual({ ok: true });
    expect(verifyBoundState(cookie, STATE, subject(), now + (OAUTH_STATE_TTL_SECONDS + 5) * 1000)).toEqual({ ok: false, reason: 'expired', consume: true });
    expect(verifyBoundState(cookie, STATE, subject(), now - 3600 * 1000)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('a cookie signed under another encryption key is rejected (key rotation / forgery)', () => {
    const cookie = createBoundStateCookieValue(STATE, subject());
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    expect(verifyBoundState(cookie, STATE, subject())).toMatchObject({ ok: false, reason: 'binding_mismatch' });
  });

  it('fails closed (throws) without TOKEN_ENCRYPTION_KEY, and never echoes the state', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => createBoundStateCookieValue(STATE, subject())).toThrow();
    try { createBoundStateCookieValue(STATE, subject()); } catch (e) { expect(String(e)).not.toContain(STATE); }
  });
});

const callbackReq = (cookie: string | undefined, query = `code=code123&state=${STATE}`) =>
  new NextRequest(`https://preview.example.test/api/marketplace/callback/ebay?${query}`, {
    headers: cookie ? { cookie: `oauth_state_ebay=${cookie}` } : {},
  });
const runCallback = (cookie: string | undefined, query?: string) =>
  callbackRoute.GET(callbackReq(cookie, query), { params: { marketplace: 'ebay' } });
const session = (workspaceId: string | undefined = WS_A, id = 'user-A') => authMock.mockResolvedValue({ user: { id, workspaceId } });
const setCookieOf = (res: Response) => res.headers.get('set-cookie') ?? '';

describe('callback route — real route, mocked collaborators', () => {
  it('normal flow: same workspace + user -> connected, exchange done for THAT workspace, state consumed', async () => {
    session();
    const res = await runCallback(createBoundStateCookieValue(STATE, subject()));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('status=connected');
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
    expect(handleOAuthCallbackMock.mock.calls[0][0]).toBe(WS_A);
    expect(setCookieOf(res)).toContain('oauth_state_ebay=;');
  });

  it('session workspace changed between connect and callback -> 400, nothing exchanged, nothing written, cookie consumed', async () => {
    const cookie = createBoundStateCookieValue(STATE, subject()); // started by WS_A
    session(WS_B); // the session now points to WS_B (same user, e.g. a newer workspace)
    const res = await runCallback(cookie);
    expect(res.status).toBe(400);
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(setCookieOf(res)).toContain('oauth_state_ebay=;');
  });

  it('another user logged in in the same browser between connect and callback -> 400, nothing exchanged', async () => {
    const cookie = createBoundStateCookieValue(STATE, subject());
    session(WS_A, 'user-B');
    const res = await runCallback(cookie);
    expect(res.status).toBe(400);
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
  });

  it('a workspaceId in the query string never changes the owner (ignored, binding still decides)', async () => {
    session();
    const ok = await runCallback(createBoundStateCookieValue(STATE, subject()), `code=c&state=${STATE}&workspaceId=${WS_B}`);
    expect(ok.status).toBe(307);
    expect(handleOAuthCallbackMock.mock.calls[0][0]).toBe(WS_A);
    handleOAuthCallbackMock.mockClear();
    session(WS_B);
    const rejected = await runCallback(createBoundStateCookieValue(STATE, subject()), `code=c&state=${STATE}&workspaceId=${WS_B}`);
    expect(rejected.status).toBe(400);
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
  });

  it.each([
    ['cookie absent', undefined, `code=c&state=${STATE}`],
    ['state absent', 'whatever', 'code=c'],
    ['code absent', 'whatever', `state=${STATE}`],
    ['state of the wrong length', 'whatever', `code=c&state=${'a'.repeat(63)}`],
    ['state differs from the cookie', undefined, `code=c&state=${'b'.repeat(64)}`],
  ])('%s -> 400, nothing exchanged', async (_n, cookie, query) => {
    session();
    const value = cookie === 'whatever' ? createBoundStateCookieValue(STATE, subject()) : cookie === undefined && _n.startsWith('state differs') ? createBoundStateCookieValue(STATE, subject()) : cookie;
    const res = await runCallback(value, query);
    expect(res.status).toBe(400);
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
  });

  it('a legacy bare-state cookie (pre-B.11.1 flow in flight) is rejected: the user simply restarts the connection', async () => {
    session();
    const res = await runCallback(STATE);
    expect(res.status).toBe(400);
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
  });

  it('replay: after a successful callback the browser has no cookie left; replaying the same URL is rejected', async () => {
    session();
    const first = await runCallback(createBoundStateCookieValue(STATE, subject()));
    expect(first.status).toBe(307);
    expect(setCookieOf(first)).toContain('oauth_state_ebay=;'); // deleted by the browser
    const replay = await runCallback(undefined); // cookie gone
    expect(replay.status).toBe(400);
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
  });

  it('an expired flow (> 10 min) is rejected and consumed', async () => {
    session();
    const old = createBoundStateCookieValue(STATE, subject(), Date.now() - (OAUTH_STATE_TTL_SECONDS + 30) * 1000);
    const res = await runCallback(old);
    expect(res.status).toBe(400);
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    expect(setCookieOf(res)).toContain('oauth_state_ebay=;');
  });

  it('rejection bodies and logs never contain the state, the code or a secret', async () => {
    session(WS_B);
    const res = await runCallback(createBoundStateCookieValue(STATE, subject()), `code=SECRET-CODE-123&state=${STATE}`);
    const body = await res.text();
    const logged = JSON.stringify((console.error as any).mock.calls);
    for (const text of [body, logged]) {
      expect(text).not.toContain(STATE);
      expect(text).not.toContain('SECRET-CODE-123');
      expect(text).not.toContain(SANDBOX_ENV.EBAY_CLIENT_SECRET);
    }
  });

  it('session required; workspace required; verified workspace used (regression)', async () => {
    authMock.mockResolvedValue(null);
    expect((await runCallback(createBoundStateCookieValue(STATE, subject()))).headers.get('location')).toContain('/login');
    authMock.mockResolvedValue({ user: { id: 'user-A' } });
    expect((await runCallback(createBoundStateCookieValue(STATE, subject()))).headers.get('location')).toContain('status=error');
    session('ws-raw');
    verifyWorkspaceAccessMock.mockResolvedValue(WS_A); // verifyWorkspaceAccess decides, not the raw JWT value
    await runCallback(createBoundStateCookieValue(STATE, subject()));
    expect(handleOAuthCallbackMock.mock.calls[0][0]).toBe(WS_A);
    expect(handleOAuthCallbackMock).toHaveBeenCalledTimes(1);
    expect(handleOAuthCallbackMock).not.toHaveBeenCalledWith('ws-raw', expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it('plan limit still enforced for a new connection, and a reconnection at the limit still allowed', async () => {
    session();
    isLimitReachedMock.mockResolvedValue(true);
    const refused = await runCallback(createBoundStateCookieValue(STATE, subject()));
    expect(decodeURIComponent(refused.headers.get('location') ?? '')).toContain('limit reached');
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    getConnectionMock.mockResolvedValue({ id: 'existing' });
    const reconnect = await runCallback(createBoundStateCookieValue(STATE, subject()));
    expect(reconnect.headers.get('location')).toContain('status=connected');
  });

  it('a failing exchange gives a generic error, consumes the state and leaks no token', async () => {
    session();
    handleOAuthCallbackMock.mockRejectedValue(new Error('upstream exploded with token FAKE-TOKEN-LEAK-12345'));
    const res = await runCallback(createBoundStateCookieValue(STATE, subject()));
    expect(res.headers.get('location')).toContain('status=error');
    expect(res.headers.get('location')! + setCookieOf(res)).not.toContain('FAKE-TOKEN-LEAK-12345');
    expect(setCookieOf(res)).toContain('oauth_state_ebay=;');
  });

  it('a refused configuration at the callback exchanges nothing (generic error, state consumed, reason code only in the log)', async () => {
    session();
    process.env.EBAY_SANDBOX_MODE = 'maybe';
    const res = await runCallback(createBoundStateCookieValue(STATE, subject()));
    expect(res.headers.get('location')).toContain('status=error');
    expect(handleOAuthCallbackMock).not.toHaveBeenCalled();
    expect(JSON.stringify((console.error as any).mock.calls)).toContain('invalid_sandbox_mode');
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain(SANDBOX_ENV.EBAY_CLIENT_SECRET);
  });
});

describe('connect route — the cookie it sets is bound to the verified workspace + user', () => {
  const runConnect = () =>
    connectRoute.GET(new NextRequest('https://preview.example.test/api/marketplace/connect/ebay'), { params: { marketplace: 'ebay' } });

  it('sets a bound, httpOnly, lax, 10-minute cookie; the workspace/user are in neither cookie nor body', async () => {
    session();
    initiateMock.mockResolvedValue({ authUrl: 'https://auth.sandbox.ebay.com/oauth2/authorize?x=1', state: STATE });
    const res = await runConnect();
    expect(res.status).toBe(200);
    const cookie = setCookieOf(res);
    expect(cookie).toContain(`oauth_state_ebay=v1.${STATE}.`);
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).not.toContain(WS_A);
    expect(await res.text()).not.toContain(WS_A);
    // and that cookie is accepted back for WS_A / user-A only
    const value = /oauth_state_ebay=([^;]+)/.exec(cookie)![1];
    expect(verifyBoundState(value, STATE, subject())).toEqual({ ok: true });
    expect(verifyBoundState(value, STATE, subject({ workspaceId: WS_B }))).toMatchObject({ ok: false });
  });

  it('a refused configuration -> 503 with a code, no OAuth URL, no cookie, no secret', async () => {
    session();
    process.env.EBAY_SANDBOX_MODE = 'false'; // not a production runtime
    const res = await runConnect();
    expect(res.status).toBe(503);
    expect(initiateMock).not.toHaveBeenCalled();
    expect(setCookieOf(res)).toBe('');
    const body = await res.text();
    expect(body).toContain('MARKETPLACE_CONFIG_INVALID');
    expect(body).not.toContain(SANDBOX_ENV.EBAY_CLIENT_SECRET);
    expect(body).not.toContain(SANDBOX_ENV.EBAY_CLIENT_ID);
  });

  it('session and workspace still required', async () => {
    authMock.mockResolvedValue(null);
    expect((await runConnect()).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: 'u' } });
    expect((await runConnect()).status).toBe(403);
    expect(initiateMock).not.toHaveBeenCalled();
  });
});
