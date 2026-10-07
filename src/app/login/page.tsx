'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/UI/Button';
import { PasswordInput } from '@/components/UI/PasswordInput';
import { AuthCard } from '@/components/auth/AuthCard';

const fieldClassName =
  'w-full px-4 py-2.5 bg-white border border-black/10 rounded-xl text-[#14161A] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/50 focus:border-transparent transition-shadow';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await signIn('credentials', {
        email: formData.email,
        password: formData.password,
        redirect: false,
      });

      if (result?.status === 429) {
        throw new Error('Trop de tentatives de connexion. Réessaie dans 15 minutes.');
      }

      if (!result || result.error) {
        throw new Error('Email ou mot de passe invalide');
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La connexion a échoué');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Se connecter"
      subtitle="Accède à ton espace ADKSY."
      footer={
        <p className="text-sm text-gray-600">
          Pas encore de compte ?{' '}
          <Link href="/signup" className="text-[#FF5A1F] hover:text-[#e64f18] font-medium">
            Créer un compte
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
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className={fieldClassName}
            placeholder="toi@exemple.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-[#14161A]">
              Mot de passe
            </label>
            <Link href="/forgot-password" className="text-xs text-[#FF5A1F] hover:text-[#e64f18] font-medium">
              Mot de passe oublié ?
            </Link>
          </div>
          <PasswordInput
            id="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className={fieldClassName}
            placeholder="••••••••"
          />
        </div>

        <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full rounded-xl">
          Se connecter
        </Button>
      </form>
    </AuthCard>
  );
}
