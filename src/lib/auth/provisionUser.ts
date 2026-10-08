import prisma from '@/lib/prisma';

/**
 * Google OAuth chantier — the single place that creates a brand-new
 * ADKSY account: User + free Subscription + default Workspace, all in
 * one transaction. Both signup paths use this and only this:
 * - Credentials signup (src/app/api/auth/signup/route.ts) — already
 *   hashed password, preVerifiedEmail: false (the existing email
 *   verification flow still runs, unchanged, right after this call).
 * - Google sign-in (src/auth.ts's signIn callback, new-user branch) —
 *   password: null, preVerifiedEmail: true (Google has already proven
 *   the mailbox is owned; there is nothing left to verify by email).
 *
 * Mirrors exactly what the Credentials signup route used to do inline
 * (same free-plan lookup, same workspace name/slug derivation), now
 * wrapped in prisma.$transaction so User/Subscription/Workspace commit
 * or roll back together — a partially-provisioned account (e.g. a User
 * with no Workspace) was possible before and is not anymore.
 */

export interface ProvisionUserInput {
  email: string;
  name: string;
  /** Already-hashed (Credentials) or null (Google-only account — see
   * the nullable User.password migration). Never a raw password. */
  password: string | null;
  country?: string;
  /** True only for a Google sign-in: Google has already verified
   * ownership of this mailbox, so the account is created with
   * emailVerified already set — no verification email is ever sent for
   * it. False for Credentials signup, which still goes through the
   * existing EmailVerificationService flow right after this call. */
  preVerifiedEmail: boolean;
}

export interface ProvisionUserResult {
  user: { id: string; email: string; name: string; country: string | null };
  workspace: { id: string; name: string; slug: string };
}

export async function provisionUser(input: ProvisionUserInput): Promise<ProvisionUserResult> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        password: input.password,
        name: input.name,
        country: input.country ?? 'FR',
        emailVerified: input.preVerifiedEmail,
      },
    });

    const freePlan = await tx.plan.findUnique({ where: { name: 'free' } });
    if (!freePlan) {
      throw new Error('Free plan not found');
    }

    const subscription = await tx.subscription.create({
      data: {
        planId: freePlan.id,
        status: 'active',
      },
    });

    const workspace = await tx.workspace.create({
      data: {
        name: `${user.name}'s Workspace`,
        slug: user.email.split('@')[0].toLowerCase().replace(/\./g, '-'),
        userId: user.id,
        subscriptionId: subscription.id,
        country: user.country || 'FR',
      },
    });

    return {
      user: { id: user.id, email: user.email, name: user.name, country: user.country },
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    };
  });
}
