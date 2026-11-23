import type { Prisma } from '@prisma/client'
import { marketplaceConnectionRefSelect } from '@/lib/marketplaceConnectionPublicSelect'

/**
 * Explicit allowlists for relations that are nested inside JSON API
 * responses (Orders, Listings, Fulfillment). Every route that returns one
 * of these objects must load its relations through these selects instead
 * of `include: { x: true }` / whole-row includes, which also send columns
 * such as FulfillmentPartner.apiKey / webhookUrl or the MarketplaceConnection
 * credentials to the browser.
 *
 * Allowlist on purpose: a column added to a model later stays server-side
 * until someone deliberately adds it here. Internal server code that needs
 * more (publication, sync, dispatch) keeps its own, non-returned queries.
 */

/** FulfillmentPartner: dashboard reads id (to send), name and country. */
export const fulfillmentPartnerPublicSelect = {
  id: true,
  name: true,
  country: true,
} satisfies Prisma.FulfillmentPartnerSelect

/** OrderItem.product: the order pages read only id and sku. */
export const orderProductRefSelect = {
  id: true,
  sku: true,
} satisfies Prisma.ProductSelect

/** Listing.product: detail page reads id, title and image url / isMain. */
export const listingProductPublicSelect = {
  id: true,
  title: true,
  images: {
    select: { id: true, url: true, isMain: true, order: true },
    orderBy: { order: 'asc' },
  },
} satisfies Prisma.ProductSelect

/** Shipment tracking events shown on the order detail page (and by the AI order tools). */
export const trackingEventPublicSelect = {
  id: true,
  status: true,
  location: true,
  description: true,
  timestamp: true,
} satisfies Prisma.TrackingEventSelect

/** Order.listing as returned to the browser (scalars + public connection). */
export const orderListingPublicInclude = {
  include: { connection: { select: marketplaceConnectionRefSelect } },
} satisfies Prisma.Order$listingArgs

/**
 * Full Order response shape (detail / create): scalars + items (product
 * ref), listing (public connection), fulfillment order (public partner,
 * shipment and its tracking events).
 */
export const orderDetailPublicInclude = {
  items: { include: { product: { select: orderProductRefSelect } } },
  listing: orderListingPublicInclude,
  fulfillmentOrder: {
    include: {
      partner: { select: fulfillmentPartnerPublicSelect },
      shipment: {
        include: {
          trackingEvents: {
            select: trackingEventPublicSelect,
            orderBy: { timestamp: 'desc' },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderInclude

/** Order list shape: same as detail minus the tracking-event history. */
export const orderListPublicInclude = {
  items: { include: { product: { select: orderProductRefSelect } } },
  listing: orderListingPublicInclude,
  fulfillmentOrder: {
    include: { partner: { select: fulfillmentPartnerPublicSelect } },
  },
} satisfies Prisma.OrderInclude

/** Listing response where the product is not needed (update / create). */
export const listingConnectionPublicInclude = {
  connection: { select: marketplaceConnectionRefSelect },
} satisfies Prisma.ListingInclude

/**
 * FulfillmentOrder responses: the fulfillment dashboard reads partner
 * name/country, shipment tracking number and order id / customerName.
 */
export const fulfillmentOrderPublicInclude = {
  partner: { select: fulfillmentPartnerPublicSelect },
} satisfies Prisma.FulfillmentOrderInclude

export const fulfillmentOrderDetailPublicInclude = {
  order: { include: orderListPublicInclude },
  partner: { select: fulfillmentPartnerPublicSelect },
  shipment: {
    include: {
      trackingEvents: {
        select: trackingEventPublicSelect,
        orderBy: { timestamp: 'desc' },
      },
    },
  },
} satisfies Prisma.FulfillmentOrderInclude

// ---------------------------------------------------------------------------
// R3-B.5.7 - data minimisation: RESPONSE selects.
//
// What the browser receives is limited to the fields the dashboard actually
// reads (inventory in the R3-B.5.6 audit). Everything else - the recipient
// phone / email, second address line, state, customerId, purchasePrice,
// externalOrderId, trackingUrl, internal ids, workspaceId - stays
// server-side. Internal callers (AI tools, publication, sync, dispatch)
// keep using the methods that load more (OrderService.getOrder,
// ListingService.getListing, ...) and never feed these selects.
// ---------------------------------------------------------------------------

/** GET /api/orders - orders list page reads only these columns; no relations. */
export const orderListResponseSelect = {
  id: true,
  fulfillmentType: true,
  currency: true,
  totalPrice: true,
  status: true,
  estimatedProfit: true,
  customerName: true,
  customerEmail: true,
  createdAt: true,
} satisfies Prisma.OrderSelect

/** GET /api/orders/[id] and POST /api/orders - order detail page. */
export const orderDetailResponseSelect = {
  id: true,
  status: true,
  currency: true,
  totalPrice: true,
  marketplaceFees: true,
  estimatedProfit: true,
  fulfillmentType: true,
  customerName: true,
  customerEmail: true,
  shippingAddress: true,
  shippingCity: true,
  shippingPostalCode: true,
  shippingCountry: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      title: true,
      quantity: true,
      price: true,
      product: { select: orderProductRefSelect },
    },
  },
  listing: {
    select: {
      id: true,
      title: true,
      connection: { select: marketplaceConnectionRefSelect },
    },
  },
  fulfillmentOrder: {
    select: {
      id: true,
      status: true,
      totalCost: true,
      profit: true,
      shipment: {
        select: {
          trackingNumber: true,
          carrier: true,
          trackingEvents: {
            select: {
              id: true,
              status: true,
              location: true,
              timestamp: true,
            },
            orderBy: { timestamp: 'desc' },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect

/** GET /api/listings - listings list page. */
export const listingListResponseSelect = {
  id: true,
  title: true,
  price: true,
  syncStatus: true,
  createdAt: true,
  connection: { select: marketplaceConnectionRefSelect },
} satisfies Prisma.ListingSelect

/** GET /api/listings/[id] - listing detail page. */
export const listingDetailResponseSelect = {
  id: true,
  title: true,
  description: true,
  price: true,
  quantity: true,
  syncStatus: true,
  syncError: true,
  externalId: true,
  createdAt: true,
  product: { select: listingProductPublicSelect },
  connection: { select: marketplaceConnectionRefSelect },
} satisfies Prisma.ListingSelect

/** POST / PATCH /api/listings - the client reads syncStatus / syncError. */
export const listingMutationResponseSelect = {
  id: true,
  title: true,
  description: true,
  price: true,
  quantity: true,
  syncStatus: true,
  syncError: true,
  externalId: true,
  connection: { select: marketplaceConnectionRefSelect },
} satisfies Prisma.ListingSelect

/** GET /api/fulfillment - fulfillment dashboard rows. */
export const fulfillmentOrderListResponseSelect = {
  id: true,
  status: true,
  totalCost: true,
  profit: true,
  quantity: true,
  createdAt: true,
  partner: { select: fulfillmentPartnerPublicSelect },
  order: { select: { id: true, customerName: true } },
  shipment: { select: { trackingNumber: true } },
} satisfies Prisma.FulfillmentOrderSelect

/** POST /api/fulfillment/send - the client only checks response.ok. */
export const fulfillmentOrderSendResponseSelect = {
  id: true,
  status: true,
  totalCost: true,
  profit: true,
  quantity: true,
  createdAt: true,
  partner: { select: fulfillmentPartnerPublicSelect },
} satisfies Prisma.FulfillmentOrderSelect
