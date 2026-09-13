/**
 * Proves the fix: verifyProductAccess (used by GET/PATCH/DELETE
 * /api/products/[id], which serves both the product detail page and the
 * edit page's prefill) now includes Inventory rows, so the API response
 * actually carries the real available stock (Inventory.available) instead
 * of only the possibly-stale Product.quantity — see prisma/schema.prisma.
 *
 * @/auth is mocked: verifyProductAccess -> verifyWorkspaceAccess calls the
 * real NextAuth auth() for its session, which (a) has no real session in a
 * plain vitest process and (b) transitively fails to resolve next/server
 * from next-auth's own internals outside the Next.js runtime. Mocking
 * @/auth avoids loading next-auth at all, so only the module actually
 * under test (security.ts's own logic + a real database) runs unmocked.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }))
vi.mock('@/auth', () => ({ auth: mockAuth }))

import { PrismaClient } from '@prisma/client'
import { verifyProductAccess } from '@/lib/security'

const prisma = new PrismaClient()

let dbAvailable = true
try {
  await prisma.$queryRaw`SELECT 1`
} catch {
  dbAvailable = false
}

const createdUserIds: string[] = []

async function createWorkspaceWithProduct(quantity: number, available: number) {
  const user = await prisma.user.create({
    data: {
      email: `product-access-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Product Access Test User',
      password: 'not-used',
      emailVerified: true, // required by verifyWorkspaceAccess -> requireVerifiedEmail
    },
  })
  createdUserIds.push(user.id)

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Product Access Test Workspace',
      slug: `product-access-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId: user.id,
    },
  })

  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: 'Test Product',
      description: 'A product for testing stock display',
      quantity, // intentionally different from `available` below, to prove
      // the two are genuinely distinct values and the fix returns the
      // right one, not just a value that happens to match by coincidence.
    },
  })

  await prisma.inventory.create({
    data: {
      productId: product.id,
      workspaceId: workspace.id,
      quantity,
      available,
      reserved: quantity - available,
    },
  })

  return { user, workspace, product }
}

describe.skipIf(!dbAvailable)('verifyProductAccess — Inventory is included for stock display', () => {
  beforeEach(() => {
    mockAuth.mockReset()
  })

  afterEach(async () => {
    for (const id of createdUserIds.splice(0)) {
      // Workspace -> Product -> Inventory all cascade-delete with the user.
      await prisma.user.delete({ where: { id } }).catch(() => {})
    }
  })

  it('returns Inventory.available distinct from the stale Product.quantity', async () => {
    // Simulates a product created with 10 units, then 7 sold since —
    // Product.quantity is still 10 (never touched by a sale), while
    // Inventory.available correctly reflects 3 remaining.
    const { user, workspace, product } = await createWorkspaceWithProduct(10, 3)
    mockAuth.mockResolvedValue({ user: { id: user.id } })

    const result = await verifyProductAccess(product.id, workspace.id)

    expect(result.quantity).toBe(10) // the stale field, untouched by this fix
    expect(result.inventories).toHaveLength(1)
    expect(result.inventories[0].available).toBe(3) // the real, live figure
    expect(result.inventories[0].available).not.toBe(result.quantity)
  })

  it('still returns images and listings alongside inventories (no regression on the existing include)', async () => {
    const { user, workspace, product } = await createWorkspaceWithProduct(5, 5)
    mockAuth.mockResolvedValue({ user: { id: user.id } })

    const result = await verifyProductAccess(product.id, workspace.id)

    expect(result.images).toEqual([])
    expect(result.listings).toEqual([])
    expect(result.inventories[0].available).toBe(5)
  })

  it('still throws for a product that does not belong to the workspace (no authz regression)', async () => {
    const { product } = await createWorkspaceWithProduct(5, 5)
    const { user: otherUser, workspace: otherWorkspace } = await createWorkspaceWithProduct(1, 1)
    mockAuth.mockResolvedValue({ user: { id: otherUser.id } })

    await expect(verifyProductAccess(product.id, otherWorkspace.id)).rejects.toThrow('Product not found')
  })
})
