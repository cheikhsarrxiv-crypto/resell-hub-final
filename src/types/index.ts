// User & Auth
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  country: string;
  createdAt: Date;
}

// Subscription & Billing
export interface PlanDetails {
  id: string;
  name: string;
  displayName: string;
  price: number;
  maxProducts: number;
  maxListings: number;
  maxOrders: number;
  maxMarketplaces: number;
  maxUsers: number;
  fulfillmentEnabled: boolean;
  advancedAnalytics: boolean;
  apiAccess: boolean;
}

// Products
export interface ProductData {
  id: string;
  sku: string;
  title: string;
  description: string;
  brand?: string;
  category?: string;
  size?: string;
  color?: string;
  condition: string;
  purchasePrice: number;
  sellingPrice: number;
  fulfillmentCost: number;
  fees: number;
  quantity: number;
  location?: string;
  images?: ProductImageData[];
  createdAt: Date;
}

export interface ProductImageData {
  id: string;
  url: string;
  altText?: string;
  isMain: boolean;
  order: number;
}

// Listings
export interface ListingData {
  id: string;
  productId: string;
  title: string;
  price: number;
  quantity: number;
  status: 'active' | 'delisted' | 'sold_out' | 'paused';
  syncStatus: 'not_synced' | 'syncing' | 'synced' | 'failed';
  marketplaceConnection: {
    id: string;
    marketplace: {
      name: string;
      displayName: string;
    };
  };
  createdAt: Date;
}

// Orders
export interface OrderData {
  id: string;
  externalOrderId?: string;
  customerName: string;
  customerEmail: string;
  totalPrice: number;
  marketplaceFees: number;
  estimatedProfit: number;
  status: OrderStatus;
  fulfillmentType: 'self' | 'automatic';
  shippingAddress: string;
  shippingCity: string;
  shippingCountry: string;
  items: OrderItemData[];
  fulfillmentOrder?: FulfillmentOrderData;
  createdAt: Date;
}

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'error';

export interface OrderItemData {
  id: string;
  title: string;
  quantity: number;
  price: number;
  product: {
    id: string;
    sku: string;
  };
}

// Fulfillment
export interface FulfillmentOrderData {
  id: string;
  orderId: string;
  status: FulfillmentStatus;
  quantity: number;
  totalCost: number;
  revenue: number;
  profit: number;
  partner: {
    id: string;
    name: string;
  };
  shipment?: ShipmentData;
  createdAt: Date;
}

export type FulfillmentStatus = 'pending' | 'accepted' | 'processing' | 'shipped' | 'delivered' | 'failed' | 'cancelled';

export interface ShipmentData {
  id: string;
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
  status: string;
  estimatedDelivery?: Date;
  actualDelivery?: Date;
  trackingEvents: TrackingEventData[];
}

export interface TrackingEventData {
  id: string;
  status: string;
  location?: string;
  description?: string;
  timestamp: Date;
}

// Analytics
export interface DashboardMetrics {
  revenue: number;
  orders: number;
  profit: number;
  margin: number;
  productsCount: number;
  activeListings: number;
  pendingOrders: number;
  fulfillmentOrders: number;
  revenueByMarketplace: Record<string, number>;
  profitByMarketplace: Record<string, number>;
  fulfillmentRevenue: number;
  fulfillmentCost: number;
  grossProfit: number;
  netRevenue: number;
}

export interface AdminMetrics {
  totalUsers: number;
  activeUsers: number;
  mrr: number;
  arr: number;
  totalOrders: number;
  gmv: number;
  fulfillmentRevenue: number;
  fulfillmentCosts: number;
  grossProfit: number;
  churn: number;
  arpu: number;
  ordersPerUser: number;
  subscriptionsByPlan: Record<string, number>;
}

// API Response
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Marketplace Adapter
export interface MarketplaceAdapter {
  name: string;
  displayName: string;
  createListing(data: CreateListingRequest): Promise<CreateListingResponse>;
  updateListing(externalId: string, data: UpdateListingRequest): Promise<void>;
  deleteListing(externalId: string): Promise<void>;
  getInventory(externalId: string): Promise<number>;
  syncInventory(externalId: string, quantity: number): Promise<void>;
  validateCredentials(apiKey: string): Promise<boolean>;
}

export interface CreateListingRequest {
  title: string;
  description: string;
  price: number;
  quantity: number;
  sku: string;
  images: string[];
  condition?: string;
  category?: string;
}

export interface CreateListingResponse {
  externalId: string;
  url: string;
  status: string;
}

export interface UpdateListingRequest {
  title?: string;
  description?: string;
  price?: number;
  quantity?: number;
}
