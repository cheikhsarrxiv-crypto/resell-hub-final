'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/UI/Button';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (response.status === 429) {
        const data = await response.json();
        throw new Error(data.error || 'Too many requests. Please try again later.');
      }

      // The API always returns a generic success response regardless of
      // whether the email is registered — the UI does the same.
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

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

          {submitted ? (
            <>
              <h2 className="text-xl font-semibold text-[#14161A] mb-2 mt-6">Check your email</h2>
              <p className="text-gray-600 mb-6">
                If an account exists for <strong>{email}</strong>, we've sent a link to reset your password.
                The link expires in 1 hour.
              </p>
              <Link href="/login" className="text-blue-600 hover:text-blue-700 font-medium text-sm">
                Back to login
              </Link>
            </>
          ) : (
            <>
              <p className="text-gray-600 mb-8">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="your@email.com"
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={loading}
                  className="w-full"
                >
                  Send reset link
                </Button>
              </form>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-gray-600 text-sm">
                  Remembered your password?{' '}
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
