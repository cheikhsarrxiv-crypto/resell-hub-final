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
});
