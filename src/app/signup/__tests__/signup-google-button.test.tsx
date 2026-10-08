/**
 * Renders the REAL SignupPage via renderToStaticMarkup — proves the
 * Google button was added above the existing form WITHOUT removing or
 * altering that form. Same next/navigation mocking convention as
 * login-google-button.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));
vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}));

import { useRouter } from 'next/navigation';
import SignupPage from '@/app/signup/page';

const useRouterMock = useRouter as unknown as ReturnType<typeof vi.fn>;

describe('SignupPage — Google button + unchanged Credentials form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouterMock.mockReturnValue({ push: vi.fn(), refresh: vi.fn() });
  });

  it('renders without crashing', () => {
    expect(() => renderToStaticMarkup(<SignupPage />)).not.toThrow();
  });

  it('shows "Continuer avec Google" above an "ou" divider, above the name field', () => {
    const html = renderToStaticMarkup(<SignupPage />);
    const googleIndex = html.indexOf('Continuer avec Google');
    const dividerIndex = html.indexOf('>ou<');
    const nameIndex = html.indexOf('id="name"');

    expect(googleIndex).toBeGreaterThan(-1);
    expect(dividerIndex).toBeGreaterThan(googleIndex);
    expect(nameIndex).toBeGreaterThan(dividerIndex);
  });

  it('the existing Credentials signup form is still fully present, untouched', () => {
    const html = renderToStaticMarkup(<SignupPage />);
    expect(html).toContain('id="name"');
    expect(html).toContain('id="email"');
    expect(html).toContain('id="country"');
    expect(html).toContain('id="password"');
    expect(html).toContain('id="confirmPassword"');
    expect(html).toContain('Créer mon compte');
  });
});
