'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/UI/Button';
import { AuthCard } from '@/components/auth/AuthCard';
import { interpretForgotPasswordResponse } from '@/lib/forgotPasswordResponse';

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

      const outcome = await interpretForgotPasswordResponse(response);

      if (outcome.kind !== 'submitted') {
        throw new Error(outcome.message);
      }

      // The API always returns a generic success response regardless of
      // whether the email is registered — the UI does the same.
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur s'est produite");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <AuthCard title="Vérifie ta boîte mail">
        <p className="text-sm text-gray-600 text-center">
          Si un compte existe pour <strong>{email}</strong>, nous t&apos;avons envoyé un lien pour
          réinitialiser ton mot de passe. Le lien expire dans 1 heure.
        </p>
        <Link
          href="/login"
          className="mt-6 block text-center text-sm text-[#FF5A1F] hover:text-[#e64f18] font-medium"
        >
          Retour à la connexion
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Mot de passe oublié"
      subtitle="Indique ton email, on t'envoie un lien de réinitialisation."
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
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-[#14161A] mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-black/10 rounded-xl text-[#14161A] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/50 focus:border-transparent transition-shadow"
            placeholder="toi@exemple.com"
          />
        </div>

        <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full rounded-xl">
          Envoyer le lien
        </Button>
      </form>
    </AuthCard>
  );
}
