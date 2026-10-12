import { Prisma } from '@prisma/client';

/**
 * CDSL CSV fulfillment export — Phase 1 (CSV generation only).
 *
 * Scope, per the request that created this file: generate a downloadable
 * CSV matching CDSL's own template (EXEMPLE FICHIER CSV ADKSY.csv)
 * exactly. This module NEVER sends an email, NEVER calls a CDSL API, and
 * NEVER creates a FulfillmentOrder/dispatches to a FulfillmentProvider —
 * see src/services/fulfillment/registry.ts and FulfillmentService.ts for
 * that separate, existing, provider-dispatch system. CDSL has no entry in
 * either (confirmed: no 'cdsl' id in PLANNED_PARTNER_PROVIDER_IDS, no
 * FulfillmentPartner row) — this stays a plain file export, not wired
 * into that pipeline, until a real decision is made to do so.
 *
 * Column list/order reproduced VERBATIM from CDSL's own template,
 * including its two apparent typos ("LIVRAISON SOUHAITER",
 * "TELEPHONNE") and its blank columns (positions 4, 5, 12, 14, 16, 17,
 * 19, 20, 21 — 1-indexed). Never "corrected": CDSL's own import tooling
 * may match headers literally, and the blank columns' purpose is
 * undocumented — they are preserved as empty, never dropped, never
 * guessed at. See this module's own report for the full list of
 * ambiguities flagged for CDSL confirmation (blank-row-after-header,
 * blank-column purpose, ISO-vs-full-name country, per-order vs
 * per-batch desired delivery date).
 *
 * Byte-level conformance to CDSL's own template file, verified by direct
 * inspection of its raw bytes: NO UTF-8 BOM (confirmed: the file's first
 * 3 bytes are not EF BB BF) and CRLF line endings (confirmed present).
 * This generator matches both exactly — no BOM is emitted, so the first
 * byte of the output is always 'D' (the "D" of "DATE DE LA COMMANDE"),
 * identical to the model file.
 */

export type OrderForCdslExport = Prisma.OrderGetPayload<{
  include: { items: { include: { product: true } } };
}>;

export const CDSL_CSV_HEADER: readonly string[] = [
  'DATE DE LA COMMANDE',
  'DATE DE LIVRAISON SOUHAITER',
  'NUMERO DE LA COMMANDE',
  '',
  '',
  'NOM DU CLIENT',
  'ADRESSE',
  'COMPLEMENT ADRESSE',
  'CODE POSTAL',
  'VILLE',
  'PAYS',
  '',
  'NUMERO DE TELEPHONNE',
  '',
  'ADRESSE EMAIL',
  '',
  '',
  'REFERENCE DU PRODUIT',
  '',
  '',
  '',
  'QUANTITES',
];

export const CDSL_PRODUCT_REFERENCE_MAX_LENGTH = 16;

export interface CdslExportOptions {
  /**
   * Applied to every row of this export batch. CDSL's template has this
   * as a per-row column, but ADKSY's Order model has no "desired delivery
   * date" field of its own today — this is therefore an export-time
   * input, not a stored per-order value. Flagged for confirmation: should
   * this become a real per-order field in a future phase? See report.
   */
  desiredDeliveryDate?: Date | null;
}

export interface CdslOrderValidationResult {
  orderId: string;
  errors: string[];
}

export class CdslExportValidationError extends Error {
  constructor(public readonly results: CdslOrderValidationResult[]) {
    const count = results.reduce((sum, r) => sum + r.errors.length, 0);
    super(`CDSL export validation failed: ${count} error(s) across ${results.length} order(s)`);
    this.name = 'CdslExportValidationError';
  }
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Deliberately simple (not RFC 5322) — matches the strictness already
// used elsewhere in this codebase (lib/validations.ts's z.string().email()
// for order/account emails), just without pulling in zod for one check in
// a pure-logic module with no other zod dependency.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toCdslUppercase(value: string): string {
  return value.toUpperCase();
}

// CSV/formula-injection defense (OWASP "CSV Injection"): a cell whose
// value starts with =, +, -, or @ can be interpreted as a formula by
// Excel/Google Sheets/LibreOffice Calc when the file is opened there —
// which this feature's own export-review UI explicitly tells the user to
// do before sending the file manually to CDSL. Standard RFC 4180 quoting
// (escapeCsvField below) does NOT prevent this: Excel evaluates the
// unquoted cell value regardless of whether the CSV field itself was
// quoted. The standard mitigation (OWASP's own recommendation) is a
// leading single quote, which Excel/Sheets/LibreOffice conventionally
// strip from display — but it IS a real, literal character added to the
// field's actual text content, seen by ANY parser, CDSL's included.
//
// KNOWN COMPATIBILITY LIMIT, not resolved here: whether CDSL's own import
// tooling tolerates a leading `'` on an affected cell is NOT confirmed.
// If their parser does an exact/strict match against these fields (e.g.
// matching a customer name or postal code against their own records), the
// prefix would corrupt that match for the rare order whose data actually
// starts with one of these characters. This trade-off could not be
// resolved without CDSL's confirmation, so it is applied only to fields
// where (a) the character has no legitimate reason to start real data,
// and (b) the field is free text with no format ADKSY can rely on — see
// buildCdslCsvRows's own comment for exactly which fields this covers and
// why NUMERO DE TELEPHONNE is deliberately excluded (a leading "+" is a
// common, legitimate international dialing-code prefix there, and
// blanket-prefixing it would alter real, valid phone numbers for a risk
// that field doesn't meaningfully carry).
const FORMULA_TRIGGER_RE = /^[=+\-@]/;

function protectAgainstCsvFormulaInjection(value: string): string {
  return FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
}

/**
 * The exact REFERENCE DU PRODUIT string that will be written to the CSV —
 * uppercased, then formula-injection-protected, in that order (protection
 * must run last: it must see the exact final value, since a leading `'`
 * added before uppercasing would itself never be affected by
 * .toUpperCase() anyway, but keeping one single code path for both the
 * validator and the row builder is what actually matters here). Shared by
 * validateOrderForCdslExport and buildCdslCsvRows so the 16-character
 * limit is always checked against the SAME string that ends up in the
 * file — never the pre-protection length, which could silently let a
 * 16-character SKU through validation only to become 17 characters once
 * protected (violating CDSL's own stated hard limit on this field).
 */
function finalizeCdslProductReference(rawSku: string): string {
  return protectAgainstCsvFormulaInjection(toCdslUppercase(rawSku));
}

/**
 * Per-order validation — point 3 of the request. Returns human-readable,
 * French error strings naming the order and, for a product-line error,
 * the specific reference — never a silent skip. An order with ANY error
 * (including on just one of its lines) is excluded from export entirely:
 * partially exporting a multi-item order (dropping only the bad line)
 * would ship an incomplete order without anyone deciding that on purpose.
 */
export function validateOrderForCdslExport(order: OrderForCdslExport): string[] {
  const errors: string[] = [];
  const ref = `Commande ${order.id}`;

  if (!isNonEmpty(order.customerName)) {
    errors.push(`${ref} : nom du client manquant`);
  }
  if (!isNonEmpty(order.customerEmail) || !EMAIL_RE.test(order.customerEmail.trim())) {
    errors.push(`${ref} : adresse email client manquante ou invalide`);
  }
  if (!isNonEmpty(order.shippingAddress)) {
    errors.push(`${ref} : adresse de livraison manquante`);
  }
  if (!isNonEmpty(order.shippingPostalCode)) {
    errors.push(`${ref} : code postal manquant`);
  }
  if (!isNonEmpty(order.shippingCity)) {
    errors.push(`${ref} : ville manquante`);
  }
  if (!isNonEmpty(order.shippingCountry)) {
    errors.push(`${ref} : pays manquant`);
  }

  if (!order.items || order.items.length === 0) {
    errors.push(`${ref} : aucune ligne produit`);
  } else {
    for (const item of order.items) {
      const sku = item.product?.sku?.trim();
      const itemRef = `${ref}, référence "${sku || item.productId}"`;

      if (!isNonEmpty(sku)) {
        errors.push(`${itemRef} : référence produit manquante`);
      } else {
        // Checked against the FINAL value (uppercased + formula-injection
        // protection applied) — see finalizeCdslProductReference's own
        // comment for why the pre-protection length is not safe to use.
        const finalSku = finalizeCdslProductReference(sku);
        if (finalSku.length > CDSL_PRODUCT_REFERENCE_MAX_LENGTH) {
          errors.push(
            `${itemRef} : dépasse ${CDSL_PRODUCT_REFERENCE_MAX_LENGTH} caractères (${finalSku.length})`
          );
        }
      }

      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        errors.push(`${itemRef} : quantité invalide (${item.quantity}) — doit être strictement positive`);
      }
    }
  }

  if (!(order.createdAt instanceof Date) || isNaN(order.createdAt.getTime())) {
    errors.push(`${ref} : date de commande invalide`);
  }

  return errors;
}

export function validateOrdersForCdslExport(orders: OrderForCdslExport[]): CdslOrderValidationResult[] {
  return orders.map((order) => ({ orderId: order.id, errors: validateOrderForCdslExport(order) }));
}

// Dates are formatted in the Europe/Paris calendar day, not the server's
// local timezone (Vercel functions run in UTC) — an order created just
// after midnight Paris time would otherwise be stamped with the previous
// UTC day, a one-day-off order date for a French logistics partner.
const PARIS_DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatCdslDate(date: Date): string {
  const parts = PARIS_DATE_FORMATTER.formatToParts(date);
  const day = parts.find((p) => p.type === 'day')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const year = parts.find((p) => p.type === 'year')!.value;
  return `${day}/${month}/${year}`;
}

const COUNTRY_DISPLAY_NAMES_FR = new Intl.DisplayNames(['fr'], { type: 'region' });

/**
 * ADKSY stores shippingCountry as a 2-letter ISO 3166-1 code (see
 * lib/validations.ts's createOrderSchema: `.length(2)`, and every
 * marketplace-synced order in this codebase's own tests: 'FR', 'US').
 * CDSL's own example file shows a full country name ("France"), not a
 * code — this expands a recognized 2-letter code to its French display
 * name. A value that is NOT a 2-letter code (e.g. already a full name
 * from a source that didn't normalize it) passes through unchanged
 * rather than being guessed at. Flagged for CDSL confirmation: do they
 * actually want the raw ISO code instead? See report.
 */
function expandCountry(countryValue: string): string {
  const trimmed = countryValue.trim();
  if (/^[a-zA-Z]{2}$/.test(trimmed)) {
    try {
      const name = COUNTRY_DISPLAY_NAMES_FR.of(trimmed.toUpperCase());
      if (isNonEmpty(name) && name !== trimmed.toUpperCase()) {
        return name;
      }
    } catch {
      // Intl.DisplayNames throws RangeError for a syntactically-2-letter
      // but unrecognized region code — fall through to the raw value.
    }
  }
  return trimmed;
}

// RFC 4180 field escaping: quote a field that contains a comma, a double
// quote, or a line break, doubling any internal quote. Every other field
// is left exactly as-is (never quoted unnecessarily, so plain fields stay
// byte-identical to CDSL's own example).
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsvLine(row: readonly string[]): string {
  return row.map(escapeCsvField).join(',');
}

/**
 * One row per product reference and quantity (point 2 of the request): a
 * multi-item order produces one line per OrderItem, repeating the
 * order-level fields and varying only REFERENCE DU PRODUIT/QUANTITES.
 * NUMERO DE LA COMMANDE is ALWAYS order.id, byte-for-byte, never
 * uppercased, protected, or otherwise transformed — it is ADKSY's own
 * stable, case-sensitive primary key (a Prisma cuid, always
 * machine-generated and never starting with a formula-trigger
 * character), used to look the order back up later; altering it here
 * would silently break that lookup.
 *
 * Every other text field is uppercased per CDSL's stated requirement.
 * Free-text fields with no legitimate reason to start with =, +, - or @
 * (customer name, address lines, postal code, city, country, email, the
 * product reference) also get protectAgainstCsvFormulaInjection — see
 * that function's own comment for exactly why and its known compatibility
 * limit. NUMERO DE TELEPHONNE is deliberately excluded: a leading "+" is
 * a common, legitimate international dialing-code prefix there, and nothing
 * confirms CDSL's own parser needs or tolerates the same protection on
 * this specific field — see this file's report. Quantities and dates are
 * never passed through this protection at all (never free text, and the
 * request explicitly asked not to transform legitimate numeric/date
 * values).
 */
export function buildCdslCsvRows(orders: readonly OrderForCdslExport[], options: CdslExportOptions = {}): string[][] {
  const desiredDeliveryDateStr = options.desiredDeliveryDate ? formatCdslDate(options.desiredDeliveryDate) : '';

  const rows: string[][] = [];
  for (const order of orders) {
    const orderDate = formatCdslDate(order.createdAt);
    const customerName = protectAgainstCsvFormulaInjection(toCdslUppercase(order.customerName));
    const address = protectAgainstCsvFormulaInjection(toCdslUppercase(order.shippingAddress));
    const address2 = order.shippingAddress2
      ? protectAgainstCsvFormulaInjection(toCdslUppercase(order.shippingAddress2))
      : '';
    const postalCode = protectAgainstCsvFormulaInjection(toCdslUppercase(order.shippingPostalCode));
    const city = protectAgainstCsvFormulaInjection(toCdslUppercase(order.shippingCity));
    const country = protectAgainstCsvFormulaInjection(toCdslUppercase(expandCountry(order.shippingCountry)));
    // Phone numbers are passed through unmodified (no uppercase — no
    // effect on digits/symbols anyway — and no formula-injection
    // protection, see this function's own header comment) — reformatting
    // the separators to match CDSL's own example (slashes) would also be
    // inventing a convention ADKSY never asked for; see report.
    const phone = order.shippingPhone ?? '';
    const email = protectAgainstCsvFormulaInjection(toCdslUppercase(order.customerEmail));

    for (const item of order.items) {
      const sku = finalizeCdslProductReference((item.product?.sku ?? '').trim());

      rows.push([
        orderDate,
        desiredDeliveryDateStr,
        order.id,
        '',
        '',
        customerName,
        address,
        address2,
        postalCode,
        city,
        country,
        '',
        phone,
        '',
        email,
        '',
        '',
        sku,
        '',
        '',
        '',
        String(item.quantity),
      ]);
    }
  }
  return rows;
}

/**
 * Validates every order first — throws CdslExportValidationError (never a
 * partial/silent file) if any order has any error. Line endings are CRLF
 * (RFC 4180 / Windows-EDI convention), confirmed present in CDSL's own
 * template file. NO UTF-8 BOM is emitted — confirmed, by inspecting the
 * template's raw bytes, that CDSL's own file has none either; an earlier
 * version of this function added one for Excel's accented-character
 * rendering, but that is a real, demonstrated deviation from the literal
 * model file, so it was removed. Accented characters (ÉVREUX, etc.) are
 * still written correctly — this file is plain UTF-8 text throughout,
 * just without the 3-byte BOM prefix.
 */
export function ordersToCdslCsv(orders: readonly OrderForCdslExport[], options: CdslExportOptions = {}): string {
  const validationResults = validateOrdersForCdslExport(orders as OrderForCdslExport[]);
  if (validationResults.some((r) => r.errors.length > 0)) {
    throw new CdslExportValidationError(validationResults);
  }

  const lines = [rowToCsvLine(CDSL_CSV_HEADER), ...buildCdslCsvRows(orders, options).map(rowToCsvLine)];
  return lines.join('\r\n') + '\r\n';
}
