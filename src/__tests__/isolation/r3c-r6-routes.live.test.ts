/**
 * R6 — workspace PUT and onboarding POST against the dedicated local test database
 * (real handlers, real Prisma, real `@/lib/security`; only the session is replaced).
 *
 * Run ONLY through the guarded runner:
 *   node scripts/r3c/run-with-test-db.mjs vitest src/__tests__/isolation/r3c-r6-routes.live.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { enforceGuardForTestRun } from '@/lib/testing/dbSafetyGuard';
import { connectGuardedPrisma, createAbFixture, cleanupAbFixture, snapshotTenant, type AbFixture } from '@/lib/testing/r3cHarness';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@/auth', () => ({ auth: authMock }));

const guarded = enforceGuardForTestRun(process.env) === 'guarded';

import * as workspaceRoute from '@/app/api/workspaces/[id]/route';
import * as onboardingRoute from '@/app/api/onboarding/route';

describe.skipIf(!guarded)('R6 — workspace PUT / onboarding POST on the local test database', () => {
  let prisma: PrismaClient;
  let fx: AbFixture;
  let beforeB: string;

  beforeAll(async () => {
    prisma = await connectGuardedPrisma();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  beforeEach(async () => {
    fx = await createAbFixture(prisma);
    beforeB = await snapshotTenant(prisma, fx.B);
    authMock.mockResolvedValue({ user: { id: fx.A.userId, workspaceId: fx.A.workspaceId } });
  });
  afterEach(async () => {
    if (fx) {
      await prisma.onboardingData.deleteMany({ where: { workspaceId: { in: [fx.A.workspaceId, fx.B.workspaceId] } } });
      await cleanupAbFixture(prisma, fx);
    }
  });

  const request = (url: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const asA = () => `workspaceId=${fx.A.workspaceId}`;

  it('PUT with extra sensitive fields changes only name/description/country of A; slug, owner and Stripe id are untouched', async () => {
    const before = await prisma.workspace.findUniqueOrThrow({ where: { id: fx.A.workspaceId } });
    const res = await workspaceRoute.PUT(
      request(`/api/workspaces/${fx.A.workspaceId}?${asA()}`, 'PUT', {
        name: 'Renamed shop', country: 'be', userId: fx.B.userId, slug: 'hijacked-slug', stripeCustomerId: 'cus_forged', subscriptionId: 'x', onboardingCompleted: true,
      }),
      { params: { id: fx.A.workspaceId } }
    );
    expect(res.status).toBe(200);
    const after = await prisma.workspace.findUniqueOrThrow({ where: { id: fx.A.workspaceId } });
    expect(after.name).toBe('Renamed shop');
    expect(after.country).toBe('BE');
    expect(after.userId).toBe(before.userId);
    expect(after.slug).toBe(before.slug);
    expect(after.stripeCustomerId).toBe(before.stripeCustomerId);
    expect(after.subscriptionId).toBe(before.subscriptionId);
    expect(after.onboardingCompleted).toBe(before.onboardingCompleted);
    expect(await snapshotTenant(prisma, fx.B)).toBe(beforeB);
  });

  it('PUT with wrongly typed values is a clean 400 (no Prisma text) and nothing changes', async () => {
    const before = JSON.stringify(await prisma.workspace.findUniqueOrThrow({ where: { id: fx.A.workspaceId } }));
    for (const body of [{ name: { set: 'x' } }, { name: ['a'] }, { country: 12 }, { description: 'x'.repeat(600) }]) {
      const res = await workspaceRoute.PUT(request(`/api/workspaces/${fx.A.workspaceId}?${asA()}`, 'PUT', body), { params: { id: fx.A.workspaceId } });
      const text = await res.text();
      expect(res.status).toBe(400);
      expect(text).not.toMatch(/prisma|invocation|Argument/i);
    }
    expect(JSON.stringify(await prisma.workspace.findUniqueOrThrow({ where: { id: fx.A.workspaceId } }))).toBe(before);
  });

  it("A cannot PUT B's workspace, neither through the path nor through the query", async () => {
    for (const [pathId, queryId] of [[fx.B.workspaceId, fx.B.workspaceId], [fx.B.workspaceId, fx.A.workspaceId], [fx.A.workspaceId, fx.B.workspaceId]]) {
      const res = await workspaceRoute.PUT(request(`/api/workspaces/${pathId}?workspaceId=${queryId}`, 'PUT', { name: 'pwned' }), { params: { id: pathId } });
      expect([401, 403, 404]).toContain(res.status); // 401 for a foreign workspace is the known R3-C reserve (denial is correct)
    }
    expect(await snapshotTenant(prisma, fx.B)).toBe(beforeB);
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: fx.B.workspaceId } })).name).not.toBe('pwned');
  });

  it("onboarding POST writes only A's onboarding row; a workspaceId in the body cannot redirect it to B", async () => {
    const res = await onboardingRoute.POST(
      request(`/api/onboarding?${asA()}`, 'POST', { step: 2, businessName: 'A business', workspaceId: fx.B.workspaceId, currentStep: 7 })
    );
    expect(res.status).toBe(200);
    const a = await prisma.onboardingData.findUniqueOrThrow({ where: { workspaceId: fx.A.workspaceId } });
    expect(a).toMatchObject({ currentStep: 2, businessName: 'A business' });
    expect(await prisma.onboardingData.count({ where: { workspaceId: fx.B.workspaceId } })).toBe(0);
    expect(await snapshotTenant(prisma, fx.B)).toBe(beforeB);
  });

  it('onboarding POST with an invalid step is a 400 that creates nothing', async () => {
    for (const body of [{ step: '2' }, { step: 2.5 }, { step: 99 }, { step: 2, businessName: { a: 1 } }]) {
      const res = await onboardingRoute.POST(request(`/api/onboarding?${asA()}`, 'POST', body));
      expect(res.status).toBe(400);
    }
    expect(await prisma.onboardingData.count({ where: { workspaceId: fx.A.workspaceId } })).toBe(0);
  });
});
