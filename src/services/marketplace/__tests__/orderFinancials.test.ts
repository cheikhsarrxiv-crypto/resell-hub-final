/**
 * S8 — strict parsing of the financial data of marketplace orders (eBay, Etsy).
 * Pure functions: no network, no database.
 */
import { describe, it, expect } from 'vitest';
import { parseEbayOrderFinancials, parseEtsyOrderFinancials, BLOCKING_ORDER_ISSUES } from '../orderFinancials';

const ebay = (o: Record<string, any> = {}) => ({
  pricingSummary: { total: { value: '59.97', currency: 'EUR' } },
  lineItems: [{ quantity: 3, lineItemPrice: { value: '19.99', currency: 'EUR' } }],
  ...o,
});

describe('eBay order financials', () => {
  it.each(['EUR', 'GBP', 'USD'])('keeps the real currency (%s) and the exact amounts', (cur) => {
    const r = parseEbayOrderFinancials(ebay({
      pricingSummary: { total: { value: '59.97', currency: cur } },
      lineItems: [{ quantity: 3, lineItemPrice: { value: '19.99', currency: cur } }],
    }));
    expect(r.currency).toBe(cur);
    expect(r.totalPrice).toBe(59.97);
    expect(r.itemPrices).toEqual([19.99]);
    expect(r.itemQuantities).toEqual([3]);
    expect(r.issues).toEqual([]);
  });

  it('normalizes a lower-case code', () => {
    expect(parseEbayOrderFinancials(ebay({ pricingSummary: { total: { value: '5', currency: 'gbp' } } })).currency).toBe('GBP');
  });

  it('missing currency: reported, never defaulted, not blocking', () => {
    const r = parseEbayOrderFinancials(ebay({ pricingSummary: { total: { value: '10.00' } } }));
    expect(r.currency).toBeUndefined();
    expect(r.issues).toContain('missing_currency');
    expect(r.issues.some((i) => BLOCKING_ORDER_ISSUES.includes(i))).toBe(false);
  });

  it.each(['EURO', 'XX', '€', 'ZZZ'])('invalid currency %j: reported as invalid, not defaulted', (bad) => {
    const r = parseEbayOrderFinancials(ebay({ pricingSummary: { total: { value: '10.00', currency: bad } } }));
    expect(r.currency).toBeUndefined();
    expect(r.issues).toContain('invalid_currency');
  });

  it.each(['12abc', '', 'NaN', '-5', '1e3', undefined, null])('invalid total %j is blocking (parseFloat would have stored a fake amount)', (bad) => {
    const r = parseEbayOrderFinancials(ebay({ pricingSummary: { total: { value: bad, currency: 'EUR' } } }));
    expect(r.issues).toContain('invalid_total');
    expect(BLOCKING_ORDER_ISSUES).toContain('invalid_total');
  });

  it('invalid item price / quantity are blocking and the item price is null (not 0)', () => {
    const r = parseEbayOrderFinancials(ebay({ lineItems: [{ quantity: 0, lineItemPrice: { value: 'abc', currency: 'EUR' } }] }));
    expect(r.issues).toEqual(expect.arrayContaining(['invalid_item_price', 'invalid_quantity']));
    expect(r.itemPrices).toEqual([null]);
    expect(r.itemQuantities).toEqual([null]);
  });

  it('item currency different from the order currency is a blocking mismatch (currencies are never mixed)', () => {
    const r = parseEbayOrderFinancials(ebay({ lineItems: [{ quantity: 1, lineItemPrice: { value: '5.00', currency: 'GBP' } }] }));
    expect(r.issues).toContain('currency_mismatch');
    expect(BLOCKING_ORDER_ISSUES).toContain('currency_mismatch');
  });

  it('multiple items keep their own price and quantity', () => {
    const r = parseEbayOrderFinancials(ebay({ lineItems: [
      { quantity: 2, lineItemPrice: { value: '0.10', currency: 'EUR' } },
      { quantity: 1, lineItemPrice: { value: '0.20', currency: 'EUR' } },
    ] }));
    expect(r.itemPrices).toEqual([0.1, 0.2]);
    expect(r.itemQuantities).toEqual([2, 1]);
  });

  it('a completely empty payload is blocked, not turned into a valid 0 order', () => {
    expect(parseEbayOrderFinancials({}).issues).toContain('invalid_total');
    expect(parseEbayOrderFinancials(null).issues).toContain('invalid_total');
  });
});

describe('Etsy order financials', () => {
  const etsy = (o: Record<string, any> = {}) => ({
    grandtotal: { amount: 2599, divisor: 100, currency_code: 'GBP' },
    transactions: [{ quantity: 1, price: { amount: 2599, divisor: 100, currency_code: 'GBP' } }],
    ...o,
  });

  it('divides amount by divisor and keeps the currency', () => {
    const r = parseEtsyOrderFinancials(etsy());
    expect(r.totalPrice).toBe(25.99);
    expect(r.currency).toBe('GBP');
    expect(r.itemPrices).toEqual([25.99]);
    expect(r.issues).toEqual([]);
  });

  it('a zero amount is a valid amount (old code: falsy -> fake 0 either way); a missing amount is invalid', () => {
    expect(parseEtsyOrderFinancials(etsy({ grandtotal: { amount: 0, divisor: 100, currency_code: 'GBP' } })).issues).toEqual([]);
    expect(parseEtsyOrderFinancials(etsy({ grandtotal: { divisor: 100, currency_code: 'EUR' } })).issues).toContain('invalid_total');
  });

  it.each([0, -1, 1.5, undefined])('invalid divisor %j blocks the order', (divisor) => {
    expect(parseEtsyOrderFinancials(etsy({ grandtotal: { amount: 100, divisor, currency_code: 'EUR' } })).issues).toContain('invalid_total');
  });

  it('missing / invalid currency is reported, not defaulted', () => {
    expect(parseEtsyOrderFinancials(etsy({ grandtotal: { amount: 100, divisor: 100 } })).issues).toContain('missing_currency');
    expect(parseEtsyOrderFinancials(etsy({ grandtotal: { amount: 100, divisor: 100, currency_code: 'QQ' } })).issues).toContain('invalid_currency');
  });

  it('absent quantity defaults to 1 (historic behaviour); a present invalid one blocks', () => {
    expect(parseEtsyOrderFinancials(etsy({ transactions: [{ price: { amount: 100, divisor: 100, currency_code: 'GBP' } }] })).itemQuantities).toEqual([1]);
    expect(parseEtsyOrderFinancials(etsy({ transactions: [{ quantity: -2, price: { amount: 100, divisor: 100, currency_code: 'GBP' } }] })).issues).toContain('invalid_quantity');
  });

  it('transaction currency different from the receipt currency is a blocking mismatch', () => {
    const r = parseEtsyOrderFinancials(etsy({ transactions: [{ quantity: 1, price: { amount: 100, divisor: 100, currency_code: 'USD' } }] }));
    expect(r.issues).toContain('currency_mismatch');
  });

  it('the total is rounded once in the currency minor unit (JPY has none)', () => {
    expect(parseEtsyOrderFinancials(etsy({ grandtotal: { amount: 1999, divisor: 1, currency_code: 'JPY' } })).totalPrice).toBe(1999);
  });
});
