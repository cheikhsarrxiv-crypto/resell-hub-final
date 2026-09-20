/**
 * Real behavioral tests for get_customer_orders — a read-only agent tool.
 * No Customer model exists (confirmed by audit) — Order.customerId/
 * customerEmail are the only real identity fields, both required and
 * denormalized directly on Order. Workspace isolation is enforced by
 * always including workspaceId in the same Prisma `where` as
 * customerId/customerEmail — never a bare, unscoped lookup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { orderFindManyMock, orderCountMock } = vi.hoisted(() => ({
  orderFindManyMock: vi.fn(),
  orderCountMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    order: { findMany: orderFindManyMock, count: orderCountMock },
  },
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getCustomerOrdersTool } from '@/services/ai/tools/customerOrderTools';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    workspaceId: 'ws-1',
    customerId: 'buyer-abc-123',
    customerName: 'Alice Martin',
    customerEmail: 'alice@example.com',
    status: 'shipped',
    totalPrice: 449,
    marketplace: 'ebay',
    createdAt: new Date('2026-02-05T00:00:00Z'),
    items: [
      { productId: 'product-1', title: 'Prada Sneakers', quantity: 1, price: 449, product: { sku: 'SKU-PRADA-1' } },
    ],
    ...overrides,
  };
}

describe('get_customer_orders tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as a read tool — auto-executable, no confirmation', () => {
    const tool = AiToolRegistry.get('get_customer_orders');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
  });

  it('rejects an input with neither customerId nor email', () => {
    expect(getCustomerOrdersTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it('1. search by customerId', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(result.found).toBe(true);
    expect(orderFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1', customerId: 'buyer-abc-123' } })
    );
  });

  it('2. search by email', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { email: 'alice@example.com' });

    expect(result.found).toBe(true);
    expect(orderFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1', customerEmail: 'alice@example.com' } })
    );
  });

  it('both customerId and email provided -> matched together (AND), never OR, never mixing two customers', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123', email: 'alice@example.com' });

    expect(orderFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1', customerId: 'buyer-abc-123', customerEmail: 'alice@example.com' } })
    );
  });

  it('3. workspace isolation by customerId — the same customerId in another workspace never matches', async () => {
    orderFindManyMock.mockImplementation(async ({ where }: any) => (where.workspaceId === 'ws-A' ? [makeOrder({ workspaceId: 'ws-A' })] : []));
    orderCountMock.mockImplementation(async ({ where }: any) => (where.workspaceId === 'ws-A' ? 1 : 0));

    const result: any = await getCustomerOrdersTool.handler('ws-B', { customerId: 'buyer-abc-123' });

    expect(result).toEqual({ found: false });
    expect(orderFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'ws-B', customerId: 'buyer-abc-123' } }));
  });

  it('4. workspace isolation by email — the same email in another workspace never matches', async () => {
    orderFindManyMock.mockImplementation(async ({ where }: any) => (where.workspaceId === 'ws-A' ? [makeOrder({ workspaceId: 'ws-A' })] : []));
    orderCountMock.mockImplementation(async ({ where }: any) => (where.workspaceId === 'ws-A' ? 1 : 0));

    const result: any = await getCustomerOrdersTool.handler('ws-B', { email: 'alice@example.com' });

    expect(result).toEqual({ found: false });
  });

  it('5. non-existent customer -> controlled { found: false }, never throws', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { customerId: 'does-not-exist' });

    expect(result).toEqual({ found: false });
  });

  it('6. a customer with no orders -> { found: false }, never fabricated', async () => {
    orderFindManyMock.mockResolvedValue([]);
    orderCountMock.mockResolvedValue(0);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { email: 'nobody@example.com' });

    expect(result).toEqual({ found: false });
  });

  it('7. multiple orders are all returned', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder({ id: 'order-1' }), makeOrder({ id: 'order-2' })]);
    orderCountMock.mockResolvedValue(2);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(result.orders).toHaveLength(2);
    expect(result.totalOrders).toBe(2);
  });

  it('8. orders are requested in descending date order (newest first)', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(orderFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));
  });

  it('9. OrderItems are correctly mapped', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(result.orders[0].items).toHaveLength(1);
    expect(result.orders[0].items[0].productId).toBe('product-1');
    expect(result.orders[0].items[0].title).toBe('Prada Sneakers');
  });

  it('10. linked Product is joined in the same query (no N+1) and its SKU is used', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(orderFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ include: { items: { include: { product: { select: { sku: true } } } } } })
    );
    expect(orderFindManyMock).toHaveBeenCalledTimes(1); // single query, never one per order
  });

  it('11. SKU comes from the joined Product, never invented — OrderItem has no sku column of its own', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(result.orders[0].items[0].sku).toBe('SKU-PRADA-1');
  });

  it('12. quantity is correctly returned', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder({ items: [{ productId: 'product-1', title: 'X', quantity: 3, price: 100, product: { sku: 'SKU-X' } }] })]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(result.orders[0].items[0].quantity).toBe(3);
  });

  it('13. unitPrice/totalAmount are returned from the real Order/OrderItem fields — no currency invented', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder({ totalPrice: 199.5 })]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(result.orders[0].totalAmount).toBe(199.5);
    expect(result.orders[0].items[0].unitPrice).toBe(449);
    expect(result.orders[0]).not.toHaveProperty('currency');
  });

  it('14. marketplace is returned when real, null when absent — never invented', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder({ marketplace: null })]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(result.orders[0].marketplace).toBeNull();
  });

  it('15. result limit matches the codebase-wide convention (50), reused rather than invented', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(orderFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('totalOrders reports the REAL total count, even beyond the returned page size', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]); // only 1 returned
    orderCountMock.mockResolvedValue(73); // but 73 really exist

    const result: any = await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });

    expect(result.totalOrders).toBe(73);
    expect(result.orders).toHaveLength(1);
  });

  it('16. no secret/technical noise ever appears in the output', async () => {
    orderFindManyMock.mockResolvedValue([makeOrder()]);
    orderCountMock.mockResolvedValue(1);

    const result: any = await getCustomerOrdersTool.handler('ws-1', { customerId: 'buyer-abc-123' });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/apiKey|apiSecret|token|secret|password/i);
  });

  it('17. registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('get_customer_orders')).toBe(getCustomerOrdersTool);
  });

  it('18. classified "read"', () => {
    expect(getCustomerOrdersTool.category).toBe('read');
  });

  it('19. auto-executable without confirmation', () => {
    expect(AiToolRegistry.isAutoExecutable(getCustomerOrdersTool.category)).toBe(true);
  });
});
