/**
 * Renders the REAL /auth/error page via renderToStaticMarkup for a few
 * NextAuth error codes. next/navigation's useSearchParams needs a real
 * mounted Next.js router context, which doesn't exist under
 * renderToStaticMarkup — mocked exactly like
 * src/app/dashboard/agent/__tests__/page.test.tsx mocks it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

import { useSearchParams } from 'next/navigation';
import AuthErrorPage from '@/app/auth/error/page';

const useSearchParamsMock = useSearchParams as unknown as ReturnType<typeof vi.fn>;

function setErrorCode(code: string | null) {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(code ? { error: code } : {}));
}

describe('/auth/error page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing for every known code and for no code at all', () => {
    for (const code of ['AccessDenied', 'OAuthSignin', 'OAuthCallback', 'OAuthAccountNotLinked', null]) {
      setErrorCode(code);
      expect(() => renderToStaticMarkup(<AuthErrorPage />)).not.toThrow();
    }
  });

  it('shows a specific, understandable message for AccessDenied (the code our own signIn callback returns false under)', () => {
    setErrorCode('AccessDenied');
    const html = renderToStaticMarkup(<AuthErrorPage />);
    expect(html).toContain('refusée');
  });

  it('falls back to a generic message for an unknown/unrecognized error code', () => {
    setErrorCode('SomeUnknownFutureCode');
    const html = renderToStaticMarkup(<AuthErrorPage />);
    expect(html).toContain('Une erreur est survenue');
  });

  it('always offers a way back to /login', () => {
    setErrorCode('AccessDenied');
    const html = renderToStaticMarkup(<AuthErrorPage />);
    expect(html).toContain('href="/login"');
    expect(html).toContain('Retour à la connexion');
  });

  it('never leaks a token, secret, or internal detail', () => {
    for (const code of ['AccessDenied', 'OAuthSignin', 'Configuration', null]) {
      setErrorCode(code);
      const html = renderToStaticMarkup(<AuthErrorPage />);
      expect(html.toLowerCase()).not.toContain('token');
      expect(html.toLowerCase()).not.toContain('secret');
      expect(html.toLowerCase()).not.toContain('stack');
    }
  });
});
