'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/UI/Button';
import { AuthCard } from '@/components/auth/AuthCard';

/**
 * NextAuth's own `pages.error` destination (src/auth.config.ts) — reached
 * whenever an OAuth sign-in fails or is refused, including a `false`
 * return from src/auth.ts's Google signIn callback (unverified email,
 * reserved admin email). Never shown for Credentials errors, which stay
 * inline on /login as before. Never displays a token, secret, or any
 * internal detail — only a short, generic, French message per NextAuth
 * error code.
 */
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "La connexion a été refusée. Vérifie que l'adresse e-mail de ton compte Google est bien vérifiée, ou réessaie avec une autre méthode.",
  OAuthSignin: 'Impossible de démarrer la connexion avec ce fournisseur. Réessaie dans quelques instants.',
  OAuthCallback: 'La connexion avec ce fournisseur a échoué. Réessaie dans quelques instants.',
  OAuthCreateAccount: 'Impossible de créer ton compte avec ce fournisseur pour le moment.',
  OAuthAccountNotLinked: 'Cette adresse e-mail est déjà associée à un autre moyen de connexion.',
  Configuration: "Un problème de configuration empêche la connexion pour le moment. Réessaie plus tard.",
  Verification: 'Ce lien de vérification est invalide ou a expiré.',
  Default: 'Une erreur est survenue pendant la connexion. Réessaie dans quelques instants.',
};

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('error') ?? 'Default';
  const message = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.Default;

  return (
    <AuthCard title="Connexion impossible" subtitle={message}>
      <Link href="/login">
        <Button type="button" variant="primary" size="lg" className="w-full rounded-xl">
          Retour à la connexion
        </Button>
      </Link>
    </AuthCard>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={null}>
      <AuthErrorContent />
    </Suspense>
  );
}
