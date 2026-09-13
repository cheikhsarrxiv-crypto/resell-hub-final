/**
 * AdapterFactory
 * Factory for creating marketplace adapters
 */

import { Marketplace } from '@/types/marketplace'
import { EbayAdapter } from './adapters/EbayAdapter'
import { EtsyAdapter } from './adapters/EtsyAdapter'
import { DepopAdapter } from './adapters/DepopAdapter'
import { VintedAdapter } from './adapters/VintedAdapter'
import MarketplaceAdapter from './MarketplaceAdapter'

export interface MarketplaceAdapterConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  sandboxMode?: boolean
}

export class AdapterFactory {
  static createAdapter(
    marketplace: Marketplace,
    config: MarketplaceAdapterConfig
  ): MarketplaceAdapter {
    switch (marketplace) {
      case Marketplace.EBAY:
        return new EbayAdapter(config)
      case Marketplace.ETSY:
        return new EtsyAdapter(config)
      case Marketplace.DEPOP:
        return new DepopAdapter(config)
      case Marketplace.VINTED:
        return new VintedAdapter(config)
      default:
        throw new Error(`Unsupported marketplace: ${marketplace}`)
    }
  }
}

/**
 * Resolves OAuth client config from environment variables per marketplace.
 * Mirrors the getConnectionConfig() already duplicated in the connect/
 * callback/disconnect routes (src/app/api/marketplace/**), so a caller that
 * only knows the Marketplace value — never a hardcoded marketplace name —
 * can still get the right clientId/clientSecret/redirectUri.
 *
 * Only eBay and Etsy are resolved: those are the only marketplaces with a
 * working OAuth connection flow today (see SUPPORTED_MARKETPLACES in the
 * connect route) — Depop/Vinted intentionally have no case here.
 */
export function getMarketplaceAdapterConfig(marketplace: Marketplace): MarketplaceAdapterConfig {
  switch (marketplace) {
    case Marketplace.EBAY:
      return {
        clientId: process.env.EBAY_CLIENT_ID || '',
        clientSecret: process.env.EBAY_CLIENT_SECRET || '',
        redirectUri: process.env.EBAY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/ebay',
        sandboxMode: process.env.EBAY_SANDBOX_MODE !== 'false',
      }
    case Marketplace.ETSY:
      // Etsy has no sandbox environment — sandboxMode is accepted for
      // config shape consistency but unused by EtsyAdapter.
      return {
        clientId: process.env.ETSY_CLIENT_ID || '',
        clientSecret: process.env.ETSY_CLIENT_SECRET || '',
        redirectUri: process.env.ETSY_REDIRECT_URI || 'http://localhost:3000/api/marketplace/callback/etsy',
        sandboxMode: false,
      }
    default:
      throw new Error(`getMarketplaceAdapterConfig: no configuration resolver for marketplace "${marketplace}"`)
  }
}

export default AdapterFactory
