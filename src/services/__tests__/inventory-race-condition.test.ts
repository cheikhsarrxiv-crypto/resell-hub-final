/**
 * Concurrency tests for the REAL order-creation path:
 * OrderService.createOrder() -> ProductService.reserveInventory()
 *
 * These tests run concurrent reservations against a real PostgreSQL
 * database (not a mock, not an in-memory simulator) to prove the atomic
 * UPDATE ... WHERE available >= quantity pattern actually prevents
 * overselling under real concurrent transactions.
 *
 * They require a reachable DATABASE_URL and are skipped automatically
 * (via describe.skipIf) when no database is reachable, so `npm test`
 * still passes in environments without PostgreSQL configured.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ProductService } from '@/services/ProductService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const createdUserIds: string[] = [];

async function createTestProduct(stock: number) {
  const user = await prisma.user.create({
    data: {
      email: `race-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Race Test User',
      password: 'not-used',
    },
  });
  createdUserIds.push(user.id);

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Race Test Workspace',
      slug: `race-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId: user.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      sku: `RACE-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: 'Race Test Product',
      description: 'Concurrency test product',
      purchasePrice: 5,
      sellingPrice: 10,
      quantity: stock,
    },
  });

  await prisma.inventory.create({
    data: {
      productId: product.id,
      workspaceId: workspace.id,
      quantity: stock,
      available: stock,
      reserved: 0,
      syncStatus: 'synced',
    },
  });

  return { workspaceId: workspace.id, productId: product.id };
}

async function getAvailable(productId: string, workspaceId: string) {
  const inv = await prisma.inventory.findUnique({
    where: { productId_workspaceId: { productId, workspaceId } },
  });
  return inv?.available ?? -1;
}

describe.skipIf(!dbAvailable)(
  'ProductService.reserveInventory — real PostgreSQL concurrency',
  () => {
    afterEach(async () => {
      // Deleting the users cascades to Workspace -> Product/Inventory
      // (onDelete: Cascade all the way down in the schema).
      for (const id of createdUserIds.splice(0)) {
        await prisma.user.delete({ where: { id } }).catch(() => {});
      }
    });

    it('stock = 1, two concurrent orders of 1: exactly one succeeds, final stock = 0, no oversell', async () => {
      const { workspaceId, productId } = await createTestProduct(1);

      const results = await Promise.allSettled([
        ProductService.reserveInventory(productId, workspaceId, 1),
        ProductService.reserveInventory(productId, workspaceId, 1),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect((failed[0] as PromiseRejectedResult).reason.message).toBe('Insufficient inventory');
      expect(await getAvailable(productId, workspaceId)).toBe(0);
    });

    it('stock = 1, five concurrent orders of 1: exactly one succeeds, final stock = 0', async () => {
      const { workspaceId, productId } = await createTestProduct(1);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => ProductService.reserveInventory(productId, workspaceId, 1))
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded).toHaveLength(1);
      expect(await getAvailable(productId, workspaceId)).toBe(0);
    });

    it('stock = 10, two concurrent orders of 5: both succeed, final stock = 0', async () => {
      const { workspaceId, productId } = await createTestProduct(10);

      const results = await Promise.allSettled([
        ProductService.reserveInventory(productId, workspaceId, 5),
        ProductService.reserveInventory(productId, workspaceId, 5),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded).toHaveLength(2);
      expect(await getAvailable(productId, workspaceId)).toBe(0);
    });

    it('stock = 10, two concurrent orders of 6: exactly one succeeds, final stock = 4', async () => {
      const { workspaceId, productId } = await createTestProduct(10);

      const results = await Promise.allSettled([
        ProductService.reserveInventory(productId, workspaceId, 6),
        ProductService.reserveInventory(productId, workspaceId, 6),
      ]);

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(await getAvailable(productId, workspaceId)).toBe(4);
    });

    it('quantity requested greater than stock is refused, stock untouched', async () => {
      const { workspaceId, productId } = await createTestProduct(3);

      await expect(
        ProductService.reserveInventory(productId, workspaceId, 4)
      ).rejects.toThrow('Insufficient inventory');

      expect(await getAvailable(productId, workspaceId)).toBe(3);
    });

    it('stock = 0 is refused', async () => {
      const { workspaceId, productId } = await createTestProduct(0);

      await expect(
        ProductService.reserveInventory(productId, workspaceId, 1)
      ).rejects.toThrow('Insufficient inventory');

      expect(await getAvailable(productId, workspaceId)).toBe(0);
    });

    it('order with multiple products: each product line is protected independently under concurrency', async () => {
      const productA = await createTestProduct(2);
      const productB = await createTestProduct(1);

      // Simulate a single multi-item order reserving 1 of A and 1 of B — as
      // OrderService would do per OrderItem if it looped over multiple items.
      await Promise.all([
        ProductService.reserveInventory(productA.productId, productA.workspaceId, 1),
        ProductService.reserveInventory(productB.productId, productB.workspaceId, 1),
      ]);

      expect(await getAvailable(productA.productId, productA.workspaceId)).toBe(1);
      expect(await getAvailable(productB.productId, productB.workspaceId)).toBe(0);

      // A second, concurrent order racing on the SAME two products must be
      // resolved correctly and independently per product: A still has 1 unit
      // left (should succeed), B is already out of stock (must be refused) —
      // no cross-product leakage in either direction.
      const results = await Promise.allSettled([
        ProductService.reserveInventory(productA.productId, productA.workspaceId, 1),
        ProductService.reserveInventory(productB.productId, productB.workspaceId, 1),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(await getAvailable(productA.productId, productA.workspaceId)).toBe(0);
      expect(await getAvailable(productB.productId, productB.workspaceId)).toBe(0);
    });
  }
);
