/**
 * Phase 8 idempotency fix — FulfillmentService.simulateOrderShipped /
 * simulateOrderDelivered previously re-executed their full write path on
 * every call: a retry of simulateOrderShipped would have hit the real
 * Shipment.fulfillmentOrderId @unique constraint as a raw P2002 (rather
 * than a clean, expected outcome), and a retry of simulateOrderDelivered
 * silently re-set Shipment.actualDelivery to a NEW Date() and created a
 * SECOND 'delivered' TrackingEvent every time — both real data-integrity
 * bugs. Fixed with:
 *  - an early "already at this status" replay (no writes at all), and
 *  - the whole conditional-claim + write path wrapped in ONE real
 *    prisma.$transaction, using an atomic conditional
 *    fulfillmentOrder.updateMany (status excluded from the WHERE) as the
 *    real concurrency guard — same principle as
 *    ProductService.reserveInventory's atomic `available: {gte}` guard.
 *    The transaction wrapper matters beyond the UPDATE itself: Postgres
 *    holds the row lock an UPDATE takes for the REST of the transaction,
 *    so a concurrent loser's own updateMany genuinely blocks until the
 *    winner's entire transaction (shipment.create included) has committed
 *    — never observing a half-finished winner. No schema/migration change.
 *
 * LOCK MOCK, STATED EXPLICITLY: $transaction here models a real per-row
 * Postgres lock keyed by fulfillmentOrderId — a second transaction's own
 * updateMany on the SAME id genuinely awaits a promise that only resolves
 * once the FIRST transaction's whole callback has finished (mirroring "the
 * lock is held until commit/rollback"). A different id never touches that
 * promise chain. Because JS is single-threaded, the lock map's get/set
 * pair is never interleaved by another concurrent caller — the same
 * "synchronous check-then-act" safety this codebase's other transaction
 * mocks already document (see order-sync-dedup-race.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { fulfillmentOrderStore, orderStore, shipmentStore, trackingEvents, rowLocks } = vi.hoisted(() => ({
  fulfillmentOrderStore: new Map<string, any>(),
  orderStore: new Map<string, any>(),
  shipmentStore: new Map<string, any>(), // key: fulfillmentOrderId
  trackingEvents: [] as any[],
  rowLocks: new Map<string, Promise<void>>(), // key: fulfillmentOrderId
}))

const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn() }))

let shipmentIdCounter = 0;
let trackingEventIdCounter = 0;

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

function buildDataClient() {
  return {
    fulfillmentOrder: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = fulfillmentOrderStore.get(where.id);
        if (!row || row.workspaceId !== where.workspaceId) return null;
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = fulfillmentOrderStore.get(where.id);
        if (!row || row.workspaceId !== where.workspaceId) return { count: 0 };
        if (where.status?.notIn && where.status.notIn.includes(row.status)) return { count: 0 };
        if (where.status?.not !== undefined && row.status === where.status.not) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    order: {
      update: vi.fn(async ({ where, data }: any) => {
        const row = orderStore.get(where.id);
        if (!row) throw new Error('order not found');
        Object.assign(row, data);
        return { ...row };
      }),
    },
    shipment: {
      findUnique: vi.fn(async ({ where }: any) => {
        const row = shipmentStore.get(where.fulfillmentOrderId ?? where.id);
        return row ? { ...row } : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        if (shipmentStore.has(data.fulfillmentOrderId)) {
          throw p2002(['fulfillmentOrderId']); // the real DB backstop this test also exercises directly
        }
        const created = { id: `shipment-${++shipmentIdCounter}`, ...data };
        shipmentStore.set(data.fulfillmentOrderId, created);
        return { ...created };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const entry = [...shipmentStore.entries()].find(([, s]) => s.id === where.id);
        if (!entry) throw new Error('shipment not found');
        const [key, row] = entry;
        Object.assign(row, data);
        shipmentStore.set(key, row);
        return { ...row };
      }),
    },
    trackingEvent: {
      create: vi.fn(async ({ data }: any) => {
        const created = { id: `event-${++trackingEventIdCounter}`, ...data };
        trackingEvents.push(created);
        return created;
      }),
    },
  };
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    ...buildDataClient(),
    $transaction: transactionMock,
  },
}));

import { FulfillmentService } from '@/services/FulfillmentService';

function installLockSerializedTransactionMock() {
  transactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
    const tx = buildDataClient();

    // Wrap fulfillmentOrder.updateMany so acquiring "the row lock" for a
    // given fulfillmentOrderId genuinely blocks a concurrent transaction
    // until this one's whole callback has settled — see this file's own
    // header for exactly what this does and doesn't simulate.
    const realUpdateMany = tx.fulfillmentOrder.updateMany;
    let release: (() => void) | undefined;
    tx.fulfillmentOrder.updateMany = vi.fn(async (args: any) => {
      const key = args.where.id;
      const priorChain = rowLocks.get(key) ?? Promise.resolve();
      const mine = new Promise<void>((resolve) => {
        release = resolve;
      });
      rowLocks.set(key, priorChain.then(() => mine));
      await priorChain;
      return realUpdateMany(args);
    });

    try {
      return await callback(tx);
    } finally {
      release?.();
    }
  });
}

function seedFulfillmentOrder(overrides: Record<string, any> = {}) {
  const row = {
    id: 'fo-1',
    workspaceId: 'ws-1',
    orderId: 'order-1',
    partnerId: 'partner-1',
    status: 'pending',
    ...overrides,
  };
  fulfillmentOrderStore.set(row.id, row);
  orderStore.set(row.orderId, { id: row.orderId, workspaceId: row.workspaceId, status: 'processing' });
  return row;
}

describe('FulfillmentService.simulateOrderShipped / simulateOrderDelivered — idempotency', () => {
  beforeEach(() => {
    fulfillmentOrderStore.clear();
    orderStore.clear();
    shipmentStore.clear();
    trackingEvents.length = 0;
    rowLocks.clear();
    shipmentIdCounter = 0;
    trackingEventIdCounter = 0;
    vi.clearAllMocks();
    installLockSerializedTransactionMock();
  });

  describe('shipped — first call', () => {
    it('creates exactly one Shipment with two tracking events, and moves FulfillmentOrder + Order to "shipped"', async () => {
      seedFulfillmentOrder();

      const result: any = await FulfillmentService.simulateOrderShipped('fo-1', 'ws-1', 'TRACK123', 'Chronopost');

      expect(result.fulfillmentOrder.status).toBe('shipped');
      expect(result.shipment.trackingNumber).toBe('TRACK123');
      expect(result.shipment.carrier).toBe('Chronopost');
      expect(result.shipment.status).toBe('in_transit');
      expect(result.alreadyShipped).toBeUndefined();
      expect(shipmentStore.size).toBe(1);
      expect(trackingEvents).toHaveLength(2);
      expect(orderStore.get('order-1').status).toBe('shipped');
    });
  });

  describe('shipped — second call (retry / double-click)', () => {
    it('never creates a second Shipment or duplicate tracking events, and replays the SAME shipment', async () => {
      seedFulfillmentOrder();

      const first: any = await FulfillmentService.simulateOrderShipped('fo-1', 'ws-1', 'TRACK123', 'Chronopost');
      const second: any = await FulfillmentService.simulateOrderShipped('fo-1', 'ws-1', 'TRACK-DIFFERENT', 'DHL');

      expect(second.alreadyShipped).toBe(true);
      expect(second.shipment.id).toBe(first.shipment.id);
      expect(second.shipment.trackingNumber).toBe('TRACK123'); // never overwritten by the retry's different args
      expect(shipmentStore.size).toBe(1); // never a second Shipment
      expect(trackingEvents).toHaveLength(2); // never duplicated
    });
  });

  describe('delivered — first call', () => {
    it('moves FulfillmentOrder + Order + Shipment to "delivered" and adds exactly one final tracking event', async () => {
      seedFulfillmentOrder();
      await FulfillmentService.simulateOrderShipped('fo-1', 'ws-1');
      const eventsAfterShip = trackingEvents.length;

      const result: any = await FulfillmentService.simulateOrderDelivered('fo-1', 'ws-1');

      expect(result.fulfillmentOrder.status).toBe('delivered');
      expect(result.shipment.status).toBe('delivered');
      expect(result.shipment.actualDelivery).toBeInstanceOf(Date);
      expect(orderStore.get('order-1').status).toBe('delivered');
      expect(trackingEvents).toHaveLength(eventsAfterShip + 1);
      expect(trackingEvents[trackingEvents.length - 1].status).toBe('delivered');
    });
  });

  describe('delivered — second call (retry / double-click)', () => {
    it('never creates a new tracking event and never re-writes actualDelivery to a new timestamp', async () => {
      seedFulfillmentOrder();
      await FulfillmentService.simulateOrderShipped('fo-1', 'ws-1');
      const first: any = await FulfillmentService.simulateOrderDelivered('fo-1', 'ws-1');
      const eventsAfterFirstDelivery = trackingEvents.length;
      const firstActualDelivery = first.shipment.actualDelivery;
      expect(firstActualDelivery).toBeInstanceOf(Date);

      // A real clock tick between calls so a bug that DOES re-stamp
      // actualDelivery would produce an observably different Date.
      await new Promise((resolve) => setTimeout(resolve, 5));

      const second: any = await FulfillmentService.simulateOrderDelivered('fo-1', 'ws-1');

      expect(second.alreadyDelivered).toBe(true);
      expect(trackingEvents).toHaveLength(eventsAfterFirstDelivery); // never a duplicate
      expect(second.shipment.actualDelivery).toEqual(firstActualDelivery); // never silently re-stamped
    });
  });

  describe('shipped then delivered — the real, expected sequence', () => {
    it('the same Shipment row is used across both transitions', async () => {
      seedFulfillmentOrder();
      const shipped: any = await FulfillmentService.simulateOrderShipped('fo-1', 'ws-1');
      const delivered: any = await FulfillmentService.simulateOrderDelivered('fo-1', 'ws-1');

      expect(delivered.shipment.id).toBe(shipped.shipment.id);
      expect(delivered.fulfillmentOrder.status).toBe('delivered');
    });
  });

  describe('delivered without ever having been shipped (no Shipment row exists)', () => {
    it('marks FulfillmentOrder and Order delivered, returns shipment: null, never fabricates a Shipment', async () => {
      seedFulfillmentOrder();

      const result: any = await FulfillmentService.simulateOrderDelivered('fo-1', 'ws-1');

      expect(result.fulfillmentOrder.status).toBe('delivered');
      expect(result.shipment).toBeNull();
      expect(orderStore.get('order-1').status).toBe('delivered');
      expect(shipmentStore.size).toBe(0); // no shipment ever created
      expect(trackingEvents).toHaveLength(0); // no tracking event without a real shipment to attach it to
    });
  });

  describe('concurrent calls', () => {
    it('two GENUINELY CONCURRENT simulateOrderShipped calls for the SAME fulfillment order create exactly ONE Shipment', async () => {
      seedFulfillmentOrder();

      const [a, b] = await Promise.all([
        FulfillmentService.simulateOrderShipped('fo-1', 'ws-1', 'A'),
        FulfillmentService.simulateOrderShipped('fo-1', 'ws-1', 'B'),
      ]);

      expect(shipmentStore.size).toBe(1);
      expect((a as any).shipment).not.toBeNull();
      expect((b as any).shipment).not.toBeNull();
      expect((a as any).shipment.id).toBe((b as any).shipment.id);
      // Exactly one of the two calls did the real write; the other replayed it.
      expect([(a as any).alreadyShipped, (b as any).alreadyShipped].filter(Boolean)).toHaveLength(1);
    });

    it('two GENUINELY CONCURRENT simulateOrderDelivered calls for the SAME fulfillment order create exactly ONE final tracking event', async () => {
      seedFulfillmentOrder();
      await FulfillmentService.simulateOrderShipped('fo-1', 'ws-1');
      const eventsAfterShip = trackingEvents.length;

      const [a, b] = await Promise.all([
        FulfillmentService.simulateOrderDelivered('fo-1', 'ws-1'),
        FulfillmentService.simulateOrderDelivered('fo-1', 'ws-1'),
      ]);

      expect(trackingEvents).toHaveLength(eventsAfterShip + 1); // never two
      expect([(a as any).alreadyDelivered, (b as any).alreadyDelivered].filter(Boolean)).toHaveLength(1);
    });
  });

  describe('workspace isolation', () => {
    it('a fulfillment order id that belongs to a DIFFERENT workspace is refused — never shipped/delivered cross-tenant', async () => {
      seedFulfillmentOrder({ workspaceId: 'ws-A' });

      await expect(FulfillmentService.simulateOrderShipped('fo-1', 'ws-B')).rejects.toThrow('Fulfillment order not found');
      await expect(FulfillmentService.simulateOrderDelivered('fo-1', 'ws-B')).rejects.toThrow('Fulfillment order not found');

      // Untouched by the cross-workspace attempts.
      expect(fulfillmentOrderStore.get('fo-1').status).toBe('pending');
      expect(shipmentStore.size).toBe(0);
    });

    it('the real owning workspace can still ship/deliver its own fulfillment order normally', async () => {
      seedFulfillmentOrder({ workspaceId: 'ws-A' });

      const result: any = await FulfillmentService.simulateOrderShipped('fo-1', 'ws-A');

      expect(result.fulfillmentOrder.status).toBe('shipped');
    });
  });
});
