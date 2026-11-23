/**
 * S8 — financial helpers: currencies, exact money arithmetic, and per-currency aggregation.
 *
 * Rules enforced here (and nowhere bypassed by the analytics code):
 *  1. Amounts of different currencies are NEVER added together. Every aggregate is keyed by currency.
 *  2. No exchange rate is ever invented: there is no conversion in this module.
 *  3. Sums and products are done in integer minor units (cents), then converted back once, so
 *     0.1 + 0.2 is exactly 0.3 and price x quantity does not drift.
 *  4. A profit that cannot be known is reported as unknown, never as 0.
 *
 * Storage stays Float (schema unchanged except Order.currency): rounding happens at the boundaries
 * (aggregation and import), in the currency's own minor unit (EUR/GBP/USD: 2 digits, JPY: 0, ...).
 */

/** Orders created inside ADKSY (no marketplace feed) have always been EUR: the app-wide convention. */
export const DEFAULT_ORDER_CURRENCY = 'EUR';
/** Bucket for marketplace-synced orders whose currency was never recorded (rows imported before S8). */
export const UNKNOWN_CURRENCY = 'UNKNOWN';

/* ------------------------------------------------------------------------------------------------ */
/* Currency codes                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

let supportedCurrencies: Set<string> | null | undefined;
function currencySet(): Set<string> | null {
  if (supportedCurrencies === undefined) {
    try {
      const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency');
      supportedCurrencies = list ? new Set(list) : null;
    } catch {
      supportedCurrencies = null;
    }
  }
  return supportedCurrencies;
}

/** 'gbp ' -> 'GBP'. Anything that is not a known ISO 4217 code (or not a string) -> null. */
export function normalizeCurrencyCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const known = currencySet();
  return known && !known.has(code) ? null : code;
}

/** Number of minor-unit digits of a currency (EUR 2, JPY 0, KWD 3). Unknown codes: 2. */
export function minorUnitDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Parsing external amounts                                                                          */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Strict amount parser for data coming from a marketplace. `parseFloat('12abc')` is 12 and
 * `parseFloat('')` is NaN: neither is acceptable for money. Accepts finite numbers and plain decimal
 * strings ("12", "12.50", "0.99"); rejects everything else, negatives included (a refund is not a price).
 */
export function parseMoneyAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------------------------------------ */
/* Exact arithmetic in minor units                                                                   */
/* ------------------------------------------------------------------------------------------------ */

export function toMinor(amount: number, currency: string): number {
  const digits = minorUnitDigits(currency);
  const text = String(amount);
  // "1.005e2" parses exactly where 1.005 * 100 would give 100.49999999999999
  const scaled = text.includes('e') ? amount * 10 ** digits : Number(`${text}e${digits}`);
  return Math.round(scaled);
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** minorUnitDigits(currency);
}

export function roundMoney(amount: number, currency: string): number {
  return fromMinor(toMinor(amount, currency), currency);
}

export function sumMoney(amounts: number[], currency: string): number {
  return fromMinor(amounts.reduce((total, a) => total + toMinor(a, currency), 0), currency);
}

/** price x integer quantity, exact. */
export function multiplyMoney(unitPrice: number, quantity: number, currency: string): number {
  return fromMinor(toMinor(unitPrice, currency) * quantity, currency);
}

/* ------------------------------------------------------------------------------------------------ */
/* Order classification                                                                              */
/* ------------------------------------------------------------------------------------------------ */

export interface FinancialOrderLike {
  currency?: string | null;
  externalOrderId?: string | null;
  /**
   * Derived flag set by OrderService on order API responses (which, by R3-B.5.6, never carry
   * externalOrderId): true = created inside ADKSY (its profit was computed there), false = imported from a
   * marketplace. When present it takes precedence over externalOrderId.
   */
  profitKnown?: boolean;
  status?: string | null;
  totalPrice: number;
  estimatedProfit: number;
  marketplace?: string | null;
}

/**
 * The currency an order is accounted in: the recorded one; EUR for an ADKSY-native order that has
 * none (the app-wide convention); UNKNOWN for a synced order imported before currencies were stored.
 * Never guessed from the workspace, the marketplace or the symbol shown in the UI.
 */
export function orderCurrency(order: Pick<FinancialOrderLike, 'currency' | 'externalOrderId' | 'profitKnown'>): string {
  const recorded = normalizeCurrencyCode(order.currency);
  if (recorded) return recorded;
  return isProfitKnown(order) ? DEFAULT_ORDER_CURRENCY : UNKNOWN_CURRENCY;
}

export const isCancelledOrder = (order: Pick<FinancialOrderLike, 'status'>): boolean => order.status === 'cancelled';

/**
 * A profit is only meaningful when ADKSY itself computed it. Orders imported from a marketplace are
 * stored with estimatedProfit = 0 because neither the purchase cost, the marketplace fees, the shipping
 * nor refunds are imported: that 0 is "not computed", not "no profit".
 */
export const isProfitKnown = (order: Pick<FinancialOrderLike, 'externalOrderId' | 'profitKnown'>): boolean =>
  order.profitKnown ?? !order.externalOrderId;

/** Display currency of an order, or null when it must be shown WITHOUT a symbol (unknown). */
export function displayCurrency(order: Pick<FinancialOrderLike, 'currency' | 'externalOrderId' | 'profitKnown'>): string | null {
  const c = orderCurrency(order);
  return c === UNKNOWN_CURRENCY ? null : c;
}

/* ------------------------------------------------------------------------------------------------ */
/* Per-currency aggregation                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export interface FulfillmentLike {
  revenue: number;
  totalCost: number;
  order: Pick<FinancialOrderLike, 'currency' | 'externalOrderId' | 'status'>;
}

export interface CurrencyMetrics {
  currency: string;
  /** Non-cancelled orders counted in the money figures below. */
  orders: number;
  cancelledOrders: number;
  revenue: number;
  /** Sum of estimatedProfit over orders whose profit is known (see isProfitKnown). */
  profit: number;
  ordersWithKnownProfit: number;
  /** Synced orders: profit not computed (cost, fees, shipping, refunds not imported). */
  ordersWithUnknownProfit: number;
  /** profit / revenue of the orders with known profit, in %. null when no order has a known profit. */
  margin: number | null;
  fulfillmentRevenue: number;
  fulfillmentCost: number;
  grossProfit: number;
  netRevenue: number;
  revenueByMarketplace: Record<string, number>;
  profitByMarketplace: Record<string, number>;
}

interface Acc {
  orders: number; cancelled: number; revenue: number; profit: number; knownRevenue: number; known: number; unknown: number;
  fRevenue: number; fCost: number; byMpRevenue: Record<string, number>; byMpProfit: Record<string, number>;
}

const emptyAcc = (): Acc => ({ orders: 0, cancelled: 0, revenue: 0, profit: 0, knownRevenue: 0, known: 0, unknown: 0, fRevenue: 0, fCost: 0, byMpRevenue: {}, byMpProfit: {} });

/**
 * Groups orders (and their fulfillment orders) by currency. All money is accumulated in minor units.
 * `marketplaceLabel` names the marketplace of an order for the per-marketplace split (optional).
 */
export function aggregateByCurrency<O extends FinancialOrderLike>(
  orders: O[],
  fulfillmentOrders: FulfillmentLike[] = [],
  marketplaceLabel: (order: O) => string | null = () => null
): CurrencyMetrics[] {
  const accs = new Map<string, Acc>();
  const get = (c: string) => accs.get(c) ?? (accs.set(c, emptyAcc()), accs.get(c)!);

  for (const order of orders) {
    const c = orderCurrency(order);
    const a = get(c);
    if (isCancelledOrder(order)) {
      a.cancelled += 1;
      continue;
    }
    const total = toMinor(order.totalPrice, c);
    a.orders += 1;
    a.revenue += total;
    const label = marketplaceLabel(order);
    if (label) a.byMpRevenue[label] = (a.byMpRevenue[label] ?? 0) + total;
    if (isProfitKnown(order)) {
      const profit = toMinor(order.estimatedProfit, c);
      a.known += 1;
      a.profit += profit;
      a.knownRevenue += total;
      if (label) a.byMpProfit[label] = (a.byMpProfit[label] ?? 0) + profit;
    } else {
      a.unknown += 1;
    }
  }

  for (const fo of fulfillmentOrders) {
    if (isCancelledOrder(fo.order)) continue;
    const c = orderCurrency(fo.order);
    const a = get(c);
    a.fRevenue += toMinor(fo.revenue, c);
    a.fCost += toMinor(fo.totalCost, c);
  }

  return [...accs.entries()]
    .map(([currency, a]): CurrencyMetrics => {
      const f = (m: number) => fromMinor(m, currency);
      const revenue = f(a.revenue);
      const profit = f(a.profit);
      const fulfillmentRevenue = f(a.fRevenue);
      const fulfillmentCost = f(a.fCost);
      const mp = (rec: Record<string, number>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, f(v)]));
      return {
        currency,
        orders: a.orders,
        cancelledOrders: a.cancelled,
        revenue,
        profit,
        ordersWithKnownProfit: a.known,
        ordersWithUnknownProfit: a.unknown,
        margin: a.knownRevenue > 0 ? (a.profit / a.knownRevenue) * 100 : null,
        fulfillmentRevenue,
        fulfillmentCost,
        // same formulas as before S8, applied to exact per-currency sums
        grossProfit: f(a.profit + (a.fRevenue > 0 ? a.fRevenue - a.fCost : 0)),
        netRevenue: f(a.revenue + a.fRevenue),
        revenueByMarketplace: mp(a.byMpRevenue),
        profitByMarketplace: mp(a.byMpProfit),
      };
    })
    .sort(compareBuckets);
}

/** Most orders first; ties: EUR, then alphabetical; UNKNOWN last. Deterministic. */
function compareBuckets(a: { currency: string; orders: number }, b: { currency: string; orders: number }): number {
  if (a.currency === UNKNOWN_CURRENCY) return b.currency === UNKNOWN_CURRENCY ? 0 : 1;
  if (b.currency === UNKNOWN_CURRENCY) return -1;
  if (b.orders !== a.orders) return b.orders - a.orders;
  if (a.currency === DEFAULT_ORDER_CURRENCY) return -1;
  if (b.currency === DEFAULT_ORDER_CURRENCY) return 1;
  return a.currency.localeCompare(b.currency);
}

/** The currency whose figures headline a page: the first bucket of aggregateByCurrency's order. */
export function choosePrimaryCurrency(buckets: Array<{ currency: string }>): string {
  return buckets.find((b) => b.currency !== UNKNOWN_CURRENCY)?.currency ?? buckets[0]?.currency ?? DEFAULT_ORDER_CURRENCY;
}

/** Revenue per UTC day for ONE currency. Cancelled orders excluded. */
export function aggregateTrend<O extends FinancialOrderLike & { createdAt: Date }>(orders: O[], currency: string) {
  const days = new Map<string, { revenue: number; orders: number }>();
  for (const order of orders) {
    if (isCancelledOrder(order) || orderCurrency(order) !== currency) continue;
    const day = order.createdAt.toISOString().split('T')[0];
    const d = days.get(day) ?? { revenue: 0, orders: 0 };
    d.revenue += toMinor(order.totalPrice, currency);
    d.orders += 1;
    days.set(day, d);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, d]) => ({ date, revenue: fromMinor(d.revenue, currency), orders: d.orders }));
}

export interface ProductItemLike {
  price: number;
  quantity: number;
  /** Historical cost snapshot taken when the order was created (OrderItem.purchasePrice). */
  purchasePrice: number | null;
  order: Pick<FinancialOrderLike, 'currency' | 'externalOrderId' | 'status'>;
}

/**
 * Per-product performance for ONE currency. Revenue = sum of price x quantity (exact). The cost uses the
 * historical snapshot of each item and the item quantity; when any counted item has no recorded cost
 * (null, or 0 = the column default, i.e. never filled in) the profit and margin are null, not a flattering
 * "revenue minus 0".
 */
export function aggregateProductPerformance(
  product: { id: string; sku: string; title: string; fulfillmentCost: number },
  items: ProductItemLike[],
  currency: string
) {
  let revenue = 0;
  let cost = 0;
  let units = 0;
  let sales = 0;
  let costKnown = true;
  for (const item of items) {
    if (isCancelledOrder(item.order) || orderCurrency(item.order) !== currency) continue;
    sales += 1;
    units += item.quantity;
    revenue += toMinor(item.price, currency) * item.quantity;
    if (item.purchasePrice === null || item.purchasePrice <= 0) costKnown = false;
    else cost += (toMinor(item.purchasePrice, currency) + toMinor(product.fulfillmentCost, currency)) * item.quantity;
  }
  const profit = costKnown && sales > 0 ? fromMinor(revenue - cost, currency) : null;
  const revenueValue = fromMinor(revenue, currency);
  return {
    id: product.id,
    sku: product.sku,
    title: product.title,
    sales,
    units,
    revenue: revenueValue,
    profit,
    margin: profit !== null && revenueValue > 0 ? (profit / revenueValue) * 100 : null,
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Display of an order's amounts                                                                     */
/* ------------------------------------------------------------------------------------------------ */

/**
 * An amount of an order, in the order's own currency. When the currency is unknown (a synced order imported
 * before currencies were stored) the amount is shown WITHOUT a symbol rather than with a wrong one.
 */
export function formatOrderAmount(order: Pick<FinancialOrderLike, 'currency' | 'externalOrderId' | 'profitKnown'>, value: number): string {
  const currency = displayCurrency(order);
  if (currency) return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} (devise inconnue)`;
}

/** The estimated profit of an order, or "—" when it was never computed (synced order). */
export function formatOrderProfit(order: Pick<FinancialOrderLike, 'currency' | 'externalOrderId' | 'profitKnown' | 'estimatedProfit'>): string {
  return isProfitKnown(order) ? formatOrderAmount(order, order.estimatedProfit) : '—';
}
