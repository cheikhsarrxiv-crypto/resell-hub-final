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

export default AdapterFactory
