/**
 * ADKSY provisioning audit — behavioral proof (not just the source-level
 * checks already in route.test.ts) that GET/PUT /api/ai/agent/profile
 * respond with exactly the documented 403 when an authenticated session
 * has no workspaceId (the exact orphaned-account shape this audit is
 * about — see src/lib/auth/provisionUser.ts and its own test file).
 *
 * Same mocking convention already proven to resolve cleanly for a route
 * under src/app/api/ai/agent/ — see
 * src/app/api/ai/agent/__tests__/route.test.ts's own header comment: only
 * @/auth, @/lib/prisma and @/services/SubscriptionService are mocked;
 * @/lib/security (which this route calls indirectly) is left real, since
 * it resolves fine once its own @/auth/@/lib/prisma dependencies are
 * mocked. Entirely in-process — no network, no real database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mockAuth }));

const { prismaUserFindUnique, prismaWorkspaceFindFirst, prismaAgentProfileFindUnique, prismaAgentProfileUpsert } = vi.hoisted(() => ({
  prismaUserFindUnique: vi.fn(),
  prismaWorkspaceFindFirst: vi.fn(),
  prismaAgentProfileFindUnique: vi.fn(),
  prismaAgentProfileUpsert: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: prismaUserFindUnique },
    workspace: { findFirst: prismaWorkspaceFindFirst },
    agentProfile: { findUnique: prismaAgentProfileFindUnique, upsert: prismaAgentProfileUpsert },
  },
}));

const { hasFeatureMock } = vi.hoisted(() => ({ hasFeatureMock: vi.fn(async () => true) }));
vi.mock('@/services/SubscriptionService', () => ({
  SubscriptionService: { hasFeature: hasFeatureMock },
}));

// Imported AFTER the mocks above, matching this project's own established
// convention (see the sibling /api/ai/agent route.test.ts).
import { GET, PUT } from '../route';

function makeProfilePutRequest(body: unknown): NextRequest {
  return new NextRequest('https://adksy.test/api/ai/agent/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET/PUT /api/ai/agent/profile — orphaned account (no workspaceId on the session)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasFeatureMock.mockResolvedValue(true);
    // A session for a real, authenticated, email-verified user — but with
    // no workspaceId at all, exactly the shape token.workspaceId takes
    // (src/auth.ts's own jwt callback) for an account with no Workspace
    // row, per this session's own provisioning audit.
    mockAuth.mockResolvedValue({ user: { id: 'user-orphan-1', workspaceId: undefined } });
  });

  it('GET returns exactly the documented 403, and never reaches SubscriptionService or any Prisma call', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({ error: 'No workspace found for this account' });
    expect(hasFeatureMock).not.toHaveBeenCalled();
    expect(prismaUserFindUnique).not.toHaveBeenCalled();
    expect(prismaWorkspaceFindFirst).not.toHaveBeenCalled();
    expect(prismaAgentProfileFindUnique).not.toHaveBeenCalled();
  });

  it('PUT returns exactly the documented 403, and never reaches SubscriptionService, input validation, or any Prisma write', async () => {
    const response = await PUT(makeProfilePutRequest({ usageType: 'resell' }));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({ error: 'No workspace found for this account' });
    expect(hasFeatureMock).not.toHaveBeenCalled();
    expect(prismaAgentProfileUpsert).not.toHaveBeenCalled();
  });

  it('a session with a real workspaceId is unaffected by this guard (no regression) — reaches the aiAssistant check and succeeds', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', workspaceId: 'ws-1' } });
    // verifyWorkspaceAccess's own two checks (requireVerifiedEmail, then
    // ownership) must both resolve for this to be a true no-regression
    // proof, not an accidental 403/500 from an under-mocked dependency.
    prismaUserFindUnique.mockResolvedValue({ emailVerified: true });
    prismaWorkspaceFindFirst.mockResolvedValue({ id: 'ws-1' });
    prismaAgentProfileFindUnique.mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, profile: null });
    expect(hasFeatureMock).toHaveBeenCalledWith('ws-1', 'aiAssistant');
  });
});
