'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/UI/Button';

type VerifyState = 'idle' | 'verifying' | 'success' | 'error';
type ResendState = 'idle' | 'sending' | 'sent' | 'error';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const userId = searchParams.get('userId');

  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const [verifyError, setVerifyError] = useState('');

  const [resendState, setResendState] = useState<ResendState>('idle');
  const [resendMessage, setResendMessage] = useState('');

  useEffect(() => {
    if (!token || !userId) return;

    const verify = async () => {
      setVerifyState('verifying');
      try {
        const response = await fetch(`/api/email/verify?userId=${encodeURIComponent(userId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await response.json();

        if (!response.ok) {
          setVerifyError(data.error || 'Verification failed');
          setVerifyState('error');
          return;
        }

        setVerifyState('success');
      } catch (err) {
        setVerifyError(err instanceof Error ? err.message : 'Verification failed');
        setVerifyState('error');
      }
    };

    verify();
  }, [token, userId]);

  const handleResend = async () => {
    setResendState('sending');
    setResendMessage('');
    try {
      const response = await fetch('/api/email/resend-verification', {
        method: 'POST',
      });
      const data = await response.json();

      if (!response.ok) {
        setResendMessage(data.error || 'Failed to resend verification email');
        setResendState('error');
        return;
      }

      setResendMessage(data.message || 'Verification email sent');
      setResendState('sent');
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : 'Failed to resend verification email');
      setResendState('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#14161A] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <svg width="26" height="26" viewBox="0 0 72 72" className="flex-shrink-0">
              <circle cx="36" cy="36" r="32" fill="none" stroke="#FF5A1F" strokeWidth="6" />
              <path d="M24 48 L36 22 L48 48 M29 39 H43" stroke="#14161A" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <h1 className="text-3xl font-bold text-[#14161A] tracking-tight">ADKSY</h1>
          </div>

          {token && userId ? (
            <>
              {verifyState === 'verifying' && (
                <p className="text-gray-600">Verifying your email address...</p>
              )}
              {verifyState === 'success' && (
                <>
                  <h2 className="text-xl font-semibold text-green-700 mb-2">Email verified</h2>
                  <p className="text-gray-600 mb-6">
                    Your email address has been confirmed. You now have full access to ADKSY.
                  </p>
                  <Link href="/dashboard">
                    <Button variant="primary" size="lg" className="w-full">
                      Continue to dashboard
                    </Button>
                  </Link>
                </>
              )}
              {verifyState === 'error' && (
                <>
                  <h2 className="text-xl font-semibold text-red-700 mb-2">Verification failed</h2>
                  <p className="text-gray-600 mb-6">{verifyError}</p>
                  <Button variant="primary" size="lg" className="w-full" onClick={handleResend} loading={resendState === 'sending'}>
                    Send a new verification email
                  </Button>
                  {resendMessage && (
                    <p className={`mt-4 text-sm ${resendState === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                      {resendMessage}
                    </p>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-[#14161A] mb-2">Check your email</h2>
              <p className="text-gray-600 mb-6">
                We sent a verification link to your email address. Click it to activate your account
                and unlock full access to ADKSY.
              </p>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={handleResend}
                loading={resendState === 'sending'}
                disabled={resendState === 'sending'}
              >
                Resend verification email
              </Button>
              {resendMessage && (
                <p className={`mt-4 text-sm ${resendState === 'error' ? 'text-red-600' : 'text-green-600'}`}>
                  {resendMessage}
                </p>
              )}
            </>
          )}

          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-gray-600 text-sm">
              {/* Plain <a>, not <Link>: for a still-unverified, already
                  logged-in user this hits a real two-hop server redirect
                  (middleware sends /login -> /dashboard since a session
                  exists, then dashboard/layout.tsx sends -> /verify-email
                  since the email isn't verified yet). A real full page
                  load resolves that chain correctly (verified via curl -L
                  end to end), but Next.js's App Router client-side
                  navigation can get stuck on a blank page across a
                  same-navigation double redirect — a plain anchor forces
                  a full reload and sidesteps it. */}
              <a href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
                Back to login
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
