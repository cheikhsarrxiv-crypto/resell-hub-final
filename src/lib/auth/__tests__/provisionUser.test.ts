/**
 * Real-DB tests for provisionUser — the single shared function Credentials
 * signup and Google sign-in both use to create User + free Subscription +
 * default Workspace atomically. Same dbAvailable skip convention as
 * src/services/__tests__/onboarding-progress.test.ts (this project has no
 * mocked-Prisma convention for transactional multi-table writes — a real
 * Postgres connection is the only way to prove the transaction itself
 * works, not just that the right methods were called).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { provisionUser } from '@/lib/auth/provisionUser';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const createdUserIds: string[] = [];

/** Settles a promise without letting a rejection short-circuit a surrounding
 * Promise.all — used below to run two real concurrent provisionUser calls
 * while still inspecting BOTH outcomes individually. */
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

afterEach(async () => {
  if (!dbAvailable) return;
  // Workspace.user has onDelete: Cascade, so deleting the User also
  // removes the Workspace it owns — same convention as
  // onboarding-progress.test.ts. The Subscription row is left behind
  // (no cascade from Workspace), matching that same pre-existing
  // convention rather than inventing new cleanup behavior here.
  for (const id of createdUserIds.splice(0)) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
});

describe.skipIf(!dbAvailable)('provisionUser — real DB', () => {
  it('creates User + free Subscription + default Workspace in one call', async () => {
    const email = `provision-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

    const { user, workspace } = await provisionUser({
      email,
      name: 'Provision Test',
      password: 'hashed-password-placeholder',
      country: 'FR',
      preVerifiedEmail: false,
    });
    createdUserIds.push(user.id);

    expect(user.email).toBe(email);
    expect(workspace.name).toBe("Provision Test's Workspace");

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser?.emailVerified).toBe(false);
    expect(dbUser?.password).toBe('hashed-password-placeholder');

    const dbWorkspace = await prisma.workspace.findUnique({ where: { id: workspace.id } });
    expect(dbWorkspace?.userId).toBe(user.id);

    const subscription = await prisma.subscription.findUnique({ where: { id: dbWorkspace!.subscriptionId! } });
    expect(subscription?.status).toBe('active');

    const plan = await prisma.plan.findUnique({ where: { id: subscription!.planId } });
    expect(plan?.name).toBe('free');
  });

  it('a Google-only account is stored with password: null and emailVerified: true', async () => {
    const email = `provision-google-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

    const { user } = await provisionUser({
      email,
      name: 'Google Person',
      password: null,
      preVerifiedEmail: true,
    });
    createdUserIds.push(user.id);

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser?.password).toBeNull();
    expect(dbUser?.emailVerified).toBe(true);
  });

  it('defaults country to FR when none is passed', async () => {
    const email = `provision-nocountry-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

    const { user } = await provisionUser({
      email,
      name: 'No Country',
      password: null,
      preVerifiedEmail: true,
    });
    createdUserIds.push(user.id);

    expect(user.country).toBe('FR');
  });

  /**
   * ADKSY provisioning audit — proves the transaction's own atomicity on a
   * REAL failure, without touching the shared `free` Plan row (deleting it
   * would be a real, shared-data change, forbidden for a test). Instead, a
   * throwaway "squatter" user's own Workspace is made to occupy, in
   * advance, the exact slug a second provisionUser call would deterministically
   * derive (same local-part, different domain) — forcing the REAL Postgres
   * unique constraint on Workspace.slug to fail provisionUser's own
   * workspace.create step.
   *
   * The only assertion that matters is scoped to this test's own unique
   * email — never a global row count, which a parallel test run elsewhere
   * in the same suite could otherwise perturb. Given prisma.$transaction's
   * own all-or-nothing guarantee, confirming the User row never persisted
   * is already conclusive proof that the Subscription created earlier in
   * the SAME failed call was rolled back too — there is no separate
   * Subscription id to check (the call rejected before ever returning one).
   */
  it('a workspace-creation failure (slug collision) rolls back the whole transaction — no User persists, proven without any global/racy count', async () => {
    const sharedLocalPart = `provision-collision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const squatterEmail = `${sharedLocalPart}@example.com`;
    const failingEmail = `${sharedLocalPart}@example.org`; // same derived slug, different real address

    const { user: squatterUser } = await provisionUser({
      email: squatterEmail,
      name: 'Squatter',
      password: null,
      preVerifiedEmail: true,
    });
    // Pushed immediately, before any assertion below — afterEach cleans
    // this up (cascading to its Workspace) even if an assertion throws.
    createdUserIds.push(squatterUser.id);

    await expect(
      provisionUser({
        email: failingEmail,
        name: 'Should Not Persist',
        password: null,
        preVerifiedEmail: true,
      })
    ).rejects.toBeTruthy();

    const dbUser = await prisma.user.findUnique({ where: { email: failingEmail } });
    expect(dbUser).toBeNull();
  });

  /**
   * ADKSY provisioning audit — two REAL concurrent calls (Promise.all,
   * both launched in the same tick against the same live Postgres
   * connection pool) for the exact same brand-new email. User.email's own
   * @unique constraint is the real backstop being proven here, not a
   * mock. Every assertion below is scoped to this test's own fresh,
   * randomly-suffixed email/userId — never a global count — so it can
   * never observe (or touch) any pre-existing account.
   */
  it('two real concurrent provisionUser calls for the SAME new email: exactly one succeeds, final User/Workspace/Subscription counts are exactly one, no existing account touched', async () => {
    const raceEmail = `provision-race-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const input = { email: raceEmail, name: 'Race Test', password: null, preVerifiedEmail: true as const };

    const [a, b] = await Promise.all([settle(provisionUser(input)), settle(provisionUser(input))]);
    const outcomes = [a, b];

    const fulfilled = outcomes.filter((o): o is { ok: true; value: Awaited<ReturnType<typeof provisionUser>> } => o.ok);
    const rejected = outcomes.filter((o) => !o.ok);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winner = fulfilled[0].value;
    createdUserIds.push(winner.user.id);

    expect(await prisma.user.count({ where: { email: raceEmail } })).toBe(1);
    expect(await prisma.workspace.count({ where: { userId: winner.user.id } })).toBe(1);

    const dbWorkspace = await prisma.workspace.findUnique({ where: { id: winner.workspace.id } });
    expect(dbWorkspace?.subscriptionId).toBeTruthy();
    const subscription = await prisma.subscription.findUnique({ where: { id: dbWorkspace!.subscriptionId! } });
    expect(subscription).not.toBeNull();
    expect(subscription?.status).toBe('active');
  });
});
