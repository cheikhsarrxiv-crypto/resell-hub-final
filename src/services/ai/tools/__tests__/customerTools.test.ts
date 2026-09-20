/**
 * Real behavioral tests for get_customer — a read-only agent tool, same
 * conventions as get_order/get_listing/get_shipment: auto-executable, no
 * confirmation, workspace isolation is the real OrderService.getOrder
 * `findFirst({ id, workspaceId })` boundary. No Customer/Buyer model
 * exists — all fields are plain Order columns, so no new Prisma query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOrderMock } = vi.hoisted(() => ({ getOrderMock: vi.fn() }));

vi.mock('@/services/OrderService', () => ({
  OrderService: { getOrder: getOrderMock },
}));

import { AiToolRegistry } from '@/services/ai/AiToolRegistry';
import { getCustomerTool } from '@/services/ai/tools/customerTools';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    workspaceId: 'ws-1',
    customerId: 'buyer-abc-123',
    customerName: 'Alice Martin',
    customerEmail: 'alice@example.com',
    shippingAddress: '123 Rue de Paris',
    shippingAddress2: 'Apt 4B',
    shippingCity: 'Paris',
    shippingState: null,
    shippingPostalCode: '75001',
    shippingCountry: 'FR',
    shippingPhone: '+33612345678',
    shippingEmail: null,
    // Fields OrderService.getOrder's real query also returns, deliberately
    // included here to prove they never leak through get_customer's
    // explicit allow-list formatter.
    listing: {
      connection: {
        apiKey: 'real-api-key',
        encryptedOauthToken: 'real-encrypted-token',
        marketplace: { name: 'ebay', displayName: 'eBay' },
      },
    },
    ...overrides,
  };
}

describe('get_customer tool definition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered in AiToolRegistry as a read tool — auto-executable, no confirmation', () => {
    const tool = AiToolRegistry.get('get_customer');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable('read')).toBe(true);
  });

  it('rejects an input missing orderId', () => {
    expect(getCustomerTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a valid orderId input', () => {
    expect(getCustomerTool.inputSchema.safeParse({ orderId: 'order-1' }).success).toBe(true);
  });

  it('order in the SAME workspace -> success, full correct mapping', async () => {
    getOrderMock.mockResolvedValue(makeOrder());

    const result: any = await getCustomerTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.found).toBe(true);
    expect(result.customer).toEqual({
      orderId: 'order-1',
      customerId: 'buyer-abc-123',
      name: 'Alice Martin',
      email: 'alice@example.com',
      shippingAddress: {
        line1: '123 Rue de Paris',
        line2: 'Apt 4B',
        city: 'Paris',
        state: null,
        postalCode: '75001',
        country: 'FR',
      },
      shippingPhone: '+33612345678',
      shippingEmail: null,
    });
    expect(getOrderMock).toHaveBeenCalledWith('order-1', 'ws-1');
  });

  it('unknown order -> controlled { found: false } response, never throws', async () => {
    getOrderMock.mockResolvedValue(null);

    const result: any = await getCustomerTool.handler('ws-1', { orderId: 'does-not-exist' });

    expect(result).toEqual({ found: false });
  });

  it('an order belonging to ANOTHER workspace -> refused, reveals no customer data (relies on OrderService.getOrder\'s own workspace-scoped query)', async () => {
    getOrderMock.mockImplementation(async (orderId: string, workspaceId: string) => {
      if (workspaceId !== 'ws-A') return null; // simulates the order being owned by ws-A only
      return makeOrder({ workspaceId: 'ws-A' });
    });

    const result: any = await getCustomerTool.handler('ws-B', { orderId: 'order-1' });

    expect(result).toEqual({ found: false });
    expect(getOrderMock).toHaveBeenCalledWith('order-1', 'ws-B');
  });

  it('optional fields absent -> come back null, never invented', async () => {
    getOrderMock.mockResolvedValue(
      makeOrder({ shippingAddress2: null, shippingState: null, shippingPhone: null, shippingEmail: null })
    );

    const result: any = await getCustomerTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.customer.shippingAddress.line2).toBeNull();
    expect(result.customer.shippingAddress.state).toBeNull();
    expect(result.customer.shippingPhone).toBeNull();
    expect(result.customer.shippingEmail).toBeNull();
  });

  it('customerEmail and shippingEmail are kept distinct — never merged or assumed equal', async () => {
    getOrderMock.mockResolvedValue(makeOrder({ customerEmail: 'account@example.com', shippingEmail: 'recipient@example.com' }));

    const result: any = await getCustomerTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.customer.email).toBe('account@example.com');
    expect(result.customer.shippingEmail).toBe('recipient@example.com');
  });

  it('customerName is never split into first/last name — returned exactly as stored', async () => {
    getOrderMock.mockResolvedValue(makeOrder({ customerName: 'Alice Martin' }));

    const result: any = await getCustomerTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.customer.name).toBe('Alice Martin');
    expect(result.customer).not.toHaveProperty('firstName');
    expect(result.customer).not.toHaveProperty('lastName');
  });

  it('no billing address is ever fabricated — ADKSY has no such field', async () => {
    getOrderMock.mockResolvedValue(makeOrder());

    const result: any = await getCustomerTool.handler('ws-1', { orderId: 'order-1' });

    expect(result.customer).not.toHaveProperty('billingAddress');
  });

  it('never leaks marketplace connection secrets even though OrderService.getOrder\'s raw result carries them', async () => {
    getOrderMock.mockResolvedValue(makeOrder());

    const result: any = await getCustomerTool.handler('ws-1', { orderId: 'order-1' });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('real-api-key');
    expect(serialized).not.toContain('real-encrypted-token');
  });

  it('is a pure read — calls OrderService.getOrder exactly once, nothing else', async () => {
    getOrderMock.mockResolvedValue(makeOrder());

    await getCustomerTool.handler('ws-1', { orderId: 'order-1' });

    expect(getOrderMock).toHaveBeenCalledTimes(1);
  });

  it('registered correctly in AiToolRegistry (get() returns the real tool definition)', () => {
    expect(AiToolRegistry.get('get_customer')).toBe(getCustomerTool);
  });

  it('classified "read" and auto-executable without confirmation', () => {
    expect(getCustomerTool.category).toBe('read');
    expect(AiToolRegistry.isAutoExecutable(getCustomerTool.category)).toBe(true);
  });
});
