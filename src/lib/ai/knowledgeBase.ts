/**
 * Static knowledge base for the ADKSY AI Assistant (V1).
 *
 * Deliberately plain text, not RAG/embeddings — V1 explains a small, fixed
 * set of real ADKSY features. Every claim below must match what the
 * product actually does today; when ADKSY's real capabilities change,
 * update this text rather than letting the assistant drift out of sync.
 * Do not describe eBay/Etsy as more automated than they are, do not
 * describe Depop/Vinted as available, and do not describe fulfillment as
 * fully automatic (it's a one-click merchant action, then tracking is
 * automatic) — this mirrors the corrected landing page copy.
 */
export const ADKSY_KNOWLEDGE_BASE = `
ADKSY is a reselling operating system: it helps sellers manage products, listings, orders and fulfillment from one place, across multiple marketplaces.

## Products
Sellers create a Product for each item they source: purchase price, selling price, quantity in stock, and an optional description/category. Products live under Dashboard > Products. A product can have photos uploaded to it after creation.

## Photos
Product photos are uploaded from a product's own page (Dashboard > Products > a product > Images). Multiple images per product are supported, one can be marked as the main image, and images can be reordered.

## Listings
A Listing publishes a Product to a specific connected marketplace (currently eBay or Etsy). One product can have multiple listings across marketplaces. Listings are created from Dashboard > Listings > Create Listing, by choosing a product, a connected marketplace, and a price/quantity.

## Orders
Orders from connected marketplaces appear under Dashboard > Orders, where sellers can track status, customer details, and estimated profit per order.

## Marketplace Integrations
Dashboard > Settings > Integrations lets a seller connect eBay and Etsy accounts via OAuth ("Connect eBay" / "Connect Etsy" buttons).
- eBay: fully automated today — real OAuth connection, listing publish, and order sync.
- Etsy: connected via real OAuth too, but treated as "in review" — Etsy's own commercial app review and some listing field requirements can currently limit production use.
- Depop and Vinted are on the roadmap and not available yet — do not tell a user they can connect these today.

## Fulfillment
Fulfillment is not fully automatic. A seller sends a specific order to a fulfillment partner with one click (Dashboard > Fulfillment), after which ADKSY automatically tracks cost, revenue and profit for that shipment.

## Dashboard
The Dashboard home page shows an overview: recent activity and key stats (products, listings, orders, connected marketplaces).

## Settings
Dashboard > Settings covers account settings, marketplace integrations, and subscription/plan management.

## Subscription / Plans
ADKSY has three plans: Starter (up to 500 orders/month), Pro (up to 2,000 orders/month), and Business (up to 10,000 orders/month), billed monthly or annually. Plan limits apply to things like number of connected marketplaces and listings — a seller who hits a limit should be pointed to Dashboard > Settings > Subscription to upgrade.

## What this assistant can do (V1)
This assistant can explain ADKSY's features and guide a user through steps in the product. It cannot create, edit, or delete anything on a user's behalf, cannot connect/disconnect marketplaces, and cannot place orders or trigger fulfillment — those actions must be done by the user directly in the interface.
`.trim();

export const ADKSY_AI_FALLBACK_MESSAGE =
  "I'm not sure about that yet. Please contact ADKSY support.";

/**
 * Human-readable label for the optional page-context hint the frontend
 * sends, used to nudge the assistant toward page-specific guidance
 * without treating the value as an instruction from the user.
 */
export const CURRENT_PAGE_LABELS: Record<string, string> = {
  dashboard: 'the Dashboard home page',
  products: 'the Products page',
  listings: 'the Listings page',
  orders: 'the Orders page',
  settings: 'the Settings page',
  integrations: 'the Marketplace Integrations page',
};
