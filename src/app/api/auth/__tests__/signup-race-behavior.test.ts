/**
 * ADKSY provisioning audit — signup race fix. POST /api/auth/signup now
 * disambiguates a real P2002 unique-constraint violation on User.email
 * (the losing side of a signup race — see src/lib/auth/provisionUser.ts
 * and provisionUser.test.ts's own concurrency test, which proves this
 * exact outcome for real against a live Postgres connection) from any
 * other P2002, never assuming every P2002 here is the email conflict —
 * matches this project's own established convention (see
 * src/services/ProductService.ts's own meta.target-based check).
 *
 * IMPORTANT — this file does NOT reproduce a real Postgres race. It mocks
 * @/lib/auth/provisionUser directly and calls POST twice, sequentially,
 * with the second mocked call rejecting with a REAL
 * Prisma.PrismaClientKnownRequestError instance (same construction this
 * project already uses in FulfillmentService.test.ts/ListingService's own
 * P2002 tests — a plain Error with bolted-on `code`/`meta` fields is NOT
 * `instanceof Prisma.PrismaClientKnownRequestError` and would silently
 * defeat the route's own `instanceof` check). This only characterizes
 * what the ROUTE does with that outcome — the real concurrent-database
 * proof that exactly one signup ever wins lives in provisionUser.test.ts,
 * run against a real connection when one is available; this file needs
 * none, and never claims otherwise.
 *
 * Same mocking convention as src/app/api/ai/agent/__tests__/route.test.ts
 * (mock the leaf dependencies, import and invoke the real POST export).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const { prismaUserFindUnique } = vi.hoisted(() => ({ prismaUserFindUnique: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: prismaUserFindUnique } },
  default: { user: { findUnique: prismaUserFindUnique } },
}));

const { checkSignupMock, getClientIPMock } = vi.hoisted(() => ({
  checkSignupMock: vi.fn(),
  getClientIPMock: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/ratelimit', () => ({
  rateLimiter: { checkSignup: checkSignupMock },
  RateLimiterService: { getClientIP: getClientIPMock },
}));

const { createVerificationTokenMock } = vi.hoisted(() => ({
  createVerificationTokenMock: vi.fn(),
}));
vi.mock('@/services/EmailVerificationService', () => ({
  EmailVerificationService: { createVerificationToken: createVerificationTokenMock },
}));

const { provisionUserMock } = vi.hoisted(() => ({ provisionUserMock: vi.fn() }));
vi.mock('@/lib/auth/provisionUser', () => ({ provisionUser: provisionUserMock }));

// src/lib/admin.ts imports the REAL @/auth at module scope (for an export
// this route never uses), which pulls in next-auth and fails to resolve
// `next/server` in this Vitest setup — the exact same pre-existing,
// documented limitation src/app/api/auth/__tests__/signup-route.test.ts's
// own header comment describes. Mocked here purely to avoid that import
// chain; isReservedAdminEmail's own real logic is not under test.
vi.mock('@/lib/admin', () => ({ isReservedAdminEmail: () => false }));

// Imported AFTER the mocks above, matching this project's own convention.
import { POST } from '../signup/route';

function makeSignupRequest(): NextRequest {
  return new NextRequest('https://adksy.test/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'race-signup-doc@example.com',
      password: 'a-real-password-123',
      name: 'Race Signup Doc',
      country: 'FR',
    }),
  });
}

describe('POST /api/auth/signup — signup race fix (simulation, not a real Postgres race)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaUserFindUnique.mockResolvedValue(null); // both attempts see "no existing user yet" — the real race window
    checkSignupMock.mockResolvedValue({ success: true, resetAt: new Date(Date.now() + 1000) });
    createVerificationTokenMock.mockResolvedValue({ success: true });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('the winning attempt gets 201; the losing attempt (real PrismaClientKnownRequestError P2002 on email) now gets a clean 400 "User already exists", never a 500', async () => {
    provisionUserMock.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'race-signup-doc@example.com', name: 'Race Signup Doc', country: 'FR' },
      workspace: { id: 'ws-1', name: "Race Signup Doc's Workspace", slug: 'race-signup-doc' },
    });

    const winnerResponse = await POST(makeSignupRequest());
    const winnerData = await winnerResponse.json();
    expect(winnerResponse.status).toBe(201);
    expect(winnerData.success).toBe(true);

    // A REAL Prisma.PrismaClientKnownRequestError instance (same
    // construction already used elsewhere in this project — see
    // FulfillmentService.test.ts's own helper) — a plain Error with
    // bolted-on fields would NOT be `instanceof
    // Prisma.PrismaClientKnownRequestError` and would defeat the route's
    // own check. Shape matches the real User_email_key constraint
    // (prisma/migrations/20260824064349_init/migration.sql:392) — a
    // stand-in for the outcome provisionUser.test.ts already proves for
    // real, not a new real-database event.
    const emailConflictError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['email'] },
    });
    provisionUserMock.mockRejectedValueOnce(emailConflictError);

    const loserResponse = await POST(makeSignupRequest());
    const loserData = await loserResponse.json();

    expect(loserResponse.status).toBe(400);
    expect(loserData).toEqual({ error: 'User already exists' });
    // The fixed branch returns before ever reaching the generic
    // console.error/500 path — never silently swallowed either.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('a P2002 on a different field is never misclassified as the email conflict — still a generic 500, exactly as before this fix', async () => {
    // Deliberately a field other than "email" — proves the route's check
    // is genuinely target-based, never "any P2002 means email conflict".
    const otherFieldConflictError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`slug`)', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['slug'] },
    });
    provisionUserMock.mockRejectedValueOnce(otherFieldConflictError);

    const response = await POST(makeSignupRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Internal server error' });
    expect(consoleErrorSpy).toHaveBeenCalledWith('Signup error:', otherFieldConflictError);
  });

  it('a non-Prisma error (e.g. a real unexpected failure) is still a generic 500, unaffected by this fix', async () => {
    const unexpectedError = new Error('database connection lost');
    provisionUserMock.mockRejectedValueOnce(unexpectedError);

    const response = await POST(makeSignupRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Internal server error' });
    expect(consoleErrorSpy).toHaveBeenCalledWith('Signup error:', unexpectedError);
  });
});
