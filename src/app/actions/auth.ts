'use server';

import { signOut } from '@/auth';

/**
 * Server Action for a plain <form action={signOutAction}> sign-out
 * button. Using next-auth's own `signOut()` (not a raw POST to
 * /api/auth/signout) matters: the API route handler enforces CSRF
 * validation on the "signout" action (@auth/core's AuthInternal ->
 * validateCSRF), which a bare HTML form with no csrfToken field can
 * never satisfy — that request is rejected. The signOut() Server Action
 * explicitly passes `skipCSRFCheck` internally, which is how next-auth
 * intends non-JS/form-based sign-out to work in the App Router.
 */
export async function signOutAction() {
  await signOut({ redirectTo: '/login' });
}
