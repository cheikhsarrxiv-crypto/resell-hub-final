/**
 * R3-B.5 / R3-B.5.7 — the allowlists used for API responses (Orders,
 * Listings, Fulfillment) contain no credential, personal or internal field
 * that the dashboard does not read, and still contain every field it does.
 * Pure unit test: no DB, no network.
 */
import { describe, it, expect } from 'vitest';
import { marketplaceConnectionRefSelect } from '@/lib/marketplaceConnectionPublicSelect';
import {
  fulfillmentPartnerPublicSelect,
  orderProductRefSelect,
  listingProductPublicSelect,
  trackingEventPublicSelect,
  orderDetailPublicInclude,
  listingConnectionPublicInclude,
  fulfillmentOrderPublicInclude,
  fulfillmentOrderDetailPublicInclude,
  orderListResponseSelect,
  orderDetailResponseSelect,
  listingListResponseSelect,
  listingDetailResponseSelect,
  listingMutationResponseSelect,
  fulfillmentOrderListResponseSelect,
  fulfillmentOrderSendResponseSelect,
} from '@/lib/publicResponseSelects';

const CREDENTIAL_KEYS = [
  'apiKey', 'apiSecret', 'encryptedOauthToken', 'encryptedRefreshToken', 'accountEmail',
  'tokenExpiresAt', 'sellerId', 'accountId', 'webhookUrl', 'apiUrl', 'providerId',
];

/** Fields that must never appear anywhere in a RESPONSE select (R3-B.5.6). */
const MINIMISED_AWAY = [
  'purchasePrice', 'customerId', 'shippingEmail', 'shippingPhone', 'shippingAddress2',
  'shippingState', 'externalOrderId', 'trackingUrl', 'estimatedDelivery', 'actualDelivery',
  'workspaceId', 'revenue', 'orders',
];

function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

const trueKeys = (select: Record<string, unknown>) =>
  Object.entries(select).filter(([, v]) => v === true).map(([k]) => k).sort();
const relationKeys = (select: Record<string, unknown>) =>
  Object.entries(select).filter(([, v]) => v !== true).map(([k]) => k).sort();

describe('every public select / include — no credential keys', () => {
  const all: Record<string, unknown> = {
    marketplaceConnectionRefSelect,
    fulfillmentPartnerPublicSelect,
    orderProductRefSelect,
    listingProductPublicSelect,
    trackingEventPublicSelect,
    orderDetailPublicInclude,
    listingConnectionPublicInclude,
    fulfillmentOrderPublicInclude,
    fulfillmentOrderDetailPublicInclude,
    orderListResponseSelect,
    orderDetailResponseSelect,
    listingListResponseSelect,
    listingDetailResponseSelect,
    listingMutationResponseSelect,
    fulfillmentOrderListResponseSelect,
    fulfillmentOrderSendResponseSelect,
  };
  for (const [name, value] of Object.entries(all)) {
    it(name, () => {
      const keys = collectKeys(value);
      for (const forbidden of CREDENTIAL_KEYS) {
        expect(keys.has(forbidden), `${name} must not contain ${forbidden}`).toBe(false);
      }
      expect([...keys].some((k) => k.startsWith('encrypted'))).toBe(false);
    });
  }
});

describe('RESPONSE selects — minimised (no personal / financial / internal extras)', () => {
  const responseSelects: Record<string, unknown> = {
    orderListResponseSelect,
    orderDetailResponseSelect,
    listingListResponseSelect,
    listingDetailResponseSelect,
    listingMutationResponseSelect,
    fulfillmentOrderListResponseSelect,
    fulfillmentOrderSendResponseSelect,
  };
  for (const [name, value] of Object.entries(responseSelects)) {
    it(`${name} excludes the R3-B.5.6 fields`, () => {
      const keys = collectKeys(value);
      for (const f of MINIMISED_AWAY) {
        expect(keys.has(f), `${name} must not select ${f}`).toBe(false);
      }
    });
  }
});

describe('exact allowlists', () => {
  it('marketplaceConnectionRefSelect', () => {
    expect(marketplaceConnectionRefSelect).toEqual({
      id: true,
      marketplaceId: true,
      marketplace: { select: { name: true, displayName: true } },
    });
  });

  it('fulfillmentPartnerPublicSelect is exactly id, name, country', () => {
    expect(fulfillmentPartnerPublicSelect).toEqual({ id: true, name: true, country: true });
  });

  it('orderProductRefSelect is exactly id, sku', () => {
    expect(orderProductRefSelect).toEqual({ id: true, sku: true });
  });

  it('orders list: exactly the 9 columns the page reads (currency added by S8), no relation', () => {
    expect(trueKeys(orderListResponseSelect)).toEqual(
      ['createdAt', 'currency', 'customerEmail', 'customerName', 'estimatedProfit', 'fulfillmentType', 'id', 'status', 'totalPrice']
    );
    expect(relationKeys(orderListResponseSelect)).toEqual([]);
  });

  it('order detail: exact columns and relations', () => {
    expect(trueKeys(orderDetailResponseSelect)).toEqual(
      [
        'createdAt', 'currency', 'customerEmail', 'customerName', 'estimatedProfit', 'fulfillmentType', 'id',
        'marketplaceFees', 'shippingAddress', 'shippingCity', 'shippingCountry', 'shippingPostalCode',
        'status', 'totalPrice',
      ]
    );
    expect(relationKeys(orderDetailResponseSelect)).toEqual(['fulfillmentOrder', 'items', 'listing']);
    expect(trueKeys(orderDetailResponseSelect.items.select)).toEqual(['id', 'price', 'quantity', 'title']);
    expect(orderDetailResponseSelect.items.select.product.select).toEqual({ id: true, sku: true });
    expect(trueKeys(orderDetailResponseSelect.listing.select)).toEqual(['id', 'title']);
    expect(orderDetailResponseSelect.listing.select.connection.select).toBe(marketplaceConnectionRefSelect);
    const fo = orderDetailResponseSelect.fulfillmentOrder.select;
    expect(trueKeys(fo)).toEqual(['id', 'profit', 'status', 'totalCost']);
    expect(trueKeys(fo.shipment.select)).toEqual(['carrier', 'trackingNumber']);
    expect(trueKeys(fo.shipment.select.trackingEvents.select)).toEqual(['id', 'location', 'status', 'timestamp']);
  });

  it('listings list / detail / mutation', () => {
    expect(trueKeys(listingListResponseSelect)).toEqual(['createdAt', 'id', 'price', 'syncStatus', 'title']);
    expect(relationKeys(listingListResponseSelect)).toEqual(['connection']);
    expect(trueKeys(listingDetailResponseSelect)).toEqual(
      ['createdAt', 'description', 'externalId', 'id', 'price', 'quantity', 'syncError', 'syncStatus', 'title']
    );
    expect(relationKeys(listingDetailResponseSelect)).toEqual(['connection', 'product']);
    expect(trueKeys(listingMutationResponseSelect)).toEqual(
      ['description', 'externalId', 'id', 'price', 'quantity', 'syncError', 'syncStatus', 'title']
    );
  });

  it('fulfillment list / send', () => {
    expect(trueKeys(fulfillmentOrderListResponseSelect)).toEqual(
      ['createdAt', 'id', 'profit', 'quantity', 'status', 'totalCost']
    );
    expect(fulfillmentOrderListResponseSelect.order.select).toEqual({ id: true, customerName: true });
    expect(fulfillmentOrderListResponseSelect.shipment.select).toEqual({ trackingNumber: true });
    expect(fulfillmentOrderListResponseSelect.partner.select).toBe(fulfillmentPartnerPublicSelect);
    expect(trueKeys(fulfillmentOrderSendResponseSelect)).toEqual(
      ['createdAt', 'id', 'profit', 'quantity', 'status', 'totalCost']
    );
    expect(relationKeys(fulfillmentOrderSendResponseSelect)).toEqual(['partner']);
  });
});

describe('fields read by the dashboard pages are still selected', () => {
  const need = (select: Record<string, unknown>, fields: string[]) => {
    for (const f of fields) expect(select[f], `missing ${f}`).toBeTruthy();
  };

  it('orders list page', () => {
    need(orderListResponseSelect, ['id', 'fulfillmentType', 'totalPrice', 'status', 'estimatedProfit', 'customerName', 'customerEmail', 'createdAt']);
  });

  it('order detail page', () => {
    need(orderDetailResponseSelect, [
      'id', 'status', 'totalPrice', 'marketplaceFees', 'estimatedProfit', 'fulfillmentType', 'customerName',
      'customerEmail', 'shippingAddress', 'shippingCity', 'shippingPostalCode', 'shippingCountry', 'createdAt',
      'items', 'listing', 'fulfillmentOrder',
    ]);
    need(orderDetailResponseSelect.fulfillmentOrder.select.shipment.select, ['trackingNumber', 'carrier', 'trackingEvents']);
    need(orderDetailResponseSelect.fulfillmentOrder.select.shipment.select.trackingEvents.select, ['id', 'status', 'location', 'timestamp']);
  });

  it('listings list page', () => {
    need(listingListResponseSelect, ['id', 'title', 'price', 'syncStatus', 'createdAt', 'connection']);
    expect(listingListResponseSelect.connection.select.marketplace.select.displayName).toBe(true);
  });

  it('listing detail page', () => {
    need(listingDetailResponseSelect, ['title', 'description', 'price', 'quantity', 'syncStatus', 'syncError', 'externalId', 'createdAt', 'product', 'connection']);
    expect(listingDetailResponseSelect.product.select.images.select).toMatchObject({ id: true, url: true, isMain: true, order: true });
    expect(listingDetailResponseSelect.product.select.id).toBe(true);
    expect(listingDetailResponseSelect.product.select.title).toBe(true);
  });

  it('listing create / update (client reads syncStatus + syncError)', () => {
    need(listingMutationResponseSelect, ['id', 'syncStatus', 'syncError']);
  });

  it('fulfillment page', () => {
    need(fulfillmentOrderListResponseSelect, ['id', 'status', 'totalCost', 'profit', 'quantity', 'createdAt', 'partner', 'order', 'shipment']);
    expect(fulfillmentOrderListResponseSelect.partner.select).toEqual({ id: true, name: true, country: true });
  });

  it('partner picker reads partners[0].id', () => {
    expect(fulfillmentPartnerPublicSelect.id).toBe(true);
  });
});

describe('credential-safe INTERNAL includes still keep what the AI tools read', () => {
  it('order detail include is a plain include (all scalars, e.g. trackingUrl, externalOrderId) with public relations', () => {
    expect('select' in orderDetailPublicInclude).toBe(false);
    expect(orderDetailPublicInclude.fulfillmentOrder.include.shipment).toBeTruthy();
    expect(orderDetailPublicInclude.fulfillmentOrder.include.partner.select).toBe(fulfillmentPartnerPublicSelect);
    expect(trackingEventPublicSelect.description).toBe(true);
  });
});
