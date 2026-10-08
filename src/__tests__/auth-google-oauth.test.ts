/**
 * Google OAuth chantier — real behavioral tests of src/auth.ts's new
 * `signIn` callback, the Google-aware branch of the `jwt` callback, and
 * Credentials `authorize()`'s null-password handling.
 *
 * src/auth.ts cannot be imported live under this Vitest config (next-auth
 * pulls in next/server, which fails to resolve here — same pre-existing
 * issue documented in auth-session-invalidation.test.ts). Exactly that
 * file's technique is reused: next-auth, both providers, bcryptjs,
 * @/lib/prisma, @/auth.config, @/lib/auth/provisionUser and @/lib/admin
 * are all mockable at the module boundary, which lets the REAL
 * authConfig.callbacks.signIn/jwt functions and the REAL
 * Credentials.authorize() function run against fake dependencies — a
 * genuine behavioral test, not a string check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const provisionUserMock = vi.fn();
const isReservedAdminEmailMock = vi.fn();
const bcryptCompareMock = vi.fn();
const safeParseMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: findUniqueMock },
    workspace: { findFirst: findFirstMock },
  },
}));

vi.mock('next-auth', () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
}));

vi.mock('next-auth/providers/credentials', () => ({
  default: (config: unknown) => config,
}));

vi.mock('next-auth/providers/google', () => ({
  default: (config: unknown) => config,
}));

vi.mock('bcryptjs', () => ({
  default: { compare: bcryptCompareMock, hash: vi.fn() },
}));

vi.mock('@/lib/validations', () => ({
  loginSchema: { safeParse: safeParseMock },
}));

vi.mock('@/lib/auth/provisionUser', () => ({
  provisionUser: provisionUserMock,
}));

vi.mock('@/lib/admin', () => ({
  isReservedAdminEmail: isReservedAdminEmailMock,
}));

vi.mock('@/auth.config', () => ({
  authConfig: {
    session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
    pages: { signIn: '/login', error: '/auth/error' },
    providers: [],
    callbacks: {
      session: vi.fn(({ session }: any) => session),
      redirect: vi.fn(),
    },
  },
}));

describe('src/auth.ts — Google provider present, Credentials unchanged', () => {
  it('registers exactly two providers: Credentials (with authorize) and Google (with the env-var client id/secret)', async () => {
    const { authConfig } = await import('@/auth');
    expect(authConfig.providers).toHaveLength(2);

    const [credentialsProvider, googleProvider] = authConfig.providers as any[];
    expect(typeof credentialsProvider.authorize).toBe('function');
    expect(googleProvider).toHaveProperty('clientId');
    expect(googleProvider).toHaveProperty('clientSecret');
  });
});

describe('src/auth.ts — Credentials authorize() — null-password accounts (Google-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeParseMock.mockReturnValue({ success: true, data: { email: 'user@example.com', password: 'whatever123' } });
  });

  it('a Google-only account (password: null) returns null and NEVER calls bcrypt.compare', async () => {
    const { authConfig } = await import('@/auth');
    const [credentialsProvider] = authConfig.providers as any[];

    findUniqueMock.mockResolvedValue({ id: 'u1', email: 'user@example.com', password: null, name: 'U' });

    const result = await credentialsProvider.authorize({ email: 'user@example.com', password: 'whatever123' });

    expect(result).toBeNull();
    expect(bcryptCompareMock).not.toHaveBeenCalled();
  });

  it('a normal account with a real password hash still authorizes exactly as before', async () => {
    const { authConfig } = await import('@/auth');
    const [credentialsProvider] = authConfig.providers as any[];

    findUniqueMock.mockResolvedValue({ id: 'u1', email: 'user@example.com', password: '$2a$10$hash', name: 'U' });
    bcryptCompareMock.mockResolvedValue(true);

    const result = await credentialsProvider.authorize({ email: 'user@example.com', password: 'whatever123' });

    expect(bcryptCompareMock).toHaveBeenCalledWith('whatever123', '$2a$10$hash');
    expect(result).toEqual({ id: 'u1', email: 'user@example.com', name: 'U' });
  });

  it('a wrong password on a normal account still returns null', async () => {
    const { authConfig } = await import('@/auth');
    const [credentialsProvider] = authConfig.providers as any[];

    findUniqueMock.mockResolvedValue({ id: 'u1', email: 'user@example.com', password: '$2a$10$hash', name: 'U' });
    bcryptCompareMock.mockResolvedValue(false);

    const result = await credentialsProvider.authorize({ email: 'user@example.com', password: 'wrong' });
    expect(result).toBeNull();
  });
});

describe('src/auth.ts — signIn callback — Google branch only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isReservedAdminEmailMock.mockReturnValue(false);
  });

  it('non-Google providers are never touched by this callback — returns true immediately, no DB calls', async () => {
    const { authConfig } = await import('@/auth');
    const user: any = { id: 'u1', email: 'user@example.com' };

    const result = await authConfig.callbacks!.signIn!({
      user,
      account: { provider: 'credentials', type: 'credentials' } as any,
      profile: undefined,
    } as any);

    expect(result).toBe(true);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(provisionUserMock).not.toHaveBeenCalled();
  });

  it('refuses a Google sign-in whose email is not verified — no user created, no user looked up', async () => {
    const { authConfig } = await import('@/auth');
    const user: any = { id: 'google-sub-1', email: 'new@example.com' };

    const result = await authConfig.callbacks!.signIn!({
      user,
      account: { provider: 'google', type: 'oidc' } as any,
      profile: { email: 'new@example.com', email_verified: false, name: 'New Person' } as any,
    } as any);

    expect(result).toBe(false);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(provisionUserMock).not.toHaveBeenCalled();
  });

  it('refuses a Google sign-in with no email at all on the profile', async () => {
    const { authConfig } = await import('@/auth');
    const user: any = { id: 'google-sub-1' };

    const result = await authConfig.callbacks!.signIn!({
      user,
      account: { provider: 'google', type: 'oidc' } as any,
      profile: { email_verified: true } as any,
    } as any);

    expect(result).toBe(false);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('refuses a Google sign-in for a reserved admin email — no user created', async () => {
    const { authConfig } = await import('@/auth');
    isReservedAdminEmailMock.mockReturnValue(true);
    const user: any = { id: 'google-sub-1', email: 'admin@example.com' };

    const result = await authConfig.callbacks!.signIn!({
      user,
      account: { provider: 'google', type: 'oidc' } as any,
      profile: { email: 'admin@example.com', email_verified: true, name: 'Admin' } as any,
    } as any);

    expect(result).toBe(false);
    expect(provisionUserMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('new Google user (no existing account with this email): provisions via provisionUser with password:null, preVerifiedEmail:true, and never touches an existing row', async () => {
    const { authConfig } = await import('@/auth');
    findUniqueMock.mockResolvedValue(null);
    provisionUserMock.mockResolvedValue({
      user: { id: 'new-user-id', email: 'new@example.com', name: 'New Person', country: 'FR' },
      workspace: { id: 'ws-1', name: "New Person's Workspace", slug: 'new' },
    });
    const user: any = { id: 'google-sub-1', email: 'new@example.com' };

    const result = await authConfig.callbacks!.signIn!({
      user,
      account: { provider: 'google', type: 'oidc' } as any,
      profile: { email: 'new@example.com', email_verified: true, name: 'New Person' } as any,
    } as any);

    expect(result).toBe(true);
    expect(provisionUserMock).toHaveBeenCalledWith({
      email: 'new@example.com',
      name: 'New Person',
      password: null,
      preVerifiedEmail: true,
    });
    // The user object NextAuth carries forward now points at the real DB id.
    expect(user.id).toBe('new-user-id');
  });

  it('falls back to the email local part when Google provides no name', async () => {
    const { authConfig } = await import('@/auth');
    findUniqueMock.mockResolvedValue(null);
    provisionUserMock.mockResolvedValue({
      user: { id: 'new-user-id', email: 'noname@example.com', name: 'noname', country: 'FR' },
      workspace: { id: 'ws-1', name: "noname's Workspace", slug: 'noname' },
    });
    const user: any = { id: 'google-sub-2', email: 'noname@example.com' };

    await authConfig.callbacks!.signIn!({
      user,
      account: { provider: 'google', type: 'oidc' } as any,
      profile: { email: 'noname@example.com', email_verified: true } as any,
    } as any);

    expect(provisionUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'noname' })
    );
  });

  it('existing Google-only user returning to sign in: reuses the User.id, never calls provisionUser again (no duplicate Subscription/Workspace/User)', async () => {
    const { authConfig } = await import('@/auth');
    findUniqueMock.mockResolvedValue({ id: 'existing-google-user' });
    const user: any = { id: 'google-sub-1', email: 'returning@example.com' };

    const result = await authConfig.callbacks!.signIn!({
      user,
      account: { provider: 'google', type: 'oidc' } as any,
      profile: { email: 'returning@example.com', email_verified: true, name: 'Returning' } as any,
    } as any);

    expect(result).toBe(true);
    expect(provisionUserMock).not.toHaveBeenCalled();
    expect(user.id).toBe('existing-google-user');
  });

  it('CRITICAL: a Credentials account signing in via Google with the same verified email links to the SAME User.id — password/workspace/subscription are never touched, no duplicate is ever created', async () => {
    const { authConfig } = await import('@/auth');
    // This existing row represents a Credentials account: it has a real
    // password hash in the real DB — this callback only ever selects
    // `id`, so it is structurally incapable of reading or overwriting it.
    findUniqueMock.mockResolvedValue({ id: 'credentials-user-id' });
    const user: any = { id: 'google-sub-99', email: 'user@example.com' };

    const result = await authConfig.callbacks!.signIn!({
      user,
      account: { provider: 'google', type: 'oidc' } as any,
      profile: { email: 'user@example.com', email_verified: true, name: 'User' } as any,
    } as any);

    expect(result).toBe(true);
    // Looked up by email only, never wrote anything.
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      select: { id: true },
    });
    expect(provisionUserMock).not.toHaveBeenCalled();
    // Same canonical id as the Credentials account — no second User row.
    expect(user.id).toBe('credentials-user-id');
  });
});

describe('src/auth.ts — jwt callback — Google-aware id resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Credentials fresh sign-in (no account, or account.provider !== google): uses user.id as-is, no extra lookup — unchanged from before this chantier', async () => {
    const { authConfig } = await import('@/auth');
    findFirstMock.mockResolvedValue({ id: 'workspace-1' });

    const result = (await authConfig.callbacks!.jwt!({
      token: {},
      user: { id: 'user-1', email: 'user@example.com', name: 'User One' },
      account: { provider: 'credentials', type: 'credentials' },
    } as any))!;

    expect(result.id).toBe('user-1');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('Google fresh sign-in: re-resolves the canonical User.id by email instead of trusting the Google account.providerAccountId', async () => {
    const { authConfig } = await import('@/auth');
    // The signIn callback already mutated user.id to the resolved DB id
    // in a real run; this test deliberately leaves user.id as the raw
    // Google subject to prove jwt's own re-lookup is what actually
    // guarantees correctness, not an assumption that the mutation
    // survived.
    findUniqueMock.mockResolvedValue({ id: 'canonical-db-id' });
    findFirstMock.mockResolvedValue({ id: 'workspace-1' });

    const result = (await authConfig.callbacks!.jwt!({
      token: {},
      user: { id: 'google-raw-subject', email: 'user@example.com', name: 'User' },
      account: { provider: 'google', type: 'oidc' },
    } as any))!;

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      select: { id: true },
    });
    expect(result.id).toBe('canonical-db-id');
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'canonical-db-id' } })
    );
  });
});
