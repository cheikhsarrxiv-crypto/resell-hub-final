'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/UI/Button';
import { PasswordInput } from '@/components/UI/PasswordInput';
import { AuthCard } from '@/components/auth/AuthCard';

const fieldClassName =
  'w-full px-4 py-2.5 bg-white border border-black/10 rounded-xl text-[#14161A] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/50 focus:border-transparent transition-shadow';

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    country: 'FR',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate
    if (formData.password !== formData.confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      setLoading(false);
      return;
    }

    if (formData.password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          country: formData.country,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "L'inscription a échoué");
      }

      // Redirect to login
      router.push('/login?success=true');
    } catch (err) {
      setError(err instanceof Error ? err.message : "L'inscription a échoué");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Créer ton compte"
      subtitle="Commence à vendre sur plusieurs marketplaces avec ADKSY."
      footer={
        <p className="text-sm text-gray-600">
          Déjà un compte ?{' '}
          <Link href="/login" className="text-[#FF5A1F] hover:text-[#e64f18] font-medium">
            Se connecter
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
          <label htmlFor="name" className="block text-sm font-medium text-[#14161A] mb-1.5">
            Nom complet
          </label>
          <input
            id="name"
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className={fieldClassName}
            placeholder="Ton nom"
            required
          />
        </div>

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
            required
          />
        </div>

        <div>
          <label htmlFor="country" className="block text-sm font-medium text-[#14161A] mb-1.5">
            Pays
          </label>
          <select
            id="country"
            value={formData.country}
            onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            className={fieldClassName}
          >
            <option value="FR">France</option>
            <option value="DE">Allemagne</option>
            <option value="IT">Italie</option>
            <option value="ES">Espagne</option>
            <option value="NL">Pays-Bas</option>
            <option value="BE">Belgique</option>
            <option value="US">États-Unis</option>
            <option value="GB">Royaume-Uni</option>
          </select>
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-[#14161A] mb-1.5">
            Mot de passe
          </label>
          <PasswordInput
            id="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className={fieldClassName}
            placeholder="8 caractères minimum"
            required
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-[#14161A] mb-1.5">
            Confirmer le mot de passe
          </label>
          <PasswordInput
            id="confirmPassword"
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            className={fieldClassName}
            placeholder="Confirme ton mot de passe"
            required
          />
        </div>

        <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full rounded-xl">
          Créer mon compte
        </Button>
      </form>
    </AuthCard>
  );
}
