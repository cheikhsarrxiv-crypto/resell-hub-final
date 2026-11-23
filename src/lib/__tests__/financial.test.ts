/**
 * S8 — currencies, exact money arithmetic, per-currency aggregation, profit honesty.
 * Pure functions: no database, no network, no exchange rate anywhere.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateByCurrency, aggregateProductPerformance, aggregateTrend, choosePrimaryCurrency, displayCurrency, formatOrderAmount,
  formatOrderProfit, fromMinor, isProfitKnown, minorUnitDigits, multiplyMoney, normalizeCurrencyCode, orderCurrency, parseMoneyAmount,
  roundMoney, sumMoney, toMinor, UNKNOWN_CURRENCY,
} from '@/lib/financial';

const native = (o: Record<string, unknown> = {}) => ({ currency: null, externalOrderId: null, status: 'pending', totalPrice: 100, estimatedProfit: 30, ...o }) as any;
const synced = (o: Record<string, unknown> = {}) => ({ currency: null, externalOrderId: 'EXT-1', status: 'pending', totalPrice: 100, estimatedProfit: 0, ...o }) as any;

describe('currency codes', () => {
  it.each([['EUR', 'EUR'], ['gbp', 'GBP'], [' usd ', 'USD'], ['JPY', 'JPY']])('%j -> %s', (raw, expected) => expect(normalizeCurrencyCode(raw)).toBe(expected));
  it.each([[undefined], [null], [''], ['EU'], ['EURO'], ['E1R'], ['ZZZ'], [123], [{}], ['€']])('%j is invalid -> null (never defaulted)', (raw) => {
    expect(normalizeCurrencyCode(raw)).toBeNull();
  });
  it('minor units follow the currency (EUR/GBP/USD 2, JPY 0, KWD 3)', () => {
    expect([minorUnitDigits('EUR'), minorUnitDigits('GBP'), minorUnitDigits('USD'), minorUnitDigits('JPY'), minorUnitDigits('KWD')]).toEqual([2, 2, 2, 0, 3]);
  });
});

describe('parseMoneyAmount — strict (parseFloat accepted "12abc" and turned "" into NaN)', () => {
  it.each([['12', 12], ['12.50', 12.5], ['0', 0], ['0.99', 0.99], [' 7.10 ', 7.1], [3.2, 3.2], [0, 0]])('%j -> %s', (raw, expected) => expect(parseMoneyAmount(raw)).toBe(expected));
  it.each([['12abc'], [''], ['  '], ['abc'], ['1,5'], ['-3'], [-3], [NaN], [Infinity], [undefined], [null], [{}], ['1e3'], ['.5'], ['5.']])('%j -> null', (raw) => {
    expect(parseMoneyAmount(raw)).toBeNull();
  });
});

describe('exact arithmetic (integer minor units)', () => {
  it('0.1 + 0.2 is exactly 0.3 (the float sum is 0.30000000000000004)', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2], 'EUR')).toBe(0.3);
  });
  it('price x quantity does not drift: 19.99 x 3 = 59.97, 0.07 x 100 = 7, 1.1 x 3 = 3.3', () => {
    expect(0.07 * 100).not.toBe(7); // float: 7.000000000000001
    expect(1.1 * 3).not.toBe(3.3); // float: 3.3000000000000003
    expect(multiplyMoney(1.1, 3, 'EUR')).toBe(3.3);
    expect(multiplyMoney(19.99, 3, 'EUR')).toBe(59.97);
    expect(multiplyMoney(0.07, 100, 'EUR')).toBe(7);
  });
  it('1.005 rounds to 1.01 (1.005 * 100 = 100.49999999999999 would round to 1.00)', () => {
    expect(roundMoney(1.005, 'EUR')).toBe(1.01);
    expect(toMinor(1.005, 'EUR')).toBe(101);
  });
  it('many small amounts accumulate without error: 1000 x 0.01 = 10', () => {
    expect(sumMoney(Array(1000).fill(0.01), 'EUR')).toBe(10);
    expect(Array(1000).fill(0.01).reduce((a: number, b: number) => a + b, 0)).not.toBe(10);
  });
  it('zero-decimal and three-decimal currencies use their own unit', () => {
    expect(sumMoney([100, 250], 'JPY')).toBe(350);
    expect(roundMoney(1234.6, 'JPY')).toBe(1235);
    expect(sumMoney([0.001, 0.002], 'KWD')).toBe(0.003);
  });
  it('minor -> major is lossless for cents', () => {
    expect(fromMinor(toMinor(1234.56, 'GBP'), 'GBP')).toBe(1234.56);
  });
});

describe('which currency an order is accounted in — never guessed', () => {
  it('a recorded currency wins (normalized)', () => {
    expect(orderCurrency(synced({ currency: 'gbp' }))).toBe('GBP');
    expect(orderCurrency(native({ currency: 'USD' }))).toBe('USD');
  });
  it('an ADKSY-native order without a currency is EUR (app-wide convention)', () => {
    expect(orderCurrency(native())).toBe('EUR');
  });
  it('a synced order without a currency is UNKNOWN, never EUR', () => {
    expect(orderCurrency(synced())).toBe(UNKNOWN_CURRENCY);
  });
  it('an invalid stored currency is treated as absent', () => {
    expect(orderCurrency(synced({ currency: 'ZZZ' }))).toBe(UNKNOWN_CURRENCY);
    expect(orderCurrency(native({ currency: 'euro' }))).toBe('EUR');
  });
  it('the derived response flag (profitKnown) replaces externalOrderId, which API responses never carry', () => {
    expect(orderCurrency({ currency: null, profitKnown: false } as any)).toBe(UNKNOWN_CURRENCY);
    expect(orderCurrency({ currency: null, profitKnown: true } as any)).toBe('EUR');
    expect(isProfitKnown({ profitKnown: false } as any)).toBe(false);
  });
  it('display: unknown currency is shown WITHOUT a symbol, a known one with its own', () => {
    expect(displayCurrency(synced())).toBeNull();
    expect(formatOrderAmount(synced(), 12.5)).toContain('devise inconnue');
    expect(formatOrderAmount(synced(), 12.5)).not.toMatch(/[€£$]/);
    expect(formatOrderAmount(synced({ currency: 'GBP' }), 12.5)).toContain('£');
    expect(formatOrderAmount(native({ currency: 'USD' }), 12.5)).toMatch(/\$/);
    expect(formatOrderAmount(native(), 12.5)).toContain('€');
  });
  it('a synced order\'s profit is "—", a native one is shown', () => {
    expect(formatOrderProfit(synced({ currency: 'EUR' }))).toBe('—');
    expect(formatOrderProfit(native())).toContain('30');
  });
});

describe('aggregation — currencies are never added together', () => {
  const orders = [
    native({ currency: 'EUR', totalPrice: 100, estimatedProfit: 30 }),
    native({ currency: 'EUR', totalPrice: 50, estimatedProfit: 10 }),
    native({ currency: 'GBP', totalPrice: 80, estimatedProfit: 20 }),
    native({ currency: 'USD', totalPrice: 40, estimatedProfit: 5 }),
  ];
  const buckets = aggregateByCurrency(orders);
  const by = (c: string) => buckets.find((b) => b.currency === c)!;

  it('one bucket per currency, each with its own figures', () => {
    expect(buckets.map((b) => b.currency).sort()).toEqual(['EUR', 'GBP', 'USD']);
    expect(by('EUR')).toMatchObject({ orders: 2, revenue: 150, profit: 40 });
    expect(by('GBP')).toMatchObject({ orders: 1, revenue: 80, profit: 20 });
    expect(by('USD')).toMatchObject({ orders: 1, revenue: 40, profit: 5 });
  });
  it('no bucket holds the sum across currencies (the old code would have shown 270)', () => {
    for (const b of buckets) expect(b.revenue).not.toBe(270);
    expect(buckets.reduce((n, b) => n + b.orders, 0)).toBe(4);
  });
  it('the primary currency is the one with most orders (EUR here); ties go to EUR then alphabetical; UNKNOWN never primary when another exists', () => {
    expect(choosePrimaryCurrency(buckets)).toBe('EUR');
    const tie = aggregateByCurrency([native({ currency: 'USD' }), native({ currency: 'GBP' })]);
    expect(choosePrimaryCurrency(tie)).toBe('GBP');
    const withUnknown = aggregateByCurrency([synced(), synced(), synced(), native({ currency: 'GBP' })]);
    expect(choosePrimaryCurrency(withUnknown)).toBe('GBP');
    expect(choosePrimaryCurrency([])).toBe('EUR');
  });
  it('exact sums: ten orders of 0.1 total exactly 1', () => {
    const b = aggregateByCurrency(Array(10).fill(native({ totalPrice: 0.1, estimatedProfit: 0.1 })));
    expect(b[0].revenue).toBe(1);
    expect(b[0].profit).toBe(1);
  });
  it('cancelled orders are excluded from revenue and profit, and counted apart', () => {
    const b = aggregateByCurrency([native({ totalPrice: 100 }), native({ status: 'cancelled', totalPrice: 900, estimatedProfit: 500 })]);
    expect(b[0]).toMatchObject({ orders: 1, cancelledOrders: 1, revenue: 100, profit: 30 });
  });
  it('REFUNDS: no refund data exists in the model, so none is invented — a refunded order is not silently reduced', () => {
    // documented limit: Order has no refund column and the adapters import none (see roadmap S8)
    const b = aggregateByCurrency([native({ totalPrice: 100, status: 'delivered' })]);
    expect(b[0].revenue).toBe(100);
  });
  it('synced orders: profit is UNKNOWN — excluded from profit and margin, not counted as 0', () => {
    const b = aggregateByCurrency([native({ currency: 'EUR', totalPrice: 100, estimatedProfit: 40 }), synced({ currency: 'EUR', totalPrice: 300 })])[0];
    expect(b).toMatchObject({ orders: 2, revenue: 400, profit: 40, ordersWithKnownProfit: 1, ordersWithUnknownProfit: 1 });
    expect(b.margin).toBe(40); // 40 / 100 (the order with a known profit), NOT 40 / 400 = 10
  });
  it('only synced orders -> margin is null (no basis), never 0 %', () => {
    const b = aggregateByCurrency([synced({ currency: 'EUR', totalPrice: 100 })])[0];
    expect(b).toMatchObject({ profit: 0, ordersWithUnknownProfit: 1, margin: null });
  });
  it('synced orders without a recorded currency land in UNKNOWN, apart from EUR', () => {
    const b = aggregateByCurrency([native({ totalPrice: 10 }), synced({ totalPrice: 99 })]);
    expect(b.find((x) => x.currency === 'EUR')!.revenue).toBe(10);
    expect(b.find((x) => x.currency === UNKNOWN_CURRENCY)!.revenue).toBe(99);
  });
  it('fulfillment is attributed to the currency of its order and ignores cancelled orders', () => {
    const b = aggregateByCurrency(
      [native({ currency: 'EUR', totalPrice: 100, estimatedProfit: 30 }), native({ currency: 'GBP', totalPrice: 80, estimatedProfit: 20 })],
      [
        { revenue: 100, totalCost: 60, order: { currency: 'EUR', externalOrderId: null, status: 'pending' } },
        { revenue: 80, totalCost: 50, order: { currency: 'GBP', externalOrderId: null, status: 'pending' } },
        { revenue: 999, totalCost: 1, order: { currency: 'EUR', externalOrderId: null, status: 'cancelled' } },
      ]
    );
    const eur = b.find((x) => x.currency === 'EUR')!;
    const gbp = b.find((x) => x.currency === 'GBP')!;
    expect(eur).toMatchObject({ fulfillmentRevenue: 100, fulfillmentCost: 60, grossProfit: 70, netRevenue: 200 });
    expect(gbp).toMatchObject({ fulfillmentRevenue: 80, fulfillmentCost: 50, grossProfit: 50, netRevenue: 160 });
  });
  it('marketplace split lives inside each currency', () => {
    const rows = [
      native({ currency: 'EUR', totalPrice: 10, estimatedProfit: 1, marketplace: 'ebay' }),
      native({ currency: 'GBP', totalPrice: 20, estimatedProfit: 2, marketplace: 'ebay' }),
    ];
    const b = aggregateByCurrency(rows, [], (o) => o.marketplace ?? null);
    expect(b.find((x) => x.currency === 'EUR')!.revenueByMarketplace).toEqual({ ebay: 10 });
    expect(b.find((x) => x.currency === 'GBP')!.revenueByMarketplace).toEqual({ ebay: 20 });
  });
  it('no order -> no bucket (the caller falls back to zeroed EUR figures)', () => {
    expect(aggregateByCurrency([])).toEqual([]);
  });
  it('there is no conversion anywhere: the module exposes no rate / convert function', async () => {
    const mod = await import('@/lib/financial');
    expect(Object.keys(mod).filter((k) => /convert|rate|exchange/i.test(k))).toEqual([]);
  });
});

describe('trend and period handling', () => {
  const at = (iso: string, o: Record<string, unknown> = {}) => native({ createdAt: new Date(iso), ...o });
  it('groups by UTC day, one currency, exact sums, cancelled excluded, ascending', () => {
    const trend = aggregateTrend(
      [
        at('2026-11-02T10:00:00Z', { totalPrice: 0.1 }),
        at('2026-11-01T23:59:59Z', { totalPrice: 5 }),
        at('2026-11-02T00:00:00Z', { totalPrice: 0.2 }),
        at('2026-11-02T12:00:00Z', { totalPrice: 50, status: 'cancelled' }),
        at('2026-11-02T12:00:00Z', { totalPrice: 77, currency: 'GBP' }),
      ],
      'EUR'
    );
    expect(trend).toEqual([
      { date: '2026-11-01', revenue: 5, orders: 1 },
      { date: '2026-11-02', revenue: 0.3, orders: 2 },
    ]);
  });
  it('the same orders seen in GBP give only the GBP order', () => {
    expect(aggregateTrend([at('2026-11-02T12:00:00Z', { totalPrice: 77, currency: 'GBP' }), at('2026-11-02T12:00:00Z')], 'GBP')).toEqual([
      { date: '2026-11-02', revenue: 77, orders: 1 },
    ]);
  });
});

describe('product performance — profit only when the cost is really known', () => {
  const product = { id: 'p1', sku: 'S', title: 'T', fulfillmentCost: 0 };
  const item = (price: number, quantity: number, purchasePrice: number | null, order: Record<string, unknown> = {}) => ({
    price, quantity, purchasePrice, order: { currency: 'EUR', externalOrderId: null, status: 'delivered', ...order },
  });
  it('uses quantity and the historical cost snapshot: 2 x 10.00 with cost 4.00 -> revenue 20, profit 12, margin 60', () => {
    const r = aggregateProductPerformance(product, [item(10, 2, 4)], 'EUR');
    expect(r).toMatchObject({ sales: 1, units: 2, revenue: 20, profit: 12, margin: 60 });
  });
  it('cost snapshot absent (null) -> profit and margin are null, not "revenue minus 0"', () => {
    expect(aggregateProductPerformance(product, [item(10, 1, null)], 'EUR')).toMatchObject({ revenue: 10, profit: null, margin: null });
  });
  it('cost 0 (the column default = never filled in) is treated as unknown too', () => {
    expect(aggregateProductPerformance(product, [item(10, 1, 0)], 'EUR').profit).toBeNull();
  });
  it('one unknown cost among several items makes the product profit unknown (no partial profit shown as complete)', () => {
    expect(aggregateProductPerformance(product, [item(10, 1, 4), item(10, 1, null)], 'EUR').profit).toBeNull();
  });
  it('cancelled orders and other currencies are not counted; the product shipping cost is subtracted per unit', () => {
    const r = aggregateProductPerformance({ ...product, fulfillmentCost: 1 }, [item(10, 2, 4), item(10, 1, 4, { status: 'cancelled' }), item(10, 1, 4, { currency: 'GBP' })], 'EUR');
    expect(r).toMatchObject({ sales: 1, units: 2, revenue: 20, profit: 10 });
  });
  it('no counted sale -> profit null', () => {
    expect(aggregateProductPerformance(product, [], 'EUR')).toMatchObject({ sales: 0, revenue: 0, profit: null });
  });
});
