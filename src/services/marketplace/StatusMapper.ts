/**
 * StatusMapper
 * Map marketplace-specific order statuses to ResellHub common format
 * 
 * STATUS: REAL - Ready for use
 */

import { Marketplace } from "@/types/marketplace"

export type ResellHubOrderStatus = 
  | "pending"
  | "confirmed"
  | "shipped"
  | "partially_shipped"
  | "delivered"
  | "cancelled"
  | "failed"

export class StatusMapper {
  /**
   * Convert marketplace status to ResellHub status
   */
  static mapToResellHub(
    marketplace: Marketplace,
    marketplaceStatus: string
  ): ResellHubOrderStatus {
    switch (marketplace) {
      case Marketplace.EBAY:
        return this.mapEbayStatus(marketplaceStatus)
      case Marketplace.ETSY:
        return this.mapEtsyStatus(marketplaceStatus)
      case Marketplace.DEPOP:
        return this.mapDepopStatus(marketplaceStatus)
      case Marketplace.VINTED:
        return this.mapVintedStatus(marketplaceStatus)
      default:
        return "pending"
    }
  }

  /**
   * eBay order statuses
   * https://developer.ebay.com/docs/sell/fulfillment/orders/
   */
  private static mapEbayStatus(status: string): ResellHubOrderStatus {
    switch (status.toUpperCase()) {
      case "INCOMPLETE":
        return "pending"
      case "IN_PROCESS":
        return "confirmed"
      case "FULFILLED":
        return "shipped"
      case "CANCELLED":
        return "cancelled"
      default:
        return "pending"
    }
  }

  /**
   * Etsy order statuses
   * https://developers.etsy.com/documentation/reference#models-Order
   */
  private static mapEtsyStatus(status: string): ResellHubOrderStatus {
    switch (status.toUpperCase()) {
      case "PAID":
        return "confirmed"
      case "PARTIALLY_FULFILLED":
        return "partially_shipped"
      case "FULFILLED":
        return "shipped"
      case "CANCELLED":
        return "cancelled"
      case "OPEN":
        return "pending"
      default:
        return "pending"
    }
  }

  private static mapDepopStatus(status: string): ResellHubOrderStatus {
    // Depop has limited API, default mapping
    return "pending"
  }

  private static mapVintedStatus(status: string): ResellHubOrderStatus {
    // Vinted not supported
    return "pending"
  }

  /**
   * Get human-readable status for display
   */
  static getDisplayName(status: ResellHubOrderStatus): string {
    const names: Record<ResellHubOrderStatus, string> = {
      pending: "Pending",
      confirmed: "Confirmed",
      shipped: "Shipped",
      partially_shipped: "Partially Shipped",
      delivered: "Delivered",
      cancelled: "Cancelled",
      failed: "Failed",
    }
    return names[status] || status
  }
}

export default StatusMapper
