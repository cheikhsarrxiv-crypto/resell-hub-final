'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/UI/Button';
import { AuthCard } from '@/components/auth/AuthCard';

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

const fieldClassName =
  'w-full px-4 py-2.5 bg-white border border-black/10 rounded-xl text-[#14161A] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/50 focus:border-transparent transition-shadow';

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
      setError('Les mots de passe ne correspondent pas');
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
        setError(data.error || 'La réinitialisation du mot de passe a échoué');
        setState('error');
        return;
      }

      setState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La réinitialisation du mot de passe a échoué');
      setState('error');
    }
  };

  const linkInvalid = !token || !userId;

  if (linkInvalid) {
    return (
      <AuthCard title="Lien invalide">
        <p className="text-sm text-gray-600 text-center mb-6">
          Ce lien de réinitialisation est incomplet ou a expiré. Demande-en un nouveau.
        </p>
        <Link href="/forgot-password">
          <Button variant="primary" size="lg" className="w-full rounded-xl">
            Demander un nouveau lien
          </Button>
        </Link>
      </AuthCard>
    );
  }

  if (state === 'success') {
    return (
      <AuthCard title="Mot de passe réinitialisé">
        <p className="text-sm text-gray-600 text-center mb-6">
          Ton mot de passe a été changé. Tu peux maintenant te connecter avec ton nouveau mot de passe.
        </p>
        <Link href="/login">
          <Button variant="primary" size="lg" className="w-full rounded-xl">
            Aller à la connexion
          </Button>
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choisis un nouveau mot de passe"
      footer={
        <p className="text-sm text-gray-600">
          <Link href="/login" className="text-[#FF5A1F] hover:text-[#e64f18] font-medium">
            Retour à la connexion
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
            {state === 'error' && (
              <>
                {' '}
                <Link href="/forgot-password" className="underline font-medium">
                  Demander un nouveau lien
                </Link>
              </>
            )}
          </div>
        )}

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-[#14161A] mb-1.5">
            Nouveau mot de passe
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClassName}
            placeholder="••••••••"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-[#14161A] mb-1.5">
            Confirmer le nouveau mot de passe
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={fieldClassName}
            placeholder="••••••••"
          />
        </div>

        <Button type="submit" variant="primary" size="lg" loading={state === 'submitting'} className="w-full rounded-xl">
          Réinitialiser le mot de passe
        </Button>
      </form>
    </AuthCard>
  );
}
