/**
 * Static-markup rendering tests for PasswordInput — see
 * sourcing-cards-rendering.test.tsx's own header comment for why
 * renderToStaticMarkup (no new test dependency) is used here. Real
 * click-toggle behavior (type flips, icon/aria-label swap) is verified
 * against the live dev server (desktop + mobile viewport), not here —
 * this sandbox has no jsdom/testing-library to dispatch real DOM events.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PasswordInput } from '@/components/UI/PasswordInput';

describe('PasswordInput', () => {
  it('defaults to masked: type="password", the "eye" (show) icon, and the "Afficher" aria-label', () => {
    const html = renderToStaticMarkup(<PasswordInput id="password" value="" onChange={() => {}} />);

    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="Afficher le mot de passe"');
    expect(html).toContain('lucide-eye ');
    expect(html).not.toContain('lucide-eye-off');
  });

  it('the toggle is a type="button" — never submits the surrounding form', () => {
    const html = renderToStaticMarkup(<PasswordInput id="password" value="" onChange={() => {}} />);
    expect(html).toContain('type="button"');
  });

  it('preserves the caller-supplied className (border/ring/color classes) untouched, only adding room for the icon', () => {
    const html = renderToStaticMarkup(
      <PasswordInput
        id="password"
        value=""
        onChange={() => {}}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
    );

    expect(html).toContain('border-gray-300');
    expect(html).toContain('focus:ring-blue-500');
    expect(html).toContain('pr-10');
  });

  it('forwards ordinary input props (placeholder, required, value) unchanged', () => {
    const html = renderToStaticMarkup(
      <PasswordInput id="confirmPassword" value="secret123" onChange={() => {}} placeholder="Confirm password" required />
    );

    expect(html).toContain('id="confirmPassword"');
    expect(html).toContain('value="secret123"');
    expect(html).toContain('placeholder="Confirm password"');
    expect(html).toContain('required=""');
  });

  it('never lets a caller override `type` — it stays controlled by the internal visibility state', () => {
    const html = renderToStaticMarkup(
      // @ts-expect-error type is intentionally not part of PasswordInputProps
      <PasswordInput id="password" value="" onChange={() => {}} type="email" />
    );
    expect(html).toContain('type="password"');
    expect(html).not.toContain('type="email"');
  });

  it('accepts custom show/hide labels (e.g. for a differently-localized page) instead of the French defaults', () => {
    const html = renderToStaticMarkup(
      <PasswordInput id="password" value="" onChange={() => {}} showLabel="Show password" hideLabel="Hide password" />
    );
    expect(html).toContain('aria-label="Show password"');
  });

  it('two independent instances (Password + Confirm Password) each default to masked on their own', () => {
    const html = renderToStaticMarkup(
      <div>
        <PasswordInput id="password" value="" onChange={() => {}} />
        <PasswordInput id="confirmPassword" value="" onChange={() => {}} />
      </div>
    );
    const passwordTypeCount = html.match(/type="password"/g)?.length ?? 0;
    expect(passwordTypeCount).toBe(2);
  });
});
