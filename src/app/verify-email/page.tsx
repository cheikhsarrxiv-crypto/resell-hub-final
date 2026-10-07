'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/UI/Button';
import { AuthCard } from '@/components/auth/AuthCard';
import { signOutAction } from '@/app/actions/auth';

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
          setVerifyError(data.error || 'La vérification a échoué');
          setVerifyState('error');
          return;
        }

        setVerifyState('success');
      } catch (err) {
        setVerifyError(err instanceof Error ? err.message : 'La vérification a échoué');
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
        setResendMessage(data.error || "L'envoi de l'email de vérification a échoué");
        setResendState('error');
        return;
      }

      setResendMessage(data.message || 'Email de vérification envoyé');
      setResendState('sent');
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : "L'envoi de l'email de vérification a échoué");
      setResendState('error');
    }
  };

  const footer = (
    <div className="space-y-3">
      {/* Plain <a>, not <Link>: for a still-unverified, already logged-in
          user this hits a real two-hop server redirect (middleware sends
          /login -> /dashboard since a session exists, then
          dashboard/layout.tsx sends -> /verify-email since the email
          isn't verified yet). A real full page load resolves that chain
          correctly (verified via curl -L end to end), but Next.js's App
          Router client-side navigation can get stuck on a blank page
          across a same-navigation double redirect — a plain anchor
          forces a full reload and sidesteps it. */}
      <p className="text-sm text-gray-600">
        <a href="/login" className="text-[#FF5A1F] hover:text-[#e64f18] font-medium">
          Retour à la connexion
        </a>
      </p>
      {/* A user who reaches this page already authenticated but
          unverified had no way to sign out before: "Back to login" only
          bounces them right back here (session exists -> middleware
          sends /login -> /dashboard -> dashboard/layout.tsx sends ->
          /verify-email). signOutAction is the same Server Action used
          elsewhere (DashboardLayout, workspace page); for a visitor with
          no session it's a harmless no-op redirect to /login. */}
      <form action={signOutAction}>
        <button type="submit" className="text-gray-500 hover:text-gray-700 text-sm font-medium">
          Se déconnecter
        </button>
      </form>
    </div>
  );

  if (token && userId) {
    if (verifyState === 'success') {
      return (
        <AuthCard title="Email vérifié" footer={footer}>
          <p className="text-sm text-gray-600 text-center mb-6">
            Ton adresse email a été confirmée. Tu as maintenant un accès complet à ADKSY.
          </p>
          <a href="/dashboard">
            <Button variant="primary" size="lg" className="w-full rounded-xl">
              Aller au dashboard
            </Button>
          </a>
        </AuthCard>
      );
    }

    if (verifyState === 'error') {
      return (
        <AuthCard title="Échec de la vérification" footer={footer}>
          <p className="text-sm text-gray-600 text-center mb-6">{verifyError}</p>
          <Button
            variant="primary"
            size="lg"
            className="w-full rounded-xl"
            onClick={handleResend}
            loading={resendState === 'sending'}
          >
            Envoyer un nouvel email de vérification
          </Button>
          {resendMessage && (
            <p className={`mt-4 text-sm text-center ${resendState === 'error' ? 'text-red-600' : 'text-green-600'}`}>
              {resendMessage}
            </p>
          )}
        </AuthCard>
      );
    }

    return (
      <AuthCard title="Vérification en cours" footer={footer}>
        <p className="text-sm text-gray-600 text-center">Vérification de ton adresse email...</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Vérifie ta boîte mail" footer={footer}>
      <p className="text-sm text-gray-600 text-center mb-6">
        Nous avons envoyé un lien de vérification à ton adresse email. Clique dessus pour activer ton
        compte et débloquer l&apos;accès complet à ADKSY.
      </p>
      <Button
        variant="primary"
        size="lg"
        className="w-full rounded-xl"
        onClick={handleResend}
        loading={resendState === 'sending'}
        disabled={resendState === 'sending'}
      >
        Renvoyer l&apos;email de vérification
      </Button>
      {resendMessage && (
        <p className={`mt-4 text-sm text-center ${resendState === 'error' ? 'text-red-600' : 'text-green-600'}`}>
          {resendMessage}
        </p>
      )}
    </AuthCard>
  );
}
