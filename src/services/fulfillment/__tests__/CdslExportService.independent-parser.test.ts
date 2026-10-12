/**
 * Independent round-trip coverage for the CDSL CSV export — the gap
 * flagged in this feature's own review reports: CdslExportService.test.ts
 * verifies field arrays (buildCdslCsvRows, pre-CSV-join) and does
 * substring checks (.toContain()) on the final joined text, but never
 * runs the generated output back through a REAL parser. A subtle bug in
 * escapeCsvField/rowToCsvLine could satisfy those checks while still
 * producing a file a real CSV consumer reads incorrectly.
 *
 * parseCsvIndependently() below is a from-scratch RFC 4180 parser,
 * sharing NO code with CdslExportService.ts's own escapeCsvField/
 * rowToCsvLine — a bug in either implementation cannot mask itself here.
 * No new dependency: this project has no CSV library in package.json or
 * node_modules (checked before writing this), and the project's own
 * convention elsewhere (see dashboardListPageState.ts's header comment)
 * is a plain, dependency-free module when a small one suffices.
 */
import { describe, it, expect } from 'vitest';
import { CDSL_CSV_HEADER, CDSL_PRODUCT_REFERENCE_MAX_LENGTH, ordersToCdslCsv, type OrderForCdslExport } from '../CdslExportService';

/**
 * Minimal, standalone RFC 4180 CSV parser. Handles: comma field
 * separation, double-quoted fields (with "" as an escaped literal quote
 * inside one), CRLF or bare-LF record separators, and a field/record that
 * is empty. Good enough for round-tripping this generator's own output —
 * not a general-purpose CSV library (e.g. it assumes a quote only ever
 * opens at the start of a field, which is all this generator ever
 * produces; see escapeCsvField's own "all-or-nothing" quoting).
 */
function parseCsvIndependently(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  // The generator always ends its output with a trailing CRLF, so by the
  // time the loop ends, `field` and `row` are already flushed/empty —
  // this only fires for input that (unlike this generator's) omits the
  // final line terminator, so no spurious trailing empty row is ever
  // appended for ordersToCdslCsv's own real output.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function makeProduct(sku: string) {
  return {
    id: 'prod-x',
    workspaceId: 'ws-1',
    sku,
    title: 'Produit',
    description: '',
    brand: null,
    category: null,
    size: null,
    color: null,
    model: null,
    condition: 'used',
    purchasePrice: 1,
    sellingPrice: 1,
    fulfillmentCost: 0,
    fees: 0,
    quantity: 1,
    location: null,
    weightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    supplierSku: null,
    sourceMarketplace: null,
    sourceId: null,
    sourceUrl: null,
    etsyTaxonomyId: null,
    etsyWhenMade: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

function makeOrder(overrides: Partial<OrderForCdslExport> = {}, items?: any[]): OrderForCdslExport {
  return {
    id: 'cm-rt-order',
    workspaceId: 'ws-1',
    listingId: null,
    externalOrderId: null,
    customerId: 'CUST-RT',
    customerName: 'Nom Ordinaire',
    customerEmail: 'contact@example.com',
    totalPrice: 10,
    marketplaceFees: 0,
    estimatedProfit: 5,
    status: 'pending',
    fulfillmentType: 'self',
    marketplace: null,
    shippingAddress: '1 Rue Ordinaire',
    shippingAddress2: null,
    shippingCity: 'Lyon',
    shippingState: null,
    shippingPostalCode: '69000',
    shippingCountry: 'FR',
    shippingPhone: '0600000000',
    shippingEmail: null,
    createdAt: new Date('2026-03-15T10:00:00.000Z'),
    updatedAt: new Date('2026-03-15T10:00:00.000Z'),
    items:
      items ??
      ([
        { id: 'item-rt', orderId: 'cm-rt-order', productId: 'prod-rt', title: 'Produit', quantity: 2, price: 5, purchasePrice: 2, product: makeProduct('REF-ORDINAIRE') },
      ] as unknown as OrderForCdslExport['items']),
    ...overrides,
  } as OrderForCdslExport;
}

function parseExportedOrders(orders: OrderForCdslExport[]) {
  const csv = ordersToCdslCsv(orders);
  const rows = parseCsvIndependently(csv);
  return { csv, header: rows[0], data: rows.slice(1) };
}

function col(row: string[], header: string[], name: string): string {
  return row[header.indexOf(name)];
}

describe('Independent CSV round-trip — parseCsvIndependently proves what a real consumer retrieves', () => {
  it('parses exactly the header + one data row, each with the 22 CDSL columns in order', () => {
    const { header, data } = parseExportedOrders([makeOrder()]);
    expect(header).toEqual(CDSL_CSV_HEADER);
    expect(header).toHaveLength(22);
    expect(data).toHaveLength(1);
    expect(data[0]).toHaveLength(22);
  });

  it('round-trips a comma inside a field as ONE field, not a column break', () => {
    const { header, data } = parseExportedOrders([makeOrder({ customerName: 'Dupont, Arthur' })]);
    expect(data[0]).toHaveLength(22); // still 22 — the comma did not split the row
    expect(col(data[0], header, 'NOM DU CLIENT')).toBe('DUPONT, ARTHUR');
  });

  it('round-trips a doubled double-quote as a single literal quote', () => {
    const { header, data } = parseExportedOrders([makeOrder({ shippingAddress: '9 rue "des Lilas"' })]);
    expect(col(data[0], header, 'ADRESSE')).toBe('9 RUE "DES LILAS"');
  });

  it('round-trips accented characters intact', () => {
    const { header, data } = parseExportedOrders([
      makeOrder({ customerName: 'Éloïse Côté', shippingCity: 'Saint-Étienne' }),
    ]);
    expect(col(data[0], header, 'NOM DU CLIENT')).toBe('ÉLOÏSE CÔTÉ');
    expect(col(data[0], header, 'VILLE')).toBe('SAINT-ÉTIENNE');
  });

  it('round-trips an embedded line break as ONE field, not an extra row', () => {
    const { header, data } = parseExportedOrders([makeOrder({ shippingAddress2: 'Bat F\r\nEtage 2' })]);
    expect(data).toHaveLength(1); // the embedded break did not create a phantom second row
    expect(col(data[0], header, 'COMPLEMENT ADRESSE')).toBe('BAT F\r\nETAGE 2');
  });

  it('parses QUANTITES back as a genuinely numeric string for every item of a multi-item order', () => {
    const items = [
      { id: 'i1', orderId: 'cm-rt-order', productId: 'p1', title: 'A', quantity: 2, price: 1, purchasePrice: 1, product: makeProduct('SKU-A') },
      { id: 'i2', orderId: 'cm-rt-order', productId: 'p2', title: 'B', quantity: 7, price: 1, purchasePrice: 1, product: makeProduct('SKU-B') },
    ];
    const { header, data } = parseExportedOrders([makeOrder({}, items)]);
    expect(data).toHaveLength(2);
    const quantities = data.map((row) => col(row, header, 'QUANTITES'));
    expect(quantities).toEqual(['2', '7']);
    for (const q of quantities) {
      expect(Number.isInteger(Number(q))).toBe(true);
      expect(/^[0-9]+$/.test(q)).toBe(true); // no stray characters (e.g. no leading quote)
    }
  });

  it('parses an ordinary product reference back unmodified (uppercased only, no protection prefix)', () => {
    const { header, data } = parseExportedOrders([makeOrder()]);
    expect(col(data[0], header, 'REFERENCE DU PRODUIT')).toBe('REF-ORDINAIRE');
  });

  it.each(['=FORMULE', '+1234', '-FORMULE', '@FORMULE'])(
    'parses a product reference starting with "%s" back WITH its leading-quote protection, and within the 16-character limit',
    (dangerousSku) => {
      const items = [
        { id: 'i1', orderId: 'cm-rt-order', productId: 'p1', title: 'A', quantity: 1, price: 1, purchasePrice: 1, product: makeProduct(dangerousSku) },
      ];
      const { header, data } = parseExportedOrders([makeOrder({}, items)]);
      const ref = col(data[0], header, 'REFERENCE DU PRODUIT');
      expect(ref).toBe(`'${dangerousSku.toUpperCase()}`);
      expect(ref.length).toBeLessThanOrEqual(CDSL_PRODUCT_REFERENCE_MAX_LENGTH);
    }
  );

  it.each([
    ['NOM DU CLIENT', 'customerName', '=cmd|calc'],
    ['ADRESSE', 'shippingAddress', '+1 rue du Danger'],
    ['ADRESSE EMAIL', 'customerEmail', '-danger@example.com'],
    ['VILLE', 'shippingCity', '@Paris'],
  ] as const)('parses %s back WITH its leading-quote protection when the source value starts with a formula trigger', (columnName, field, value) => {
    const { header, data } = parseExportedOrders([makeOrder({ [field]: value } as Partial<OrderForCdslExport>)]);
    const parsed = col(data[0], header, columnName);
    expect(parsed).toBe(`'${value.toUpperCase()}`);
  });

  it('parses NUMERO DE TELEPHONNE back WITHOUT protection even when it legitimately starts with "+"', () => {
    const { header, data } = parseExportedOrders([makeOrder({ shippingPhone: '+33612345678' })]);
    expect(col(data[0], header, 'NUMERO DE TELEPHONNE')).toBe('+33612345678');
  });

  it('parses NUMERO DE LA COMMANDE back byte-for-byte unmodified, never uppercased or protected', () => {
    const { header, data } = parseExportedOrders([makeOrder({ id: 'cmMixedCase123' })]);
    expect(col(data[0], header, 'NUMERO DE LA COMMANDE')).toBe('cmMixedCase123');
  });

  it('parses every undocumented blank column back as a genuinely empty string', () => {
    const { header, data } = parseExportedOrders([makeOrder()]);
    const blankColumns = header.map((h, i) => (h === '' ? i : -1)).filter((i) => i !== -1);
    expect(blankColumns).toHaveLength(9);
    for (const i of blankColumns) {
      expect(data[0][i]).toBe('');
    }
  });

  it('parses no UTF-8 BOM into the first header cell', () => {
    const { csv, header } = parseExportedOrders([makeOrder()]);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(header[0]).toBe('DATE DE LA COMMANDE'); // not "﻿DATE DE LA COMMANDE"
  });
});
