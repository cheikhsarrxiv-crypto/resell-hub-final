/**
 * Tests for the JWT session-invalidation mechanism added to src/auth.ts's
 * `jwt` callback: after a password change, User.passwordChangedAt is
 * stamped, and any already-issued JWT (which carries an explicit
 * token.tokenIssuedAt claim from sign-in) is invalidated the next time it
 * is decoded, by comparing the two timestamps.
 *
 * src/auth.ts cannot be imported live under this Vitest config — next-auth
 * itself pulls in `next/server`, which fails to resolve here (the same
 * pre-existing environment issue documented in
 * auth-login-ratelimit.test.ts and marketplace/oauth-callback-security.test.ts).
 * Unlike those files (which fall back to source-string assertions only),
 * next-auth, its Credentials provider, bcryptjs, @/lib/prisma and
 * @/auth.config are all mockable at the module boundary here, which lets
 * the *real* callbacks.jwt function from src/auth.ts run against a fake
 * Prisma client — a genuine behavioral test of the invalidation logic,
 * not just a string check that it's present.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();

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

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(), hash: vi.fn() },
}));

vi.mock('@/lib/validations', () => ({
  loginSchema: { safeParse: vi.fn() },
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

describe('src/auth.ts jwt callback — session invalidation via passwordChangedAt', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    findFirstMock.mockReset();
  });

  it('stamps token.tokenIssuedAt and populates id/email/name/workspaceId on fresh sign-in', async () => {
    const { authConfig } = await import('@/auth');
    findFirstMock.mockResolvedValue({ id: 'workspace-1' });

    const before = Date.now();
    const result = (await authConfig.callbacks!.jwt!({
      token: {},
      user: { id: 'user-1', email: 'user@example.com', name: 'User One' },
    } as any))!;

    expect(result.id).toBe('user-1');
    expect(result.email).toBe('user@example.com');
    expect(result.name).toBe('User One');
    expect(result.workspaceId).toBe('workspace-1');
    expect(typeof result.tokenIssuedAt).toBe('number');
    expect(result.tokenIssuedAt).toBeGreaterThanOrEqual(before);
    // Fresh sign-in must not touch the re-validation lookup.
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('leaves a normal, unchanged session token intact (passwordChangedAt is null)', async () => {
    const { authConfig } = await import('@/auth');
    findUniqueMock.mockResolvedValue({ passwordChangedAt: null });

    const existingToken = {
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      workspaceId: 'workspace-1',
      tokenIssuedAt: Date.now() - 1000,
    };

    const result = await authConfig.callbacks!.jwt!({ token: existingToken, user: undefined } as any);

    expect(result).toEqual(existingToken);
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { passwordChangedAt: true },
    });
  });

  it('invalidates a token issued before a subsequent password change', async () => {
    const { authConfig } = await import('@/auth');
    const tokenIssuedAt = Date.now() - 60_000;
    findUniqueMock.mockResolvedValue({ passwordChangedAt: new Date(tokenIssuedAt + 30_000) });

    const existingToken = {
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      workspaceId: 'workspace-1',
      tokenIssuedAt,
    };

    const result = await authConfig.callbacks!.jwt!({ token: existingToken, user: undefined } as any);

    // Stripped to an empty token — no id/email/name/workspaceId survive,
    // so the (unmodified) session callback will produce
    // session.user.id === undefined, which every `!session?.user?.id`
    // guard in the app already treats as unauthenticated.
    expect(result).toEqual({});
  });

  it('invalidates a pre-existing token that has no tokenIssuedAt claim at all, once any password change happens', async () => {
    const { authConfig } = await import('@/auth');
    findUniqueMock.mockResolvedValue({ passwordChangedAt: new Date() });

    // A token issued before this feature existed carries no
    // tokenIssuedAt claim — must not be treated as always-valid.
    const legacyToken = {
      id: 'user-1',
      email: 'user@example.com',
      name: 'User One',
    };

    const result = await authConfig.callbacks!.jwt!({ token: legacyToken, user: undefined } as any);
    expect(result).toEqual({});
  });

  it('does not re-validate (or query the DB) once a token has already been stripped to empty', async () => {
    const { authConfig } = await import('@/auth');

    const result = await authConfig.callbacks!.jwt!({ token: {}, user: undefined } as any);

    expect(result).toEqual({});
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('does not touch email verification: verifyEmail-owned tables/fields are never referenced by the jwt callback', async () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/auth.ts'), 'utf-8');
    expect(source).not.toContain('emailVerificationToken');
    expect(source).not.toContain('emailVerified');
  });
});
