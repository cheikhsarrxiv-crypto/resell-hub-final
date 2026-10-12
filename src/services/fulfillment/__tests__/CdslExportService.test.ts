/**
 * CDSL CSV export — pure-logic tests, no DB/network involved (the module
 * under test takes already-fetched Order+items data and returns a string,
 * or throws CdslExportValidationError). Route-level auth/workspace-scoping
 * tests live in src/app/api/orders/export/cdsl/__tests__/route.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  CDSL_CSV_HEADER,
  CDSL_PRODUCT_REFERENCE_MAX_LENGTH,
  CdslExportValidationError,
  buildCdslCsvRows,
  ordersToCdslCsv,
  validateOrderForCdslExport,
  validateOrdersForCdslExport,
  type OrderForCdslExport,
} from '../CdslExportService';

function makeOrder(overrides: Partial<OrderForCdslExport> = {}, items?: OrderForCdslExport['items']): OrderForCdslExport {
  return {
    id: 'cm-order-1',
    workspaceId: 'ws-1',
    listingId: null,
    externalOrderId: null,
    customerId: 'CUST-1',
    customerName: 'Dupont Arthur',
    customerEmail: 'arthur.dupont@example.com',
    totalPrice: 42,
    marketplaceFees: 0,
    estimatedProfit: 10,
    status: 'pending',
    fulfillmentType: 'self',
    marketplace: null,
    shippingAddress: '9 Impasse des Rosiers',
    shippingAddress2: 'Bat F',
    shippingCity: 'Evreux',
    shippingState: null,
    shippingPostalCode: '27600',
    shippingCountry: 'FR',
    shippingPhone: '0637675658',
    shippingEmail: null,
    createdAt: new Date('2026-10-08T10:00:00.000Z'),
    updatedAt: new Date('2026-10-08T10:00:00.000Z'),
    items:
      items ??
      ([
        {
          id: 'item-1',
          orderId: 'cm-order-1',
          productId: 'prod-1',
          title: 'Serum',
          quantity: 1,
          price: 42,
          purchasePrice: 10,
          product: makeProduct(),
        },
      ] as unknown as OrderForCdslExport['items']),
    ...overrides,
  } as OrderForCdslExport;
}

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1',
    workspaceId: 'ws-1',
    sku: 'SERUM',
    title: 'Serum',
    description: '',
    brand: null,
    category: null,
    size: null,
    color: null,
    model: null,
    condition: 'used',
    purchasePrice: 10,
    sellingPrice: 42,
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
    ...overrides,
  };
}

describe('CDSL_CSV_HEADER', () => {
  it('has exactly 22 columns, matching CDSL\'s own template', () => {
    expect(CDSL_CSV_HEADER).toHaveLength(22);
  });

  it('preserves the exact column order and blank positions from CDSL\'s template', () => {
    expect(CDSL_CSV_HEADER).toEqual([
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
    ]);
  });
});

describe('buildCdslCsvRows — column conformance', () => {
  it('produces rows with the same number of columns as the header', () => {
    const rows = buildCdslCsvRows([makeOrder()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(CDSL_CSV_HEADER.length);
  });

  it('leaves the undocumented blank columns empty, never fabricating a value', () => {
    const [row] = buildCdslCsvRows([makeOrder()]);
    const blankIndexes = [3, 4, 11, 13, 15, 16, 18, 19, 20]; // 0-indexed positions of the blank header columns
    for (const i of blankIndexes) {
      expect(row[i]).toBe('');
    }
  });

  it('maps order-level fields to the correct columns', () => {
    const [row] = buildCdslCsvRows([makeOrder()]);
    expect(row[0]).toBe('08/10/2026'); // DATE DE LA COMMANDE
    expect(row[2]).toBe('cm-order-1'); // NUMERO DE LA COMMANDE
    expect(row[5]).toBe('DUPONT ARTHUR'); // NOM DU CLIENT
    expect(row[6]).toBe('9 IMPASSE DES ROSIERS'); // ADRESSE
    expect(row[7]).toBe('BAT F'); // COMPLEMENT ADRESSE
    expect(row[8]).toBe('27600'); // CODE POSTAL
    expect(row[9]).toBe('EVREUX'); // VILLE
    expect(row[10]).toBe('FRANCE'); // PAYS (expanded from ISO "FR")
    expect(row[12]).toBe('0637675658'); // NUMERO DE TELEPHONNE (passed through, not reformatted)
    expect(row[14]).toBe('ARTHUR.DUPONT@EXAMPLE.COM'); // ADRESSE EMAIL
    expect(row[17]).toBe('SERUM'); // REFERENCE DU PRODUIT
    expect(row[21]).toBe('1'); // QUANTITES
  });

  it('never uppercases or otherwise transforms NUMERO DE LA COMMANDE (order.id is a case-sensitive stable key)', () => {
    const [row] = buildCdslCsvRows([makeOrder({ id: 'cmMixedCaseId123' })]);
    expect(row[2]).toBe('cmMixedCaseId123');
  });

  it('uppercases accented text while preserving the accents', () => {
    const [row] = buildCdslCsvRows([
      makeOrder({ customerName: 'Éloïse Côté', shippingCity: 'Épernay' }),
    ]);
    expect(row[5]).toBe('ÉLOÏSE CÔTÉ');
    expect(row[9]).toBe('ÉPERNAY');
  });

  it('leaves COMPLEMENT ADRESSE empty (not "null") when shippingAddress2 is null', () => {
    const [row] = buildCdslCsvRows([makeOrder({ shippingAddress2: null })]);
    expect(row[7]).toBe('');
  });

  it('leaves NUMERO DE TELEPHONNE empty when shippingPhone is null', () => {
    const [row] = buildCdslCsvRows([makeOrder({ shippingPhone: null })]);
    expect(row[12]).toBe('');
  });

  it('passes through a non-ISO-code country value unchanged (uppercased only)', () => {
    const [row] = buildCdslCsvRows([makeOrder({ shippingCountry: 'Some Region' })]);
    expect(row[10]).toBe('SOME REGION');
  });

  it('one row per OrderItem for a multi-item order, repeating order-level fields', () => {
    const items = [
      { id: 'i1', orderId: 'cm-order-1', productId: 'p1', title: 'A', quantity: 2, price: 10, purchasePrice: 5, product: makeProduct({ sku: 'SKU-A' }) },
      { id: 'i2', orderId: 'cm-order-1', productId: 'p2', title: 'B', quantity: 3, price: 20, purchasePrice: 8, product: makeProduct({ sku: 'SKU-B' }) },
    ] as unknown as OrderForCdslExport['items'];
    const rows = buildCdslCsvRows([makeOrder({}, items)]);

    expect(rows).toHaveLength(2);
    expect(rows[0][2]).toBe('cm-order-1');
    expect(rows[1][2]).toBe('cm-order-1');
    expect(rows[0][17]).toBe('SKU-A');
    expect(rows[0][21]).toBe('2');
    expect(rows[1][17]).toBe('SKU-B');
    expect(rows[1][21]).toBe('3');
  });

  it('DATE DE LIVRAISON SOUHAITER is empty by default and set when an export-level date is given', () => {
    const noDate = buildCdslCsvRows([makeOrder()]);
    expect(noDate[0][1]).toBe('');

    const withDate = buildCdslCsvRows([makeOrder()], { desiredDeliveryDate: new Date('2026-10-10T00:00:00.000Z') });
    expect(withDate[0][1]).toBe('10/10/2026');
  });
});

describe('ordersToCdslCsv — CSV serialization', () => {
  it('matches CDSL\'s example row shape for the single-item sample order', () => {
    const csv = ordersToCdslCsv([makeOrder()]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(CDSL_CSV_HEADER.join(','));
    expect(lines[1]).toBe(
      '08/10/2026,,cm-order-1,,,DUPONT ARTHUR,9 IMPASSE DES ROSIERS,BAT F,27600,EVREUX,FRANCE,,0637675658,,ARTHUR.DUPONT@EXAMPLE.COM,,,SERUM,,,,1'
    );
  });

  it('emits NO UTF-8 BOM, matching CDSL\'s own template file byte-for-byte at the start', () => {
    // CDSL's own template (EXEMPLE FICHIER CSV ADKSY.csv) was inspected in
    // raw binary mode for this review: its first 3 bytes are NOT EF BB BF
    // (no BOM) — an earlier version of this generator added one for Excel
    // compatibility, which was a real, demonstrated deviation from the
    // model file and has been removed.
    const csv = ordersToCdslCsv([makeOrder()]);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff); // not the BOM code point
    expect(csv.startsWith('DATE DE LA COMMANDE')).toBe(true); // identical first bytes to the model file
  });

  it('uses CRLF line endings throughout, matching CDSL\'s own template', () => {
    const csv = ordersToCdslCsv([makeOrder()]);
    expect(csv).toContain('\r\n');
    expect(csv).not.toMatch(/[^\r]\n/); // every \n is preceded by \r
  });

  it('quotes a field containing a comma, per RFC 4180', () => {
    const csv = ordersToCdslCsv([makeOrder({ customerName: 'Dupont, Arthur' })]);
    expect(csv).toContain('"DUPONT, ARTHUR"');
  });

  it('quotes and doubles an internal quote in a field', () => {
    const csv = ordersToCdslCsv([makeOrder({ shippingAddress: '9 rue "des Lilas"' })]);
    expect(csv).toContain('"9 RUE ""DES LILAS"""');
  });

  it('quotes a field containing a line break', () => {
    const csv = ordersToCdslCsv([makeOrder({ shippingAddress2: 'Bat F\nEtage 2' })]);
    expect(csv).toContain('"BAT F\nETAGE 2"');
  });

  it('quotes a comma inside a field the same way CDSL\'s own template does for its example email', () => {
    // CDSL's own template file (EXEMPLE FICHIER CSV ADKSY.csv) contains
    // "virginie@cds-logistique,fr" as a quoted field — note the comma
    // where a dot would be expected, an apparent typo in CDSL's own
    // example (see this feature's final report). That malformed shape is
    // not itself a valid email, so it is exercised here via
    // shippingAddress2 (free text, not email-validated) instead of
    // customerEmail — this test is only proving the comma-inside-a-field
    // quoting behavior, not endorsing the typo as valid data.
    const csv = ordersToCdslCsv([makeOrder({ shippingAddress2: 'virginie@cds-logistique,fr' })]);
    expect(csv).toContain('"VIRGINIE@CDS-LOGISTIQUE,FR"');
  });

  it('throws CdslExportValidationError and produces no output when an order is invalid', () => {
    const invalidOrder = makeOrder({ customerName: '' });
    expect(() => ordersToCdslCsv([invalidOrder])).toThrow(CdslExportValidationError);
  });
});

describe('CSV/formula-injection protection', () => {
  it.each(['=cmd|calc', '+1234', '-SUM(A1:A10)', '@SUM(1+1)'])(
    'prefixes a free-text field with a leading quote when it starts with "%s"',
    (dangerous) => {
      const [row] = buildCdslCsvRows([makeOrder({ customerName: dangerous })]);
      // Uppercased first (per the existing rule), THEN protected — the
      // leading quote is the very first character of the cell.
      expect(row[5].startsWith("'")).toBe(true);
      expect(row[5]).toBe(`'${dangerous.toUpperCase()}`);
    }
  );

  it('applies the same protection to address, postal code, city, country, email and product reference', () => {
    const items = [
      { id: 'i1', orderId: 'cm-order-1', productId: 'p1', title: 'A', quantity: 1, price: 10, purchasePrice: 5, product: makeProduct({ sku: '=EVIL' }) },
    ] as unknown as OrderForCdslExport['items'];
    const [row] = buildCdslCsvRows([
      makeOrder(
        {
          shippingAddress: '+33 rue du Danger',
          shippingAddress2: '-Bat Danger',
          shippingPostalCode: '@75000',
          shippingCity: '=Paris',
          shippingCountry: '+FR+', // not a recognized 2-letter code -> passthrough, still protected
          customerEmail: '+danger@example.com',
        },
        items
      ),
    ]);

    expect(row[6]).toBe("'+33 RUE DU DANGER"); // ADRESSE
    expect(row[7]).toBe("'-BAT DANGER"); // COMPLEMENT ADRESSE
    expect(row[8]).toBe("'@75000"); // CODE POSTAL
    expect(row[9]).toBe("'=PARIS"); // VILLE
    expect(row[10]).toBe("'+FR+"); // PAYS
    expect(row[14]).toBe("'+DANGER@EXAMPLE.COM"); // ADRESSE EMAIL
    expect(row[17]).toBe("'=EVIL"); // REFERENCE DU PRODUIT
  });

  it('never protects NUMERO DE LA COMMANDE (order.id) — documented, deliberate exclusion', () => {
    const [row] = buildCdslCsvRows([makeOrder({ id: '=not-a-real-id-but-never-protected' })]);
    expect(row[2]).toBe('=not-a-real-id-but-never-protected');
  });

  it('never protects NUMERO DE TELEPHONNE — a leading "+" is a legitimate international dialing prefix', () => {
    const [row] = buildCdslCsvRows([makeOrder({ shippingPhone: '+33637675658' })]);
    expect(row[12]).toBe('+33637675658');
  });

  it('never protects QUANTITES or the date columns', () => {
    const [row] = buildCdslCsvRows([makeOrder()], { desiredDeliveryDate: new Date('2026-10-10T00:00:00.000Z') });
    expect(row[0]).not.toMatch(/^'/);
    expect(row[1]).not.toMatch(/^'/);
    expect(row[21]).not.toMatch(/^'/);
  });

  it('leaves an ordinary field completely untouched (no stray quote added)', () => {
    const [row] = buildCdslCsvRows([makeOrder({ customerName: 'Dupont Arthur' })]);
    expect(row[5]).toBe('DUPONT ARTHUR');
  });

  it('combines correctly with accented characters', () => {
    const [row] = buildCdslCsvRows([makeOrder({ customerName: '=Éloïse Côté' })]);
    expect(row[5]).toBe("'=ÉLOÏSE CÔTÉ");
  });

  it('combines correctly with CSV quoting when the protected field also contains a comma', () => {
    const csv = ordersToCdslCsv([makeOrder({ customerName: '=Dupont, Arthur' })]);
    // The leading quote is part of the cell's text content; RFC 4180
    // quoting (for the comma) wraps the whole thing and doubles any
    // literal double-quote character — there is none here, just the
    // single straight quote, which is not a CSV-special character.
    expect(csv).toContain('"\'=DUPONT, ARTHUR"');
  });

  it('combines correctly with an internal double-quote in a protected field', () => {
    const csv = ordersToCdslCsv([makeOrder({ shippingAddress: '=9 rue "des Lilas"' })]);
    expect(csv).toContain('"\'=9 RUE ""DES LILAS"""');
  });

  it('combines correctly with a line break in a protected field', () => {
    const csv = ordersToCdslCsv([makeOrder({ shippingAddress2: '-Bat F\nEtage 2' })]);
    expect(csv).toContain('"\'-BAT F\nETAGE 2"');
  });

  it('rejects a product reference that is exactly 16 characters only before protection — the protected value (17 chars) must fail validation', () => {
    // A 16-character SKU that happens to start with a trigger character
    // becomes 17 characters once protected — CDSL's own 16-character hard
    // limit must be checked against that FINAL value, never the raw one.
    const sku = '=' + 'A'.repeat(15); // 16 chars raw, 17 chars once protected
    expect(sku.length).toBe(16);
    const items = [
      { id: 'i1', orderId: 'cm-order-1', productId: 'p1', title: 'A', quantity: 1, price: 10, purchasePrice: 5, product: makeProduct({ sku }) },
    ] as unknown as OrderForCdslExport['items'];
    const errors = validateOrderForCdslExport(makeOrder({}, items));
    expect(errors.some((e) => e.includes('16'))).toBe(true);
  });

  it('accepts a product reference that stays within 16 characters after protection', () => {
    const sku = '=' + 'A'.repeat(14); // 15 chars raw, 16 chars once protected — exactly at the limit
    const items = [
      { id: 'i1', orderId: 'cm-order-1', productId: 'p1', title: 'A', quantity: 1, price: 10, purchasePrice: 5, product: makeProduct({ sku }) },
    ] as unknown as OrderForCdslExport['items'];
    expect(validateOrderForCdslExport(makeOrder({}, items))).toEqual([]);
  });
});

describe('validateOrderForCdslExport', () => {
  it('returns no errors for a fully valid order', () => {
    expect(validateOrderForCdslExport(makeOrder())).toEqual([]);
  });

  it('flags a missing customer name, naming the order', () => {
    const errors = validateOrderForCdslExport(makeOrder({ customerName: '' }));
    expect(errors.some((e) => e.includes('cm-order-1') && e.includes('nom du client'))).toBe(true);
  });

  it('flags a missing/invalid customer email', () => {
    expect(validateOrderForCdslExport(makeOrder({ customerEmail: '' })).length).toBeGreaterThan(0);
    expect(validateOrderForCdslExport(makeOrder({ customerEmail: 'not-an-email' })).length).toBeGreaterThan(0);
  });

  it('flags a missing shipping address, postal code, city, or country', () => {
    expect(validateOrderForCdslExport(makeOrder({ shippingAddress: '' })).length).toBeGreaterThan(0);
    expect(validateOrderForCdslExport(makeOrder({ shippingPostalCode: '' })).length).toBeGreaterThan(0);
    expect(validateOrderForCdslExport(makeOrder({ shippingCity: '' })).length).toBeGreaterThan(0);
    expect(validateOrderForCdslExport(makeOrder({ shippingCountry: '' })).length).toBeGreaterThan(0);
  });

  it('flags a product reference longer than 16 characters, naming the reference', () => {
    const items = [
      {
        id: 'i1',
        orderId: 'cm-order-1',
        productId: 'p1',
        title: 'A',
        quantity: 1,
        price: 10,
        purchasePrice: 5,
        product: makeProduct({ sku: 'ADIDAS-CAMPUS-002' }), // 18 chars — a real seeded SKU in this codebase
      },
    ] as unknown as OrderForCdslExport['items'];
    const errors = validateOrderForCdslExport(makeOrder({}, items));
    expect(errors.some((e) => e.includes('ADIDAS-CAMPUS-002') && e.includes('16'))).toBe(true);
  });

  it('accepts a product reference of exactly 16 characters', () => {
    const items = [
      { id: 'i1', orderId: 'cm-order-1', productId: 'p1', title: 'A', quantity: 1, price: 10, purchasePrice: 5, product: makeProduct({ sku: 'A'.repeat(CDSL_PRODUCT_REFERENCE_MAX_LENGTH) }) },
    ] as unknown as OrderForCdslExport['items'];
    expect(validateOrderForCdslExport(makeOrder({}, items))).toEqual([]);
  });

  it('flags a missing product reference', () => {
    const items = [
      { id: 'i1', orderId: 'cm-order-1', productId: 'p1', title: 'A', quantity: 1, price: 10, purchasePrice: 5, product: makeProduct({ sku: '' }) },
    ] as unknown as OrderForCdslExport['items'];
    expect(validateOrderForCdslExport(makeOrder({}, items)).length).toBeGreaterThan(0);
  });

  it.each([0, -1, -5])('flags a non-positive quantity (%i)', (quantity) => {
    const items = [
      { id: 'i1', orderId: 'cm-order-1', productId: 'p1', title: 'A', quantity, price: 10, purchasePrice: 5, product: makeProduct() },
    ] as unknown as OrderForCdslExport['items'];
    const errors = validateOrderForCdslExport(makeOrder({}, items));
    expect(errors.some((e) => e.includes('quantité'))).toBe(true);
  });

  it('flags an order with no product lines at all', () => {
    const errors = validateOrderForCdslExport(makeOrder({}, [] as unknown as OrderForCdslExport['items']));
    expect(errors.some((e) => e.includes('aucune ligne produit'))).toBe(true);
  });

  it('reports one error per bad line without blocking the good lines from being named too', () => {
    const items = [
      { id: 'i1', orderId: 'cm-order-1', productId: 'p1', title: 'A', quantity: 1, price: 10, purchasePrice: 5, product: makeProduct({ sku: 'GOOD-SKU' }) },
      { id: 'i2', orderId: 'cm-order-1', productId: 'p2', title: 'B', quantity: -1, price: 10, purchasePrice: 5, product: makeProduct({ sku: 'BAD-SKU-TOO-LONG-123' }) },
    ] as unknown as OrderForCdslExport['items'];
    const errors = validateOrderForCdslExport(makeOrder({}, items));
    // The whole order is invalid (not just the bad line) — the good line
    // must never be silently exported alone.
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateOrdersForCdslExport', () => {
  it('returns one result per order, in order, with orderId attached', () => {
    const results = validateOrdersForCdslExport([makeOrder({ id: 'o1' }), makeOrder({ id: 'o2', customerName: '' })]);
    expect(results).toEqual([
      { orderId: 'o1', errors: [] },
      { orderId: 'o2', errors: expect.any(Array) },
    ]);
    expect(results[1].errors.length).toBeGreaterThan(0);
  });
});
