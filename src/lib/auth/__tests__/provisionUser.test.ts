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

  // Google OAuth slug-collision fix — two different real email addresses
  // that share the same local part (the part before '@') used to abort
  // the whole provisioning transaction with an unhandled unique
  // constraint violation on Workspace.slug.
  it('a second account whose email local-part collides with an existing workspace slug gets a disambiguated slug, and the first workspace is never touched', async () => {
    const localPart = `provision-collide-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const emailA = `${localPart}@example.com`;
    const emailB = `${localPart}@another-provider.example`;

    const { user: userA, workspace: workspaceA } = await provisionUser({
      email: emailA,
      name: 'Collision A',
      password: null,
      preVerifiedEmail: true,
    });
    createdUserIds.push(userA.id);

    expect(workspaceA.slug).toBe(localPart);

    const { user: userB, workspace: workspaceB } = await provisionUser({
      email: emailB,
      name: 'Collision B',
      password: null,
      preVerifiedEmail: true,
    });
    createdUserIds.push(userB.id);

    // Deterministic, collision-resistant fallback — never the same slug,
    // never a random/non-deterministic value, always derived from this
    // user's own real id.
    expect(workspaceB.slug).toBe(`${localPart}-${userB.id.slice(-8)}`);
    expect(workspaceB.slug).not.toBe(workspaceA.slug);

    // The first user's workspace was never renamed/touched by the second call.
    const dbWorkspaceA = await prisma.workspace.findUnique({ where: { id: workspaceA.id } });
    expect(dbWorkspaceA?.slug).toBe(localPart);
  });
});
