/**
 * Multi-marketplace auth architecture (Option B — typed auth strategies).
 * Proves the two auth-capability interfaces are wired to the right
 * concrete adapters, and that the runtime type predicates
 * (isOAuthConnectable/isManualCredentialConnectable) agree with
 * getMarketplaceAuthType() for every real marketplace — no `any` casts
 * anywhere in this file, matching the interfaces' own design.
 */
import { describe, it, expect } from 'vitest';
import {
  Marketplace,
  getMarketplaceAuthType,
  isOAuthConnectable,
  isManualCredentialConnectable,
} from '@/types/marketplace';
import { EbayAdapter } from '@/services/marketplace/adapters/EbayAdapter';
import { EtsyAdapter } from '@/services/marketplace/adapters/EtsyAdapter';
import { DepopAdapter } from '@/services/marketplace/adapters/DepopAdapter';
import { VintedAdapter } from '@/services/marketplace/adapters/VintedAdapter';

const config = { clientId: 'x', clientSecret: 'x', redirectUri: 'http://localhost' };

describe('getMarketplaceAuthType', () => {
  it('classifies eBay, Etsy, and Depop as oauth', () => {
    expect(getMarketplaceAuthType(Marketplace.EBAY)).toBe('oauth');
    expect(getMarketplaceAuthType(Marketplace.ETSY)).toBe('oauth');
    expect(getMarketplaceAuthType(Marketplace.DEPOP)).toBe('oauth');
  });

  it('classifies Vinted as manual_credentials', () => {
    expect(getMarketplaceAuthType(Marketplace.VINTED)).toBe('manual_credentials');
  });
});

describe('OAuthConnectable adapters', () => {
  it.each([
    ['EbayAdapter', new EbayAdapter(config)],
    ['EtsyAdapter', new EtsyAdapter(config)],
    ['DepopAdapter', new DepopAdapter(config)],
  ])('%s satisfies isOAuthConnectable', (_name, adapter) => {
    expect(isOAuthConnectable(adapter)).toBe(true);
    expect(isManualCredentialConnectable(adapter)).toBe(false);
  });

  it('EbayAdapter can genuinely be used as an OAuthConnectable (getOAuthUrl callable without a cast)', () => {
    const adapter = new EbayAdapter(config);
    if (isOAuthConnectable(adapter)) {
      // Inside this guard, TypeScript narrows `adapter` to
      // IMarketplaceAdapter & OAuthConnectable — no `as any` needed to
      // call getOAuthUrl here.
      expect(typeof adapter.getOAuthUrl('state', [])).toBe('string');
    } else {
      throw new Error('EbayAdapter must be OAuthConnectable');
    }
  });
});

describe('ManualCredentialConnectable adapters', () => {
  it('VintedAdapter satisfies isManualCredentialConnectable, not isOAuthConnectable', () => {
    const adapter = new VintedAdapter(config);
    expect(isManualCredentialConnectable(adapter)).toBe(true);
    expect(isOAuthConnectable(adapter)).toBe(false);
  });

  it('VintedAdapter can genuinely be used as a ManualCredentialConnectable (setManualCredentials callable without a cast)', () => {
    const adapter = new VintedAdapter(config);
    if (isManualCredentialConnectable(adapter)) {
      expect(() => adapter.setManualCredentials({ accessKey: 'ak', signingKey: 'sk' })).not.toThrow();
    } else {
      throw new Error('VintedAdapter must be ManualCredentialConnectable');
    }
  });
});
