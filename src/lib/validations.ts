import { z } from 'zod';

// Auth
export const signUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  country: z.string().default('FR'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const setPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

// Workspace
export const createWorkspaceSchema = z.object({
  name: z.string().min(2, 'Workspace name must be at least 2 characters'),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Invalid slug'),
  description: z.string().optional(),
  country: z.string().default('FR'),
});

// Products
export const createProductSchema = z.object({
  sku: z.string().min(1, 'SKU is required').optional(),
  title: z.string().min(2, 'Title must be at least 2 characters'),
  description: z.string().min(5, 'Description must be at least 5 characters').optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  condition: z.enum(['new', 'like-new', 'good', 'fair', 'used']).default('used'),
  purchasePrice: z.number().min(0, 'Purchase price must be positive'),
  sellingPrice: z.number().min(0, 'Selling price must be positive'),
  fulfillmentCost: z.number().min(0).default(0),
  quantity: z.number().min(1, 'Quantity must be at least 1').default(1),
  location: z.string().optional(),
});

export const updateProductSchema = createProductSchema.partial();

// Listings
export const createListingSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  title: z.string().min(5),
  description: z.string().min(20),
  price: z.number().min(0.01),
  quantity: z.number().min(1),
  marketplaceIds: z.array(z.string()).min(1, 'Select at least one marketplace'),
  fulfillmentType: z.enum(['self', 'automatic']).default('self'),
});

export const updateListingSchema = createListingSchema.partial();

// Orders
export const createOrderSchema = z.object({
  listingId: z.string().min(1),
  customerName: z.string().min(2),
  customerEmail: z.string().email(),
  totalPrice: z.number().min(0.01),
  marketplaceFees: z.number().min(0),
  estimatedProfit: z.number(),
  fulfillmentType: z.enum(['self', 'automatic']).default('self'),
  shippingAddress: z.string().min(5),
  shippingCity: z.string().min(2),
  shippingPostalCode: z.string().min(2),
  shippingCountry: z.string().length(2),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'error']),
});

// Fulfillment
export const createFulfillmentOrderSchema = z.object({
  orderId: z.string().min(1),
  partnerId: z.string().min(1),
  quantity: z.number().min(1),
});

export const updateFulfillmentStatusSchema = z.object({
  status: z.enum(['pending', 'accepted', 'processing', 'shipped', 'delivered', 'failed', 'cancelled']),
});

export const createShipmentSchema = z.object({
  fulfillmentOrderId: z.string().min(1),
  trackingNumber: z.string().min(5),
  carrier: z.string().min(2),
  trackingUrl: z.string().url(),
  estimatedDelivery: z.string().datetime().optional(),
});

// Marketplace Connections
export const connectMarketplaceSchema = z.object({
  marketplaceId: z.string().min(1),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  accountId: z.string().optional(),
});

// Subscriptions
export const changeSubscriptionSchema = z.object({
  planId: z.string().min(1),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreateFulfillmentOrderInput = z.infer<typeof createFulfillmentOrderSchema>;
export type ConnectMarketplaceInput = z.infer<typeof connectMarketplaceSchema>;
export type ChangeSubscriptionInput = z.infer<typeof changeSubscriptionSchema>;
