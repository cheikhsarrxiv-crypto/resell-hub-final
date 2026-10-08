'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

interface GoogleButtonProps {
  /** Where to land after a successful Google sign-in — same destination
   * both login and signup pages already use for Credentials. */
  callbackUrl?: string;
}

/**
 * "Continuer avec Google" — real NextAuth OAuth (signIn('google', ...)),
 * never a mock/fake button. Shared between /login and /signup since both
 * pages want the identical button; the form below it (email/password)
 * is untouched, owned entirely by each page.
 *
 * Google's own branding guidelines require a light/white button with the
 * official multi-color "G" mark and legible dark text — deliberately NOT
 * styled in ADKSY's Ink/Signal colors, unlike every other button on this
 * page. The ADKSY identity stays everywhere else (the OU divider, the
 * surrounding card, the error banner on /auth/error).
 */
export function GoogleButton({ callbackUrl = '/dashboard' }: GoogleButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleClick = async () => {
    setError('');
    setLoading(true);
    try {
      // redirect: true (the default) — signIn() navigates the browser to
      // Google's consent screen itself. This only throws/rejects for a
      // failure before that redirect even starts (e.g. unreachable
      // NextAuth endpoint); a rejected/declined consent on Google's side
      // comes back to /auth/error instead, handled by that page.
      await signIn('google', { callbackUrl });
    } catch {
      setError('Connexion à Google impossible pour le moment. Réessaie.');
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-label="Continuer avec Google"
        className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white border border-black/15 rounded-xl text-[#14161A] font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/50 focus:border-transparent transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? (
          <svg className="animate-spin h-5 w-5 text-[#14161A]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <svg className="h-5 w-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#FFC107"
              d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
            />
            <path
              fill="#FF3D00"
              d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
            />
            <path
              fill="#4CAF50"
              d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
            />
            <path
              fill="#1976D2"
              d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
            />
          </svg>
        )}
        <span>{loading ? 'Connexion…' : 'Continuer avec Google'}</span>
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default GoogleButton;
