/**
 * Static-markup rendering test for GoogleButton — same technique as
 * agent-onboarding-rendering.test.tsx (react-dom/server's
 * renderToStaticMarkup, no jsdom/@testing-library installed in this
 * project). Proves the button renders with the right text/label/type;
 * it cannot simulate a click (no jsdom), so the actual signIn('google')
 * invocation is proven at the source level in google-button-source.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

import { GoogleButton } from '@/components/auth/GoogleButton';

describe('GoogleButton — first render', () => {
  it('renders a real, visible button (never disabled, never a mock placeholder) saying "Continuer avec Google"', () => {
    const html = renderToStaticMarkup(<GoogleButton />);
    expect(html).toContain('Continuer avec Google');
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    // Not actually disabled on first render — the Tailwind
    // "disabled:opacity-60" utility class legitimately contains the
    // word "disabled", so this checks for the real HTML attribute only.
    expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=|[\s>])/);
  });

  it('is accessible — exposes an aria-label matching its visible text', () => {
    const html = renderToStaticMarkup(<GoogleButton />);
    expect(html).toContain('aria-label="Continuer avec Google"');
  });

  it('shows the Google "G" mark as a real multi-color SVG, not a generic/placeholder icon', () => {
    const html = renderToStaticMarkup(<GoogleButton />);
    expect(html).toContain('viewBox="0 0 48 48"');
    // Four distinct brand fills (yellow/red/green/blue), one per stroke
    // of the "G" — a single flat-color icon would not have all four.
    expect(html).toContain('#FFC107');
    expect(html).toContain('#FF3D00');
    expect(html).toContain('#4CAF50');
    expect(html).toContain('#1976D2');
  });

  it('no error message shown on first render', () => {
    const html = renderToStaticMarkup(<GoogleButton />);
    expect(html).not.toContain('role="alert"');
  });
});
