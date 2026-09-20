import { z } from 'zod';
import { OrderService } from '@/services/OrderService';
import { AgentToolDefinition } from './types';

const getCustomerInputSchema = z.object({
  orderId: z.string().min(1, 'orderId is required'),
});

/**
 * There is no Customer/Buyer model anywhere in prisma/schema.prisma —
 * customer/contact data is denormalized directly onto Order's own scalar
 * columns (customerId/customerName/customerEmail/shipping*), populated
 * from the marketplace at order-sync time. No separate billing address
 * exists either — only shipping* fields. This formatter reads exactly
 * those Order columns, nothing else — never spreads `order.listing` or
 * any other relation, so a marketplace connection's own credentials
 * (which OrderService.getOrder's query does fetch, for unrelated reasons)
 * can never leak through here.
 *
 * customerEmail (the buyer account's own email) and shippingEmail (the
 * package recipient's email, "when the marketplace provides one" — see
 * that column's own schema comment) are two distinct real columns that
 * can differ — never merged or assumed equal. Same for customerName vs.
 * a first/last name split: Order.customerName is a single free-text
 * field, never parsed into parts that aren't actually stored.
 */
function formatCustomerForAgent(order: NonNullable<Awaited<ReturnType<typeof OrderService.getOrder>>>) {
  return {
    orderId: order.id,
    // The marketplace's own buyer identifier — not an ADKSY internal id,
    // never assumed to be one.
    customerId: order.customerId,
    name: order.customerName,
    email: order.customerEmail,
    // ADKSY does not distinguish a billing address from a shipping one —
    // only a shipping address is ever stored, for real.
    shippingAddress: {
      line1: order.shippingAddress,
      line2: order.shippingAddress2 ?? null,
      city: order.shippingCity,
      state: order.shippingState ?? null,
      postalCode: order.shippingPostalCode,
      country: order.shippingCountry,
    },
    shippingPhone: order.shippingPhone ?? null,
    // May differ from `email` above — never assumed to be the same person/address.
    shippingEmail: order.shippingEmail ?? null,
  };
}

export const getCustomerTool: AgentToolDefinition<{ orderId: string }> = {
  name: 'get_customer',
  description:
    "Look up the customer/contact information for a single existing order belonging to the reseller's own workspace, by its ADKSY order id — " +
    'to answer factual questions like who the customer is, their shipping address, or their contact email/phone for that order. ' +
    'Read-only — never modifies anything, never contacts the customer, never requires confirmation. ' +
    'ADKSY stores no separate Customer/Buyer record and no distinct billing address — only what the marketplace provided for this specific order ' +
    "(a customer name, an account email, and a shipping address/phone/email, which can differ from the account email). " +
    "Returns { found: false } if the order doesn't exist in this workspace — never another workspace's order or its customer data.",
  category: 'read',
  inputSchema: getCustomerInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      orderId: {
        type: 'string',
        description: 'The ADKSY order id (Order.id), not a marketplace external order id.',
      },
    },
    required: ['orderId'],
  },
  async handler(workspaceId, input) {
    // OrderService.getOrder's `findFirst({ where: { id, workspaceId } })`
    // is the actual isolation boundary — an orderId from another
    // workspace simply matches no row and comes back null, exactly like
    // get_order/get_listing/get_shipment. All the fields this tool needs
    // are plain scalar columns already on the base Order row — no new
    // query or include required.
    const order = await OrderService.getOrder(input.orderId, workspaceId);

    if (!order) {
      return { found: false };
    }

    return { found: true, customer: formatCustomerForAgent(order) };
  },
};
