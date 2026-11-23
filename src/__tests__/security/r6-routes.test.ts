/**
 * R6 — regression tests for the confirmed findings of the audit of the other routes.
 * No database, no network, no DNS: every dependency is mocked or injected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  UnsafeRemoteUrlError, assertPublicHttpUrl, fetchPublicUrl, isPrivateAddress, readBodyWithLimit, __setHostLookupForTests,
} from '@/lib/security/ssrfGuard';
import { parseAnalyticsDays } from '@/lib/analyticsRange';
import { errorResponse, isDatabaseError } from '@/lib/security';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/* -------------------------------------------------------------------------------------------- */
describe('R6-1 SSRF guard — addresses', () => {
  const blocked = [
    '127.0.0.1', '127.255.255.255', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.0.1',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1',
    '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1', 'not-an-ip',
  ];
  const allowed = ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'];
  it.each(blocked)('%s is refused', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(allowed)('%s is public', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('R6-1 SSRF guard — URLs', () => {
  const refused: Array<[string, string]> = [
    ['file:///etc/passwd', 'scheme'], ['ftp://example.com/x.png', 'scheme'], ['gopher://example.com', 'scheme'], ['data:image/png;base64,AAAA', 'scheme'],
    ['not a url', 'malformed'], ['https://user:pw@example.com/x.png', 'credentials'], ['https://example.com:8080/x.png', 'port'],
    ['https://example.com:22/x.png', 'port'],
    ['http://localhost/x.png', 'internal-name'], ['http://LOCALHOST./x.png', 'internal-name'], ['http://a.localhost/x.png', 'internal-name'],
    ['http://intranet/x.png', 'internal-name'], ['http://db.internal/x.png', 'internal-name'], ['http://printer.local/x.png', 'internal-name'],
    ['http://127.0.0.1/x.png', 'private-address'], ['http://2130706433/x.png', 'private-address'], ['http://0x7f000001/x.png', 'private-address'],
    ['http://0177.0.0.1/x.png', 'private-address'], ['http://169.254.169.254/latest/meta-data/', 'private-address'],
    ['http://[::1]/x.png', 'private-address'], ['http://[::ffff:127.0.0.1]/x.png', 'private-address'], ['http://[fd00::1]/x.png', 'private-address'],
    ['http://10.1.2.3:80/x.png', 'private-address'],
  ];
  it.each(refused)('%s -> %s', async (url, reason) => {
    await expect(assertPublicHttpUrl(url)).rejects.toMatchObject({ name: 'UnsafeRemoteUrlError', reason });
  });

  it('a name resolving to a private address is refused, even if only ONE of several addresses is private', async () => {
    __setHostLookupForTests(async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]);
    await expect(assertPublicHttpUrl('https://cdn.example.com/a.png')).rejects.toMatchObject({ reason: 'resolves-to-private-address' });
    __setHostLookupForTests(async () => [{ address: '169.254.169.254', family: 4 }]);
    await expect(assertPublicHttpUrl('https://rebind.example.com/a.png')).rejects.toMatchObject({ reason: 'resolves-to-private-address' });
  });

  it('an unresolvable or empty resolution is refused (fail-closed)', async () => {
    __setHostLookupForTests(async () => { throw new Error('ENOTFOUND'); });
    await expect(assertPublicHttpUrl('https://nowhere.example.com/a.png')).rejects.toMatchObject({ reason: 'unresolvable' });
    __setHostLookupForTests(async () => []);
    await expect(assertPublicHttpUrl('https://empty.example.com/a.png')).rejects.toMatchObject({ reason: 'unresolvable' });
  });

  it('a normal public https/http image URL is accepted', async () => {
    const u = await assertPublicHttpUrl('https://img.ebay.com/images/g/abc/s-l1600.jpg');
    expect(u.hostname).toBe('img.ebay.com');
    expect((await assertPublicHttpUrl('http://example.com:80/a.png')).port).toBe('');
  });

  it('the refusal message holds no URL', async () => {
    const e = await assertPublicHttpUrl('http://169.254.169.254/secret-path?token=abc').catch((x) => x);
    expect(e).toBeInstanceOf(UnsafeRemoteUrlError);
    expect(e.message).not.toMatch(/169\.254|secret-path|token/);
  });
});

describe('R6-1 SSRF guard — fetch behaviour', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  const resp = (status: number, headers: Record<string, string> = {}, body = 'x') =>
    ({ ok: status >= 200 && status < 300, status, statusText: '', headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, arrayBuffer: async () => Buffer.from(body) }) as unknown as Response;

  it('a refused URL never reaches fetch()', async () => {
    const f = vi.fn(); global.fetch = f as never;
    await expect(fetchPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(UnsafeRemoteUrlError);
    expect(f).not.toHaveBeenCalled();
  });

  it('a redirect to an internal address is refused before it is followed', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(302, { location: 'http://169.254.169.254/latest/meta-data/' }));
    global.fetch = f as never;
    await expect(fetchPublicUrl('https://img.example.com/a.png')).rejects.toMatchObject({ reason: 'private-address' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('a redirect to a name that resolves privately is refused', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(301, { location: 'https://evil.example.org/a.png' }));
    global.fetch = f as never;
    let n = 0;
    __setHostLookupForTests(async () => (++n === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '192.168.0.9', family: 4 }]));
    await expect(fetchPublicUrl('https://img.example.com/a.png')).rejects.toMatchObject({ reason: 'resolves-to-private-address' });
  });

  it('safe redirects (including relative ones) are followed, manually, up to 3 hops', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(302, { location: '/b.png' }))
      .mockResolvedValueOnce(resp(307, { location: 'https://cdn.example.com/c.png' }))
      .mockResolvedValueOnce(resp(200, { 'content-type': 'image/png' }));
    global.fetch = f as never;
    const r = await fetchPublicUrl('https://img.example.com/a.png');
    expect(r.status).toBe(200);
    expect(f.mock.calls.map((c) => c[0])).toEqual(['https://img.example.com/a.png', 'https://img.example.com/b.png', 'https://cdn.example.com/c.png']);
    for (const call of f.mock.calls) expect(call[1]).toMatchObject({ redirect: 'manual' });
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal); // time-bounded
  });

  it('a redirect loop is cut after 3 redirects, and a redirect without Location is refused', async () => {
    global.fetch = vi.fn().mockResolvedValue(resp(302, { location: 'https://img.example.com/loop.png' })) as never;
    await expect(fetchPublicUrl('https://img.example.com/a.png')).rejects.toMatchObject({ reason: 'too-many-redirects' });
    global.fetch = vi.fn().mockResolvedValue(resp(302)) as never;
    await expect(fetchPublicUrl('https://img.example.com/a.png')).rejects.toMatchObject({ reason: 'redirect-without-location' });
  });

  it('readBodyWithLimit: declared size, streamed size and plain arrayBuffer bodies are all capped', async () => {
    expect(await readBodyWithLimit(resp(200, { 'content-length': '999' }), 100)).toBeNull();
    expect((await readBodyWithLimit(resp(200, {}, 'abc'), 100))?.toString()).toBe('abc');
    expect(await readBodyWithLimit(resp(200, {}, 'x'.repeat(101)), 100)).toBeNull();
    const chunk = new Uint8Array(60);
    let cancelled = false;
    const streaming = {
      headers: { get: () => null },
      body: { getReader: () => { let n = 0; return { read: async () => (n++ < 5 ? { done: false, value: chunk } : { done: true }), cancel: async () => { cancelled = true; } }; } },
    } as unknown as Response;
    expect(await readBodyWithLimit(streaming, 100)).toBeNull(); // stops at the 2nd chunk, never buffers 300 bytes
    expect(cancelled).toBe(true);
  });

  it('both server-side image downloads now go through the guard (no raw fetch of a third-party URL left)', () => {
    for (const rel of ['src/services/StorageService.ts', 'src/services/ai/tools/actionTools.ts']) {
      const src = read(rel);
      expect(src).toContain("from '@/lib/security/ssrfGuard'");
      expect(src).not.toMatch(/await fetch\((data\.sourceUrl|url)\)/);
    }
  });
});

/* -------------------------------------------------------------------------------------------- */
describe('R6-2 errorResponse never returns database error text', () => {
  const known = (code: string, msg = 'Invalid `prisma.workspace.update()` invocation:\n{ where: { id: "cmabc" }, data: { name: { x: 1 } } }\nUnique constraint failed on the fields: (`slug`)') =>
    new Prisma.PrismaClientKnownRequestError(msg, { code, clientVersion: '5.22.0' });
  const body = async (r: Response) => JSON.stringify(await r.json());

  it('P2002 -> 409, P2025 -> 404, P2003 -> 409, other -> 500; none contains model, ids or arguments', async () => {
    for (const [code, status] of [['P2002', 409], ['P2025', 404], ['P2003', 409], ['P2034', 500]] as const) {
      const r = errorResponse(known(code));
      expect(r.status).toBe(status);
      const text = await body(r);
      expect(text).not.toMatch(/prisma|invocation|cmabc|slug|workspace\.update|where/i);
    }
  });
  it('a validation error -> 400 generic; an initialization/unknown engine error -> 500 generic', async () => {
    const v = new Prisma.PrismaClientValidationError('Invalid `prisma.user.findMany()` invocation: Argument `where` ...', { clientVersion: '5.22.0' });
    const r = errorResponse(v);
    expect(r.status).toBe(400);
    expect(await body(r)).not.toMatch(/prisma|where|findMany/i);
    const init = new Prisma.PrismaClientInitializationError("Can't reach database server at `db.secret-host.example:5432`", '5.22.0');
    const r2 = errorResponse(init);
    expect(r2.status).toBe(500);
    expect(await body(r2)).not.toMatch(/secret-host|5432|reach/i);
  });
  it('an error that only LOOKS like a Prisma one (plain Error carrying an invocation dump) is filtered too', async () => {
    const r = errorResponse(new Error('Invalid `prisma.order.create()` invocation: data: { customerEmail: "a@b.c" }'));
    expect(await body(r)).not.toMatch(/customerEmail|a@b\.c|prisma/);
    expect(isDatabaseError(new Error('Unique constraint failed on the fields: (`email`)'))).toBe(true);
  });
  it('business errors written by our own services are unchanged (status mapping kept)', async () => {
    expect(errorResponse(new Error('Unauthorized')).status).toBe(401);
    expect(errorResponse(new Error('Email verification required')).status).toBe(403);
    expect(errorResponse(new Error('Product not found')).status).toBe(404);
    expect(errorResponse(new Error('Workspace ID required')).status).toBe(400);
    const r = errorResponse(new Error('Plan limit reached: maximum 10 products'));
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe('Plan limit reached: maximum 10 products');
    expect(isDatabaseError(new Error('Plan limit reached'))).toBe(false);
    expect(isDatabaseError(null)).toBe(false);
    expect(isDatabaseError('prisma')).toBe(false);
  });
  it('the AI agent profile route uses the same filter', () => {
    expect(read('src/app/api/ai/agent/profile/route.ts')).toContain('isDatabaseError(error)');
  });
});

/* -------------------------------------------------------------------------------------------- */
describe('R6-3 analytics `days` is bounded', () => {
  it.each([
    [null, 30], [undefined, 30], ['', 30], ['abc', 30], ['NaN', 30], ['-5', 30], ['0', 30], ['1.5', 30], ['7', 7], ['30', 30], ['365', 365],
    ['366', 365], ['99999999', 365], ['9'.repeat(30), 365], ['1e9', 30], [' 14 ', 14], ['0x10', 30],
  ])('%j -> %i', (raw, expected) => expect(parseAnalyticsDays(raw as string | null | undefined)).toBe(expected));

  it('both analytics routes use it instead of parseInt', () => {
    for (const rel of ['src/app/api/analytics/dashboard/route.ts', 'src/app/api/analytics/overview/route.ts']) {
      const src = read(rel);
      expect(src).toContain('parseAnalyticsDays(');
      expect(src).not.toMatch(/parseInt\(request\.nextUrl\.searchParams\.get\('days'\)/);
    }
  });
});

/* -------------------------------------------------------------------------------------------- */
const { wsMocks } = vi.hoisted(() => ({
  wsMocks: {
    verified: vi.fn(),
    update: vi.fn(),
    updateStep: vi.fn(),
  },
}));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security')>();
  return { ...actual, getVerifiedWorkspaceId: wsMocks.verified };
});
vi.mock('@/lib/prisma', () => {
  const prisma = { workspace: { update: wsMocks.update, findUnique: vi.fn(), delete: vi.fn() } };
  return { default: prisma, prisma };
});
vi.mock('@/services/OnboardingService', () => ({
  OnboardingService: { updateStep: wsMocks.updateStep, getProgress: vi.fn(), completeOnboarding: vi.fn() },
}));

import * as workspaceRoute from '@/app/api/workspaces/[id]/route';
import * as onboardingRoute from '@/app/api/onboarding/route';

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });

describe('R6-4 PUT /api/workspaces/[id] validates types and sizes, and still only touches allowed fields', () => {
  beforeEach(() => {
    wsMocks.verified.mockReset().mockResolvedValue('ws-A');
    wsMocks.update.mockReset().mockResolvedValue({ id: 'ws-A' });
  });
  const put = (body: unknown, id = 'ws-A') => workspaceRoute.PUT(req(`/api/workspaces/${id}?workspaceId=ws-A`, 'PUT', body), { params: { id } });

  it('a valid update passes only name / description / country, normalised', async () => {
    const r = await put({ name: '  My shop ', description: 'Vintage', country: 'fr' });
    expect(r.status).toBe(200);
    expect(wsMocks.update.mock.calls[0][0]).toMatchObject({ where: { id: 'ws-A' }, data: { name: 'My shop', description: 'Vintage', country: 'FR' } });
  });
  it('mass assignment: sensitive/extra fields are dropped, never forwarded', async () => {
    const r = await put({ name: 'ok', slug: 'hijack', userId: 'victim', stripeCustomerId: 'cus_x', subscriptionId: 'sub_x', onboardingCompleted: true, id: 'other' });
    expect(r.status).toBe(200);
    expect(wsMocks.update.mock.calls[0][0].data).toEqual({ name: 'ok' });
  });
  it('only sensitive fields -> "No valid fields", nothing written', async () => {
    const r = await put({ userId: 'victim', slug: 'x' });
    expect(r.status).toBe(400);
    expect(wsMocks.update).not.toHaveBeenCalled();
  });
  it.each([
    ['object name', { name: { $set: 'x' } }], ['array name', { name: ['a'] }], ['number name', { name: 5 }], ['empty name', { name: '   ' }],
    ['huge name', { name: 'x'.repeat(101) }], ['huge description', { description: 'x'.repeat(501) }], ['3-letter country', { country: 'FRA' }],
    ['numeric country', { country: 33 }], ['injection-ish country', { country: "FR'; DROP" }],
  ])('%s -> 400 with a fixed message, no write, no database text', async (_n, body) => {
    const r = await put(body);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).not.toMatch(/prisma|invocation/i);
    expect(wsMocks.update).not.toHaveBeenCalled();
  });
  it.each([['non-object body', '"text"'], ['array body', '[]'], ['null body', 'null'], ['malformed json', '{not json']])('%s -> 400', async (_n, raw) => {
    const r = await put(raw);
    expect(r.status).toBe(400);
    expect(wsMocks.update).not.toHaveBeenCalled();
  });
  it('another workspace id in the path is still refused (403) and nothing is written', async () => {
    const r = await put({ name: 'x' }, 'ws-B');
    expect(r.status).toBe(403);
    expect(wsMocks.update).not.toHaveBeenCalled();
  });
  it('a database failure is reported without database text', async () => {
    wsMocks.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Invalid `prisma.workspace.update()` invocation: where: { id: "ws-A" }', { code: 'P2025', clientVersion: '5.22.0' }));
    const r = await put({ name: 'x' });
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.json())).not.toMatch(/prisma|ws-A|invocation/i);
  });
  it('the settings page sends the workspaceId the route requires (the PUT used to fail with 400)', () => {
    expect(read('src/app/dashboard/settings/page.tsx')).toMatch(/fetch\(`\/api\/workspaces\/\$\{workspace\.id\}\?workspaceId=\$\{workspace\.id\}`, \{\s*method: 'PUT'/);
  });
});

describe('R6-5 POST /api/onboarding validates the step data', () => {
  beforeEach(() => {
    wsMocks.verified.mockReset().mockResolvedValue('ws-A');
    wsMocks.updateStep.mockReset().mockResolvedValue({ currentStep: 3 });
  });
  const post = (body: unknown) => onboardingRoute.POST(req('/api/onboarding?workspaceId=ws-A', 'POST', body));

  it('a valid step is saved for the VERIFIED workspace only; a workspaceId in the body is ignored', async () => {
    const r = await post({ step: 3, businessName: 'Shop', marketplaces: ['ebay', 'etsy'], connectionsSetup: true, workspaceId: 'ws-B', currentStep: 99, completedAt: 'x' });
    expect(r.status).toBe(200);
    const [ws, data] = wsMocks.updateStep.mock.calls[0];
    expect(ws).toBe('ws-A');
    expect(data).toEqual({ step: 3, businessName: 'Shop', marketplaces: ['ebay', 'etsy'], connectionsSetup: true });
  });
  it.each([
    ['string step', { step: '3' }], ['float step', { step: 3.5 }], ['zero', { step: 0 }], ['8', { step: 8 }], ['negative', { step: -1 }], ['missing', {}],
    ['object field', { step: 2, businessName: { a: 1 } }], ['huge text', { step: 2, businessName: 'x'.repeat(201) }],
    ['too many marketplaces', { step: 2, marketplaces: Array(11).fill('ebay') }], ['non-string marketplace', { step: 2, marketplaces: [1] }],
    ['string flag', { step: 2, connectionsSetup: 'yes' }],
  ])('%s -> 400, nothing saved', async (_n, body) => {
    const r = await post(body);
    expect(r.status).toBe(400);
    expect(wsMocks.updateStep).not.toHaveBeenCalled();
  });
  it('a malformed body is a 400, not a 500', async () => {
    const r = await post('{oops');
    expect(r.status).toBe(400);
    expect(wsMocks.updateStep).not.toHaveBeenCalled();
  });
});
