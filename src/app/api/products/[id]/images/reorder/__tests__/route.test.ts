/**
 * R3-C.0-FIX — PUT /api/products/[id]/images/reorder: real HTTP responses.
 *
 * The REAL route handler, the REAL @/lib/security (session, verified email,
 * workspace ownership) and the REAL StorageService run. Only their
 * dependencies are replaced: next-auth's `auth` and Prisma (an in-memory
 * fake, see src/services/__tests__/fakeImagePrisma.ts). No DB, no network.
 * Assertions read the JSON body that is actually serialized and compare the
 * image table before / after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { fake } from '@/services/__tests__/fakeImagePrisma';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/prisma', async () => {
  const { fake: f } = await import('@/services/__tests__/fakeImagePrisma');
  return { default: f.prisma, prisma: f.prisma };
});

import { PUT } from '@/app/api/products/[id]/images/reorder/route';

function makeRequest(body: unknown, query = '?workspaceId=ws-A') {
  return new NextRequest(`http://localhost/api/products/prod-A/images/reorder${query}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call(body: unknown, opts: { productId?: string; query?: string } = {}) {
  const response = await PUT(makeRequest(body, opts.query), { params: { id: opts.productId ?? 'prod-A' } });
  const raw = await response.text();
  return { status: response.status, raw, json: JSON.parse(raw) };
}

const ACCESS_DENIED = { error: 'Product not found or access denied' };

beforeEach(() => {
  fake.seedTwoWorkspaces();
  authMock.mockResolvedValue({ user: { id: 'user-A' } });
});

describe('PUT reorder — authorized request', () => {
  it('200 and the images are reordered', async () => {
    const res = await call({
      images: [
        { id: 'img-A3', order: 0, isMain: true },
        { id: 'img-A1', order: 1, isMain: false },
        { id: 'img-A2', order: 2 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, message: 'Images reordered successfully' });
    const after = fake.imagesSnapshot();
    expect(after['img-A3']).toMatchObject({ order: 0, isMain: true });
    expect(after['img-A1']).toMatchObject({ order: 1, isMain: false });
    expect(after['img-A2']).toMatchObject({ order: 2, isMain: false });
  });

  it('an empty array is accepted and changes nothing', async () => {
    const before = fake.imagesSnapshot();
    const res = await call({ images: [] });
    expect(res.status).toBe(200);
    expect(fake.imagesSnapshot()).toEqual(before);
  });

  it('the exact payload the dashboard sends (id string, integer order, boolean isMain) is accepted', async () => {
    const res = await call({
      images: [
        { id: 'img-A1', order: 0, isMain: true },
        { id: 'img-A2', order: 1, isMain: false },
        { id: 'img-A3', order: 2, isMain: false },
      ],
    });
    expect(res.status).toBe(200);
  });
});

describe('PUT reorder — cross-workspace and cross-product attempts', () => {
  const attacks: Array<[string, unknown, string?]> = [
    ["A's product with B's image ids (the reported attack)", { images: [{ id: 'img-B1', order: 99, isMain: false }, { id: 'img-B2', order: 0, isMain: true }] }],
    ['own and foreign image ids mixed', { images: [{ id: 'img-A1', order: 5 }, { id: 'img-B3', order: 6 }] }],
    ['an unknown image id', { images: [{ id: 'img-unknown', order: 1 }] }],
    ["an image of another product of A's workspace", { images: [{ id: 'img-A2-1', order: 1 }] }],
  ];

  it.each(attacks)('%s -> 404, identical JSON, nothing changes', async (_name, payload) => {
    const before = fake.imagesSnapshot();
    const res = await call(payload);
    expect(res.status).toBe(404);
    expect(res.json).toEqual(ACCESS_DENIED);
    expect(fake.imagesSnapshot()).toEqual(before);
    expect(fake.state.writes).toBe(0);
  });

  it('the response never contains an image id, and is byte-identical whether the foreign image exists or not', async () => {
    const foreign = await call({ images: [{ id: 'img-B1', order: 1 }] });
    const unknown = await call({ images: [{ id: 'img-unknown', order: 1 }] });
    const otherProduct = await call({ images: [{ id: 'img-A2-1', order: 1 }] });
    expect(foreign.raw).toBe(unknown.raw);
    expect(foreign.raw).toBe(otherProduct.raw);
    for (const res of [foreign, unknown, otherProduct]) {
      expect(res.raw).not.toContain('img-');
    }
  });

  it("another workspace's product through A's own workspace -> same 404, nothing changes", async () => {
    const before = fake.imagesSnapshot();
    const res = await call({ images: [{ id: 'img-B1', order: 3 }] }, { productId: 'prod-B' });
    expect(res.status).toBe(404);
    expect(res.json).toEqual(ACCESS_DENIED);
    expect(fake.imagesSnapshot()).toEqual(before);
  });

  it("A's session on B's workspace is refused by the real ownership check, nothing changes", async () => {
    const before = fake.imagesSnapshot();
    const res = await call({ images: [{ id: 'img-B1', order: 3 }] }, { productId: 'prod-B', query: '?workspaceId=ws-B' });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'Workspace not found or unauthorized' });
    expect(fake.imagesSnapshot()).toEqual(before);
    expect(fake.state.writes).toBe(0);
  });

  it('the symmetric direction (B session, B workspace, A image ids) is refused too', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-B' } });
    const before = fake.imagesSnapshot();
    const res = await call({ images: [{ id: 'img-A1', order: 50 }] }, { productId: 'prod-B', query: '?workspaceId=ws-B' });
    expect(res.status).toBe(404);
    expect(res.json).toEqual(ACCESS_DENIED);
    expect(fake.imagesSnapshot()).toEqual(before);
  });
});

describe('PUT reorder — authentication and workspace', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    const before = fake.imagesSnapshot();
    const res = await call({ images: [{ id: 'img-A1', order: 1 }] });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'Unauthorized' });
    expect(fake.imagesSnapshot()).toEqual(before);
  });

  it('403 when the e-mail is not verified', async () => {
    fake.state.users.set('user-A', { id: 'user-A', emailVerified: null });
    const res = await call({ images: [{ id: 'img-A1', order: 1 }] });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Email verification required' });
    expect(fake.state.writes).toBe(0);
  });

  it('400 when the workspaceId query parameter is missing', async () => {
    const res = await call({ images: [{ id: 'img-A1', order: 1 }] }, { query: '' });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'Workspace ID required' });
    expect(fake.state.writes).toBe(0);
  });
});

describe('PUT reorder — payload validation returns 400 (never 500) and writes nothing', () => {
  const tooMany = Array.from({ length: 101 }, (_, i) => ({ id: `img-A${i}`, order: i }));
  const invalid: Array<[string, unknown]> = [
    ['images is not an array', { images: 'nope' }],
    ['images is missing', {}],
    ['more than 100 images', { images: tooMany }],
    ['a null element', { images: [null] }],
    ['a null element among valid ones', { images: [{ id: 'img-A1', order: 1 }, null] }],
    ['a non-object element', { images: ['img-A1'] }],
    ['a numeric id', { images: [{ id: 123, order: 1 }] }],
    ['an empty id', { images: [{ id: '', order: 1 }] }],
    ['an overlong id', { images: [{ id: 'x'.repeat(129), order: 1 }] }],
    ['an object id', { images: [{ id: { $ne: null }, order: 1 }] }],
    ['a string order', { images: [{ id: 'img-A1', order: '1' }] }],
    ['a fractional order', { images: [{ id: 'img-A1', order: 1.5 }] }],
    ['a negative order', { images: [{ id: 'img-A1', order: -1 }] }],
    ['an order above the maximum', { images: [{ id: 'img-A1', order: 10001 }] }],
    ['a missing order', { images: [{ id: 'img-A1' }] }],
    ['a string isMain', { images: [{ id: 'img-A1', order: 1, isMain: 'yes' }] }],
    ['a numeric isMain', { images: [{ id: 'img-A1', order: 1, isMain: 1 }] }],
    ['a null isMain', { images: [{ id: 'img-A1', order: 1, isMain: null }] }],
  ];

  it.each(invalid)('%s', async (_name, payload) => {
    const before = fake.imagesSnapshot();
    const res = await call(payload);
    expect(res.status).toBe(400);
    expect(typeof res.json.error).toBe('string');
    expect(fake.imagesSnapshot()).toEqual(before);
    expect(fake.state.writes).toBe(0);
    expect(fake.state.findManyCalls).toHaveLength(0); // rejected before any ownership query
  });

  it('boundary order values 0 and 10000 are accepted', async () => {
    const res = await call({ images: [{ id: 'img-A1', order: 0 }, { id: 'img-A2', order: 10000 }] });
    expect(res.status).toBe(200);
  });
});

describe('PUT reorder — malformed or unexpected JSON bodies return a clean 400', () => {
  const TECHNICAL = ['Unexpected', 'position', 'token', 'destructure', 'SyntaxError', 'TypeError', 'undefined', ' at ', 'node_modules', 'StorageService'];

  // raw request bodies (strings are sent as-is, not re-serialized)
  const cases: Array<[string, string, string]> = [
    ['a truncated object', '{"images": [', 'Request body must be valid JSON'],
    ['plain text', 'not json at all', 'Request body must be valid JSON'],
    ['an empty body', '', 'Request body must be valid JSON'],
    ['a lone brace', '{', 'Request body must be valid JSON'],
    ['trailing garbage', '{"images": []} xyz', 'Request body must be valid JSON'],
    ['JSON null', 'null', 'Request body must be a JSON object'],
    ['a JSON array root', '[]', 'Request body must be a JSON object'],
    ['an array of images as the root', '[{"id":"img-A1","order":1}]', 'Request body must be a JSON object'],
    ['a JSON string root', '"images"', 'Request body must be a JSON object'],
    ['a JSON number root', '123', 'Request body must be a JSON object'],
    ['a JSON boolean root', 'true', 'Request body must be a JSON object'],
  ];

  it.each(cases)('%s -> 400, generic message, no service call, no mutation', async (_name, raw, expectedMessage) => {
    const findProduct = vi.spyOn(fake.prisma.product, 'findUnique');
    const before = fake.imagesSnapshot();
    const res = await call(raw);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: expectedMessage });
    for (const word of TECHNICAL) {
      expect(res.raw.includes(word), `response must not leak "${word}"`).toBe(false);
    }
    // nothing downstream ran: no product lookup, no ownership query, no write
    expect(findProduct).not.toHaveBeenCalled();
    expect(fake.state.findManyCalls).toHaveLength(0);
    expect(fake.state.writes).toBe(0);
    expect(fake.imagesSnapshot()).toEqual(before);
    findProduct.mockRestore();
  });

  it('an object root without images is still the existing "Images must be an array" 400', async () => {
    const res = await call({});
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'Images must be an array' });
  });

  it('authentication still comes first: a malformed body without a session is 401, not 400', async () => {
    authMock.mockResolvedValue(null);
    const res = await call('{"images": [');
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'Unauthorized' });
  });

  it('workspace checks still come first: a malformed body on a foreign workspace is 401, not 400', async () => {
    const res = await call('null', { query: '?workspaceId=ws-B' });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'Workspace not found or unauthorized' });
  });

  it('a missing workspaceId is still reported before the body is read', async () => {
    const res = await call('null', { query: '' });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'Workspace ID required' });
  });

  it('a valid body right after malformed ones still works (no state leaks between requests)', async () => {
    await call('{');
    const res = await call({ images: [{ id: 'img-A2', order: 0, isMain: true }, { id: 'img-A1', order: 1 }] });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, message: 'Images reordered successfully' });
    expect(fake.imagesSnapshot()['img-A2']).toMatchObject({ order: 0, isMain: true });
  });
});
