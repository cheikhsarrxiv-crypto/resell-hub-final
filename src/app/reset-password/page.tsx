'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/UI/Button';

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const userId = searchParams.get('userId');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setState('submitting');
    setError('');

    try {
      const response = await fetch(
        `/api/auth/reset-password?userId=${encodeURIComponent(userId || '')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password, confirmPassword }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to reset password');
        setState('error');
        return;
      }

      setState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
      setState('error');
    }
  };

  const linkInvalid = !token || !userId;

  return (
    <div className="min-h-screen bg-[#14161A] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="flex items-center gap-2 mb-2">
            <svg width="26" height="26" viewBox="0 0 72 72" className="flex-shrink-0">
              <circle cx="36" cy="36" r="32" fill="none" stroke="#FF5A1F" strokeWidth="6" />
              <path d="M24 48 L36 22 L48 48 M29 39 H43" stroke="#14161A" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <h1 className="text-3xl font-bold text-[#14161A] tracking-tight">ADKSY</h1>
          </div>

          {linkInvalid ? (
            <>
              <h2 className="text-xl font-semibold text-red-700 mb-2 mt-6">Invalid reset link</h2>
              <p className="text-gray-600 mb-6">
                This password reset link is missing required information. Please request a new one.
              </p>
              <Link href="/forgot-password">
                <Button variant="primary" size="lg" className="w-full">
                  Request a new link
                </Button>
              </Link>
            </>
          ) : state === 'success' ? (
            <>
              <h2 className="text-xl font-semibold text-green-700 mb-2 mt-6">Password reset</h2>
              <p className="text-gray-600 mb-6">
                Your password has been changed. You can now sign in with your new password.
              </p>
              <Link href="/login">
                <Button variant="primary" size="lg" className="w-full">
                  Go to login
                </Button>
              </Link>
            </>
          ) : (
            <>
              <p className="text-gray-600 mb-8 mt-2">Choose a new password for your account.</p>

              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                    {state === 'error' && (
                      <>
                        {' '}
                        <Link href="/forgot-password" className="underline font-medium">
                          Request a new link
                        </Link>
                      </>
                    )}
                  </div>
                )}

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    New password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="••••••••"
                  />
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm new password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="••••••••"
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={state === 'submitting'}
                  className="w-full"
                >
                  Reset password
                </Button>
              </form>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-gray-600 text-sm">
                  <Link href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
                    Back to login
                  </Link>
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
