/**
 * S8 — financial data of a marketplace order, parsed STRICTLY.
 *
 * Before S8 the adapters did `parseFloat(value)` (so "12abc" became 12 and a missing value became 0),
 * silently dropped the currency, and turned an absent amount into 0. Here:
 *  - an amount must be a plain decimal (eBay: { value: "12.50", currency }) or integer/divisor
 *    (Etsy: { amount: 1250, divisor: 100, currency_code });
 *  - the currency must be a valid ISO 4217 code, otherwise it is reported as missing/invalid (never
 *    defaulted);
 *  - every problem is returned in `issues`; the sync decides what is blocking (an unusable total or
 *    quantity) and what is not (a missing currency is stored as "unknown", not invented).
 *
 * The shapes of the amount objects are the ones the adapters already read (`value`/`amount`+`divisor`);
 * the `currency` / `currency_code` members sit next to them in the same objects. They were NOT verified
 * against the live marketplace APIs (no network in this work).
 */
import { normalizeCurrencyCode, parseMoneyAmount, roundMoney } from '@/lib/financial';

export type OrderFinancialIssue =
  | 'invalid_total'
  | 'missing_currency'
  | 'invalid_currency'
  | 'currency_mismatch'
  | 'invalid_item_price'
  | 'invalid_quantity';

export interface ParsedOrderFinancials {
  totalPrice: number;
  /** Normalized ISO code of the order total, or undefined when absent/invalid. */
  currency?: string;
  itemPrices: Array<number | null>;
  itemQuantities: Array<number | null>;
  issues: OrderFinancialIssue[];
}

/** Issues that make an order impossible to record faithfully. */
export const BLOCKING_ORDER_ISSUES: OrderFinancialIssue[] = ['invalid_total', 'invalid_item_price', 'invalid_quantity', 'currency_mismatch'];

function currencyOf(raw: unknown, issues: OrderFinancialIssue[]): string | undefined {
  if (raw === undefined || raw === null || raw === '') {
    issues.push('missing_currency');
    return undefined;
  }
  const code = normalizeCurrencyCode(raw);
  if (!code) issues.push('invalid_currency');
  return code ?? undefined;
}

function quantityOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 100000 ? raw : null;
}

export function parseEbayOrderFinancials(order: any): ParsedOrderFinancials {
  const issues: OrderFinancialIssue[] = [];
  const total = parseMoneyAmount(order?.pricingSummary?.total?.value);
  if (total === null) issues.push('invalid_total');
  const currency = currencyOf(order?.pricingSummary?.total?.currency, issues);

  const itemPrices: Array<number | null> = [];
  const itemQuantities: Array<number | null> = [];
  for (const item of order?.lineItems || []) {
    const price = parseMoneyAmount(item?.lineItemPrice?.value);
    if (price === null) issues.push('invalid_item_price');
    const itemCurrency = item?.lineItemPrice?.currency === undefined ? undefined : normalizeCurrencyCode(item.lineItemPrice.currency);
    if (currency && itemCurrency && itemCurrency !== currency) issues.push('currency_mismatch');
    const quantity = quantityOf(item?.quantity);
    if (quantity === null) issues.push('invalid_quantity');
    itemPrices.push(price);
    itemQuantities.push(quantity);
  }
  return { totalPrice: total ?? 0, currency, itemPrices, itemQuantities, issues: [...new Set(issues)] };
}

function etsyMoney(money: any): number | null {
  const amount = money?.amount;
  const divisor = money?.divisor;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  if (typeof divisor !== 'number' || !Number.isInteger(divisor) || divisor <= 0) return null;
  return amount / divisor;
}

export function parseEtsyOrderFinancials(receipt: any): ParsedOrderFinancials {
  const issues: OrderFinancialIssue[] = [];
  const total = etsyMoney(receipt?.grandtotal);
  if (total === null) issues.push('invalid_total');
  const currency = currencyOf(receipt?.grandtotal?.currency_code, issues);

  const itemPrices: Array<number | null> = [];
  const itemQuantities: Array<number | null> = [];
  for (const t of receipt?.transactions || []) {
    const price = etsyMoney(t?.price);
    if (price === null) issues.push('invalid_item_price');
    const itemCurrency = t?.price?.currency_code === undefined ? undefined : normalizeCurrencyCode(t.price.currency_code);
    if (currency && itemCurrency && itemCurrency !== currency) issues.push('currency_mismatch');
    // Etsy's quantity defaulted to 1 when absent before S8; keep that, but reject a present-but-invalid value
    const quantity = t?.quantity === undefined || t?.quantity === null ? 1 : quantityOf(t.quantity);
    if (quantity === null) issues.push('invalid_quantity');
    itemPrices.push(price);
    itemQuantities.push(quantity);
  }
  return {
    totalPrice: total === null ? 0 : currency ? roundMoney(total, currency) : total,
    currency,
    itemPrices,
    itemQuantities,
    issues: [...new Set(issues)],
  };
}
