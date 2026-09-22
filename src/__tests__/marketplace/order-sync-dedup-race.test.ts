/**
 * Phase 8 audit finding: Order has no DB-level unique constraint on
 * (workspaceId, externalOrderId) — OrdersSyncService's own comment admits
 * "externalOrderId isn't a unique key in the schema, look it up manually".
 * A plain findFirst-then-create is a real TOCTOU race: two concurrent
 * syncs for the SAME externalOrderId could both see "not found" and both
 * insert, creating two local Orders for one real marketplace sale.
 *
 * Fixed with zero schema changes via a real Postgres transaction-scoped
 * advisory lock (pg_advisory_xact_lock) keyed by
 * (workspaceId, marketplace, externalOrderId) — see OrdersSyncService's own
 * comment for why a migration was not applied instead.
 *
 * This file proves, with a mock that genuinely serializes concurrent
 * transactions racing on the SAME lock key (never just asserting mocks
 * were called), that:
 *  - same externalOrderId + same workspace = same local Order, even under
 *    genuine concurrent execution.
 *  - same externalOrderId + different workspace = independent Orders
 *    (different lock keys never block each other).
 *  - inventory is reserved exactly once per real order, never twice, when
 *    two concurrent syncs race on the same order.
 *
 * LOCK MOCK, STATED EXPLICITLY: each $transaction call gets its OWN
 * $executeRaw closure with its own `release` variable (never a shared
 * mutable property two concurrent transactions could clobber). A second
 * $executeRaw call for the SAME key genuinely awaits a promise that only
 * resolves once the FIRST call's whole transaction callback has finished
 * (mirroring "the lock is held until the transaction commits/rolls back").
 * A different key never touches that promise chain, so unrelated locks
 * never block each other. Because JS is single-threaded, the
 * locks.get/set pair inside each $executeRaw call is never interleaved by
 * another concurrent caller — the same "synchronous check-then-act"
 * safety already documented in this codebase's other transaction mocks.
 */
import crypto from 'crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { orderStore, inventoryStore, locks, lockKeysSeen } = vi.hoisted(() => ({
  orderStore: new Map<string, any>(), // key: `${workspaceId}:${externalOrderId}`
  inventoryStore: new Map<string, any>(), // key: `${productId}:${workspaceId}`
  locks: new Map<string, Promise<void>>(), // lock key -> promise resolved when free
  lockKeysSeen: [] as string[],
}))

const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn() }))

let orderIdCounter = 0

vi.mock('@/lib/prisma', () => ({
  prisma: {
    syncLog: { create: vi.fn(async () => ({ id: 'synclog-1' })), update: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) },
    inventory: {
      updateMany: vi.fn(async ({ where }: any) => {
        const key = `${where.productId}:${where.workspaceId}`
        const inv = inventoryStore.get(key) ?? { available: 10, reserved: 0 }
        if (inv.available < where.available.gte) return { count: 0 }
        inv.available -= where.available.gte
        inv.reserved += where.available.gte
        inventoryStore.set(key, inv)
        return { count: 1 }
      }),
      findUnique: vi.fn(async ({ where }: any) => inventoryStore.get(`${where.productId_workspaceId.productId}:${where.productId_workspaceId.workspaceId}`) ?? null),
    },
    orderItem: { create: vi.fn(async () => ({})) },
    $transaction: transactionMock,
    // Never actually called directly by production code (only tx.$executeRaw,
    // a fresh closure built per $transaction call below) — present only so
    // an accidental direct prisma.$executeRaw call fails loudly instead of
    // throwing "not a function" somewhere unrelated.
    $executeRaw: vi.fn(async () => undefined),
  },
}))

import { OrdersSyncService } from '@/services/marketplace/OrdersSyncService'
import { MarketplaceConnectionService } from '@/services/marketplace/MarketplaceConnectionService'
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter'
import { Marketplace } from '@/types/marketplace'

process.env.EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || 'test-client-id'
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-client-secret'
process.env.EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/ebay'
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64')

function makeMarketplaceOrder(overrides: Partial<any> = {}) {
  return {
    id: 'evt-1',
    externalOrderId: 'ebay-order-DUP-1',
    buyerId: 'buyer-1',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    totalPrice: 29,
    status: 'FULFILLED',
    createdAt: new Date(),
    items: [{ listingId: '', title: 'Widget', quantity: 1, price: 29, sku: 'SKU-WIDGET' }],
    shippingAddress: undefined,
    ...overrides,
  }
}

function installLockSerializedTransactionMock() {
  transactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
    // Own, per-call closure variable — never a shared mutable property two
    // concurrent transactions could clobber (that WAS a real bug in an
    // earlier draft of this mock: a single shared "pending release"
    // property let a second transaction's release overwrite the first's).
    let release: (() => void) | undefined

    const tx = {
      $executeRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: any[]) => {
        const key = String(values[0])
        lockKeysSeen.push(key)
        const priorChain = locks.get(key) ?? Promise.resolve()
        const mine = new Promise<void>((resolve) => {
          release = resolve
        })
        locks.set(key, priorChain.then(() => mine))
        await priorChain
        return undefined
      }),
      order: {
        findFirst: vi.fn(async ({ where }: any) => orderStore.get(`${where.workspaceId}:${where.externalOrderId}`) ?? null),
        update: vi.fn(async ({ where, data }: any) => {
          const existing = [...orderStore.values()].find((o) => o.id === where.id)
          Object.assign(existing, data)
          return { ...existing }
        }),
        create: vi.fn(async ({ data }: any) => {
          const created = { id: `order-${++orderIdCounter}`, ...data }
          orderStore.set(`${data.workspaceId}:${data.externalOrderId}`, created)
          return created
        }),
      },
      product: {
        findUnique: vi.fn(async ({ where }: any) => ({ id: `product-${where.workspaceId_sku.sku}`, purchasePrice: 100 })),
      },
      listing: {
        findMany: vi.fn(async () => []),
      },
    }

    try {
      return await callback(tx)
    } finally {
      // The real advisory lock is released at transaction commit/rollback —
      // modeled here as releasing right after the callback settles.
      release?.()
    }
  })
}

describe('OrdersSyncService — order dedup under real concurrency (advisory-lock fix)', () => {
  beforeEach(() => {
    orderStore.clear()
    inventoryStore.clear()
    locks.clear()
    lockKeysSeen.length = 0
    orderIdCounter = 0
    vi.clearAllMocks()
    installLockSerializedTransactionMock()
    vi.spyOn(MarketplaceConnectionService.prototype, 'getAccessToken').mockResolvedValue('fake-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('the advisory lock key encodes workspace, marketplace, and externalOrderId — never a single global mutex', async () => {
    vi.spyOn(EbayAdapter.prototype, 'getOrders').mockResolvedValueOnce([makeMarketplaceOrder()]).mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders('ws-1', Marketplace.EBAY)

    expect(lockKeysSeen).toHaveLength(1)
    expect(lockKeysSeen[0]).toContain('ws-1')
    expect(lockKeysSeen[0]).toContain('ebay')
    expect(lockKeysSeen[0]).toContain('ebay-order-DUP-1')
  })

  it('same externalOrderId + same workspace, synced twice sequentially = same local Order, never two', async () => {
    vi.spyOn(EbayAdapter.prototype, 'getOrders')
      .mockResolvedValueOnce([makeMarketplaceOrder()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeMarketplaceOrder({ status: 'SHIPPED' })])
      .mockResolvedValueOnce([])

    const service = new OrdersSyncService()
    await service.syncOrders('ws-1', Marketplace.EBAY)
    await service.syncOrders('ws-1', Marketplace.EBAY)

    const allOrders = [...orderStore.values()].filter((o) => o.workspaceId === 'ws-1' && o.externalOrderId === 'ebay-order-DUP-1')
    expect(allOrders).toHaveLength(1)
  })

  it('two GENUINELY CONCURRENT syncs racing on the SAME externalOrderId + workspace produce exactly ONE local Order and reserve inventory exactly once', async () => {
    // offset-keyed, not call-order-keyed: robust to the two concurrent
    // syncOrders() calls' getOrders() calls genuinely interleaving at the
    // scheduler level (a shared mockResolvedValueOnce queue would let one
    // instance's call consume a value meant for the other).
    vi.spyOn(EbayAdapter.prototype, 'getOrders').mockImplementation(async (_limit?: number, offset?: number) =>
      (offset ?? 0) === 0 ? [makeMarketplaceOrder()] : []
    )

    const service = new OrdersSyncService()

    // Fired together, not awaited one after another — this IS the race:
    // both syncs' transactions start before either has committed.
    const [resultA, resultB] = await Promise.all([
      service.syncOrders('ws-1', Marketplace.EBAY),
      service.syncOrders('ws-1', Marketplace.EBAY),
    ])

    expect(resultA.failed).toBe(0)
    expect(resultB.failed).toBe(0)

    const allOrders = [...orderStore.values()].filter((o) => o.workspaceId === 'ws-1' && o.externalOrderId === 'ebay-order-DUP-1')
    expect(allOrders).toHaveLength(1) // never two, even under a genuine race

    const inv = inventoryStore.get('product-SKU-WIDGET:ws-1')
    expect(inv?.reserved).toBe(1) // reserved exactly once, never twice for the same real sale
  })

  it("same externalOrderId in DIFFERENT workspaces creates INDEPENDENT Orders — never blocked or merged by each other's lock", async () => {
    vi.spyOn(EbayAdapter.prototype, 'getOrders').mockImplementation(async (_limit?: number, offset?: number) =>
      (offset ?? 0) === 0 ? [makeMarketplaceOrder()] : []
    )

    const service = new OrdersSyncService()
    await Promise.all([service.syncOrders('ws-A', Marketplace.EBAY), service.syncOrders('ws-B', Marketplace.EBAY)])

    const ordersA = [...orderStore.values()].filter((o) => o.workspaceId === 'ws-A')
    const ordersB = [...orderStore.values()].filter((o) => o.workspaceId === 'ws-B')
    expect(ordersA).toHaveLength(1)
    expect(ordersB).toHaveLength(1)
    expect(ordersA[0].id).not.toBe(ordersB[0].id)
  })
})
