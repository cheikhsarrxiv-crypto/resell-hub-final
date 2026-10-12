/**
 * Static-markup rendering tests for the CDSL export warning banners —
 * same renderToStaticMarkup approach as
 * src/components/ai/__tests__/agent-ui-rendering.test.tsx (no
 * @testing-library/react/jsdom in this project; these two components
 * take no hooks/context, so they render cleanly in vitest's node
 * environment, unlike the page they're used in).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CdslExportPreDownloadWarning, CdslExportPostDownloadWarning } from '../CdslExportWarnings';

describe('CdslExportPreDownloadWarning', () => {
  it('states that a download never transmits an order to CDSL', () => {
    const html = renderToStaticMarkup(<CdslExportPreDownloadWarning />);
    expect(html).toContain('aucune commande n');
    expect(html).toContain('est transmise à CDSL');
  });

  it('warns that nothing is marked as sent/shipped in ADKSY', () => {
    const html = renderToStaticMarkup(<CdslExportPreDownloadWarning />);
    expect(html).toContain('marquée comme expédiée');
  });

  it('warns about the duplicate risk of re-downloading the same orders', () => {
    const html = renderToStaticMarkup(<CdslExportPreDownloadWarning />);
    expect(html).toContain('doublon');
  });

  it('tells the user to verify the batch and file before any manual send', () => {
    const html = renderToStaticMarkup(<CdslExportPreDownloadWarning />);
    expect(html).toContain('Vérifiez le lot');
  });

  it('renders as an alert region, for accessibility', () => {
    const html = renderToStaticMarkup(<CdslExportPreDownloadWarning />);
    expect(html).toContain('role="alert"');
  });
});

describe('CdslExportPostDownloadWarning', () => {
  const props = { exportedAtLabel: '12/10/2026 14:30', orderCount: 3, filename: 'cdsl-export-test.csv' };

  it('shows what was exported (date, count, filename) without claiming it was sent', () => {
    const html = renderToStaticMarkup(<CdslExportPostDownloadWarning {...props} />);
    expect(html).toContain('12/10/2026 14:30');
    expect(html).toContain('3 commande');
    expect(html).toContain('cdsl-export-test.csv');
    expect(html).not.toMatch(/envoyé(e)? à CDSL\./); // never claims it was sent
  });

  it('states the file was not sent to CDSL and nothing was marked as sent/shipped', () => {
    const html = renderToStaticMarkup(<CdslExportPostDownloadWarning {...props} />);
    expect(html).toContain('n&#x27;a pas été envoyé à CDSL');
    expect(html).toContain('marquée comme envoyée ou expédiée');
  });

  it('warns about the duplicate risk of a repeat download/transmission', () => {
    const html = renderToStaticMarkup(<CdslExportPostDownloadWarning {...props} />);
    expect(html).toContain('doublon');
  });

  it('tells the user to verify the file before manually sending it', () => {
    const html = renderToStaticMarkup(<CdslExportPostDownloadWarning {...props} />);
    expect(html).toContain('Vérifiez ce fichier');
  });

  it('never leaks real order data — only the count, label and filename passed in', () => {
    const html = renderToStaticMarkup(<CdslExportPostDownloadWarning {...props} />);
    // No customer/order-identifying content beyond what was explicitly passed.
    expect(html).not.toMatch(/@/); // no email-shaped content
  });
});
