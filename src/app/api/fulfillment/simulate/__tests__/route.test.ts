/**
 * R3-B.5.10 — POST /api/fulfillment/simulate returns a minimal public JSON.
 *
 * The REAL route handler and the REAL @/lib/security (workspace + auth
 * checks) run; only their dependencies are mocked: next-auth's `auth`,
 * Prisma (user / workspace lookups) and FulfillmentService. No DB, no
 * network. The assertions read the JSON body that is actually serialized.
 *
 * The service mocks deliberately return the FULL shapes the real simulate*
 * methods can return — bare FulfillmentOrder rows, shipments with a
 * trackingUrl, and on the already-delivered replay a fulfillmentOrder that
 * embeds the whole Order row (recipient email / phone / address) — each
 * carrying marker values that must never appear in the response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock, serviceMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn() },
    workspace: { findFirst: vi.fn() },
  },
  serviceMock: {
    simulateOrderAccepted: vi.fn(),
    simulateOrderProcessing: vi.fn(),
    simulateOrderShipped: vi.fn(),
    simulateOrderDelivered: vi.fn(),
  },
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/services/FulfillmentService', () => ({ FulfillmentService: serviceMock }));

import { POST } from '@/app/api/fulfillment/simulate/route';

// ---- sensitive markers injected into every mocked service result ----
const SECRETS = {
  email: 'buyer-secret@example.test',
  phone: '+33-600-SECRET-PHONE',
  address2: 'SECRET-ADDRESS-LINE-2',
  trackingUrl: 'https://tracking.example.test/SECRET-TRACKING-URL',
  customerId: 'CUST-SECRET-ID',
  externalOrderId: 'EXT-SECRET-ORDER',
  partnerId: 'PARTNER-SECRET-ID',
  workspaceId: 'WS-SECRET-INTERNAL',
  revenue: 987654.321,
};

const fullOrderRow = {
  id: 'order-1',
  customerId: SECRETS.customerId,
  customerName: 'Buyer Name',
  customerEmail: SECRETS.email,
  shippingEmail: SECRETS.email,
  shippingPhone: SECRETS.phone,
  shippingAddress: '1 rue Secrète',
  shippingAddress2: SECRETS.address2,
  shippingState: 'SECRET-STATE',
  externalOrderId: SECRETS.externalOrderId,
};

const fullFulfillmentOrder = (status: string) => ({
  id: 'fo-1',
  status,
  workspaceId: SECRETS.workspaceId,
  orderId: 'order-1',
  partnerId: SECRETS.partnerId,
  externalOrderId: SECRETS.externalOrderId,
  revenue: SECRETS.revenue,
  totalCost: 12.34,
  profit: 5.67,
  quantity: 1,
});

const fullShipment = {
  id: 'ship-1',
  fulfillmentOrderId: 'fo-1',
  partnerId: SECRETS.partnerId,
  trackingNumber: 'FR123',
  carrier: 'La Poste',
  trackingUrl: SECRETS.trackingUrl,
  status: 'in_transit',
};

const SENSITIVE_STRINGS = [
  SECRETS.email, SECRETS.phone, SECRETS.address2, SECRETS.trackingUrl, SECRETS.customerId,
  SECRETS.externalOrderId, SECRETS.partnerId, SECRETS.workspaceId, String(SECRETS.revenue),
  'SECRET-STATE', '1 rue Secrète', 'FR123', 'La Poste', 'Buyer Name',
];
const FORBIDDEN_KEYS = [
  'shipment', 'order', 'trackingUrl', 'shippingEmail', 'shippingPhone', 'customerEmail',
  'shippingAddress', 'shippingAddress2', 'customerId', 'externalOrderId', 'workspaceId',
  'partnerId', 'revenue', 'alreadyShipped', 'alreadyDelivered', 'totalCost', 'profit', 'orderId',
];

function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

function makeRequest(body: unknown, query = '?workspaceId=ws-1') {
  return new NextRequest(`http://localhost/api/fulfillment/simulate${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Run the handler and return the status plus the body parsed from the real serialized JSON. */
async function call(body: unknown, query?: string) {
  const response = await POST(makeRequest(body, query));
  const raw = await response.text();
  return { status: response.status, raw, json: JSON.parse(raw) };
}

function expectMinimalSuccess(res: { status: number; raw: string; json: any }, action: string, expected: { id: string; status: string }) {
  expect(res.status).toBe(200);
  expect(res.json).toEqual({
    success: true,
    message: `Fulfillment order ${action} successfully`,
    result: { fulfillmentOrder: expected },
  });
  const keys = collectKeys(res.json);
  for (const k of FORBIDDEN_KEYS) expect(keys.has(k), `response must not contain key ${k}`).toBe(false);
  for (const s of SENSITIVE_STRINGS) expect(res.raw.includes(s), `response must not contain ${s}`).toBe(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  prismaMock.user.findUnique.mockResolvedValue({ emailVerified: new Date() });
  prismaMock.workspace.findFirst.mockResolvedValue({ id: 'ws-1' });
});

describe('POST /api/fulfillment/simulate — minimal JSON for every scenario', () => {
  it('accept: bare FulfillmentOrder row -> only id + status', async () => {
    serviceMock.simulateOrderAccepted.mockResolvedValue(fullFulfillmentOrder('accepted'));
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'accept' });
    expectMinimalSuccess(res, 'accept', { id: 'fo-1', status: 'accepted' });
    expect(serviceMock.simulateOrderAccepted).toHaveBeenCalledWith('fo-1', 'ws-1');
  });

  it('processing: bare FulfillmentOrder row -> only id + status', async () => {
    serviceMock.simulateOrderProcessing.mockResolvedValue(fullFulfillmentOrder('processing'));
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'processing' });
    expectMinimalSuccess(res, 'processing', { id: 'fo-1', status: 'processing' });
    expect(serviceMock.simulateOrderProcessing).toHaveBeenCalledWith('fo-1', 'ws-1');
  });

  it('ship (normal): { fulfillmentOrder, shipment } -> only id + status', async () => {
    serviceMock.simulateOrderShipped.mockResolvedValue({
      fulfillmentOrder: fullFulfillmentOrder('shipped'),
      shipment: fullShipment,
    });
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'ship' });
    expectMinimalSuccess(res, 'ship', { id: 'fo-1', status: 'shipped' });
    expect(serviceMock.simulateOrderShipped).toHaveBeenCalledTimes(1);
    const args = serviceMock.simulateOrderShipped.mock.calls[0];
    expect(args[0]).toBe('fo-1');
    expect(args[1]).toBe('ws-1');
    expect(args[3]).toBe('La Poste');
  });

  it('ship (replay): alreadyShipped flag and shipment are not returned', async () => {
    serviceMock.simulateOrderShipped.mockResolvedValue({
      fulfillmentOrder: fullFulfillmentOrder('shipped'),
      shipment: fullShipment,
      alreadyShipped: true,
    });
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'ship' });
    expectMinimalSuccess(res, 'ship', { id: 'fo-1', status: 'shipped' });
  });

  it('ship (lost race): same minimal result', async () => {
    serviceMock.simulateOrderShipped.mockResolvedValue({
      fulfillmentOrder: fullFulfillmentOrder('shipped'),
      shipment: null,
      alreadyShipped: true,
    });
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'ship' });
    expectMinimalSuccess(res, 'ship', { id: 'fo-1', status: 'shipped' });
  });

  it('deliver (normal): { fulfillmentOrder, shipment } -> only id + status', async () => {
    serviceMock.simulateOrderDelivered.mockResolvedValue({
      fulfillmentOrder: fullFulfillmentOrder('delivered'),
      shipment: fullShipment,
    });
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'deliver' });
    expectMinimalSuccess(res, 'deliver', { id: 'fo-1', status: 'delivered' });
    expect(serviceMock.simulateOrderDelivered).toHaveBeenCalledWith('fo-1', 'ws-1');
  });

  it('deliver (replay with the WHOLE Order embedded): no order, email, phone or address in the JSON', async () => {
    serviceMock.simulateOrderDelivered.mockResolvedValue({
      fulfillmentOrder: { ...fullFulfillmentOrder('delivered'), order: fullOrderRow },
      shipment: fullShipment,
      alreadyDelivered: true,
    });
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'deliver' });
    expectMinimalSuccess(res, 'deliver', { id: 'fo-1', status: 'delivered' });
    expect(collectKeys(res.json).has('order')).toBe(false);
  });

  it('deliver (lost race): fulfillmentOrder that still embeds the Order row -> minimal result', async () => {
    serviceMock.simulateOrderDelivered.mockResolvedValue({
      fulfillmentOrder: { ...fullFulfillmentOrder('delivered'), order: fullOrderRow },
      shipment: null,
      alreadyDelivered: true,
    });
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'deliver' });
    expectMinimalSuccess(res, 'deliver', { id: 'fo-1', status: 'delivered' });
  });

  it('the status in the response is the one the service returned (not recomputed)', async () => {
    serviceMock.simulateOrderDelivered.mockResolvedValue({
      fulfillmentOrder: fullFulfillmentOrder('delivered'),
      shipment: null,
    });
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'deliver' });
    expect(res.json.result.fulfillmentOrder.status).toBe('delivered');
  });
});

describe('POST /api/fulfillment/simulate — validation, auth and workspace behavior unchanged', () => {
  it('400 when fulfillmentOrderId or action is missing (no service call)', async () => {
    const a = await call({ action: 'accept' });
    const b = await call({ fulfillmentOrderId: 'fo-1' });
    for (const res of [a, b]) {
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: 'Fulfillment Order ID and action required' });
    }
    expect(serviceMock.simulateOrderAccepted).not.toHaveBeenCalled();
  });

  it('400 on an invalid action (no service call)', async () => {
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'explode' });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'Invalid action' });
    for (const fn of Object.values(serviceMock)) expect(fn).not.toHaveBeenCalled();
  });

  it('400 when the workspaceId query parameter is missing', async () => {
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'accept' }, '');
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'Workspace ID required' });
    expect(serviceMock.simulateOrderAccepted).not.toHaveBeenCalled();
  });

  it('401 without a session (no workspace lookup, no service call)', async () => {
    authMock.mockResolvedValue(null);
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'accept' });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'Unauthorized' });
    expect(prismaMock.workspace.findFirst).not.toHaveBeenCalled();
    expect(serviceMock.simulateOrderAccepted).not.toHaveBeenCalled();
  });

  it('403 when the email is not verified (no service call)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ emailVerified: null });
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'accept' });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Email verification required' });
    expect(serviceMock.simulateOrderAccepted).not.toHaveBeenCalled();
  });

  it('non-existent or foreign workspace is refused by the real ownership check (current behavior: 401), service never called', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(null);
    const res = await call({ fulfillmentOrderId: 'fo-1', action: 'accept' }, '?workspaceId=ws-foreign');
    // errorResponse() maps "Workspace not found or unauthorized" to 401 (it
    // matches the "unauthorized" rule before the "not found" rule). This
    // test pins the existing behavior; it is not changed by this lot.
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'Workspace not found or unauthorized' });
    expect(serviceMock.simulateOrderAccepted).not.toHaveBeenCalled();
  });

  it('workspace ownership is checked against the session user and the requested workspace, then forwarded to the service', async () => {
    serviceMock.simulateOrderProcessing.mockResolvedValue(fullFulfillmentOrder('processing'));
    await call({ fulfillmentOrderId: 'fo-9', action: 'processing' }, '?workspaceId=ws-1');
    expect(prismaMock.workspace.findFirst).toHaveBeenCalledWith({ where: { id: 'ws-1', userId: 'user-1' } });
    expect(serviceMock.simulateOrderProcessing).toHaveBeenCalledWith('fo-9', 'ws-1');
  });

  it('service errors keep their mapped status and message (404 "not found")', async () => {
    serviceMock.simulateOrderAccepted.mockRejectedValue(new Error('Fulfillment order not found'));
    const res = await call({ fulfillmentOrderId: 'fo-x', action: 'accept' });
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'Fulfillment order not found' });
  });
});
