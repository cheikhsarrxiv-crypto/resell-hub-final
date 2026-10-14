import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('provisionUser');

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
 *
 * Slug collision handling (Google OAuth slug-collision fix): the
 * workspace slug is derived from the email's local part, which is NOT
 * unique across different email domains (jean@gmail.com and
 * jean@yahoo.com both derive "jean") — but Workspace.slug has a DB-level
 * @unique constraint. A plain collision used to abort this whole
 * transaction (and therefore the entire sign-in) with an unhandled
 * Prisma error. Fixed deterministically: the plain, "pretty" slug is
 * tried first; if — and only if — it is already taken by an EXISTING
 * workspace (never touched or renamed here), the new workspace instead
 * gets `${baseSlug}-${user.id.slice(-8)}`, disambiguated by this brand
 * new user's own globally-unique id. Two different users can never
 * collide on that suffixed form, since no two users ever share a
 * User.id. The remaining, genuinely concurrent race (two signups for the
 * same base slug committing at the same instant) is caught as a real
 * Prisma P2002 on the `slug` constraint and retried a bounded number of
 * times (see MAX_ATTEMPTS below) — each retry re-runs the whole
 * transaction from scratch (a fresh User.id, so the suffixed fallback
 * always resolves on the next attempt), never partially.
 */

const MAX_ATTEMPTS = 3;

function baseSlugFor(email: string): string {
  return email.split('@')[0].toLowerCase().replace(/\./g, '-');
}

function isSlugUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    Array.isArray((error.meta as { target?: unknown })?.target) &&
    ((error.meta as { target: unknown[] }).target as unknown[]).includes('slug')
  );
}

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
  const correlationId = randomUUID();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
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

        // Deterministic slug: the plain base slug, unless an existing
        // workspace (never modified here) already has it — in which
        // case this brand-new user's own unique id disambiguates it.
        const baseSlug = baseSlugFor(user.email);
        const existingWithBaseSlug = await tx.workspace.findUnique({
          where: { slug: baseSlug },
          select: { id: true },
        });
        const slug = existingWithBaseSlug ? `${baseSlug}-${user.id.slice(-8)}` : baseSlug;

        const workspace = await tx.workspace.create({
          data: {
            name: `${user.name}'s Workspace`,
            slug,
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
    } catch (error) {
      const isLastAttempt = attempt === MAX_ATTEMPTS;

      if (isSlugUniqueConstraintViolation(error) && !isLastAttempt) {
        // Genuine concurrent race on the same base slug — the whole
        // transaction above (including the User row) was rolled back by
        // Postgres already, so retrying from scratch is safe: a fresh
        // User.id is generated, and the suffixed-slug fallback resolves
        // on this next attempt.
        logger.warn('Workspace slug collision during provisioning — retrying', {
          correlationId,
          attempt,
          category: 'slug_collision_retry',
        });
        continue;
      }

      // Any other failure (or the final retry still colliding, which
      // would be extraordinarily unlikely given the id-suffixed
      // fallback) — never logged with the email/password/any secret,
      // only a correlation id and an error category the caller can act
      // on without needing to parse a raw Prisma error.
      logger.error(
        'User provisioning failed',
        error instanceof Error ? error : String(error),
        {
          correlationId,
          attempt,
          category: isSlugUniqueConstraintViolation(error) ? 'slug_collision_exhausted' : 'provisioning_error',
        }
      );
      throw error;
    }
  }

  // Unreachable (the loop always returns or throws), but keeps the
  // function's return type honest for TypeScript's control-flow analysis.
  throw new Error('provisionUser: exhausted retry attempts');
}
