/**
 * Renders the REAL LoginPage via renderToStaticMarkup — proves the
 * Google button was added above the existing form WITHOUT removing or
 * altering that form. next/navigation's useRouter needs a real mounted
 * Next.js router context, which doesn't exist under renderToStaticMarkup
 * ("invariant expected app router to be mounted") — mocked here exactly
 * like src/app/dashboard/agent/__tests__/page.test.tsx mocks it.
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
import LoginPage from '@/app/login/page';

const useRouterMock = useRouter as unknown as ReturnType<typeof vi.fn>;

describe('LoginPage — Google button + unchanged Credentials form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouterMock.mockReturnValue({ push: vi.fn(), refresh: vi.fn() });
  });

  it('renders without crashing', () => {
    expect(() => renderToStaticMarkup(<LoginPage />)).not.toThrow();
  });

  it('shows "Continuer avec Google" above an "ou" divider', () => {
    const html = renderToStaticMarkup(<LoginPage />);
    const googleIndex = html.indexOf('Continuer avec Google');
    const dividerIndex = html.indexOf('>ou<');
    const emailIndex = html.indexOf('id="email"');

    expect(googleIndex).toBeGreaterThan(-1);
    expect(dividerIndex).toBeGreaterThan(googleIndex);
    expect(emailIndex).toBeGreaterThan(dividerIndex);
  });

  it('the existing Credentials email/password form is still fully present, untouched', () => {
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain('id="email"');
    expect(html).toContain('id="password"');
    expect(html).toContain('Se connecter');
    expect(html).toContain('Mot de passe oublié');
    expect(html).toContain('Créer un compte');
  });
});
