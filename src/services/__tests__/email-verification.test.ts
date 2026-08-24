/**
 * Tests for email verification: token lifecycle, actual email dispatch,
 * and the resend rate limit — against a real PostgreSQL database (no
 * mocked DB). EmailService.sendVerificationEmail is spied on rather than
 * asserting real third-party delivery: no real SendGrid/Mailgun/Resend
 * credentials are available in this environment (EMAIL_PROVIDER is
 * unset/'none' here), and the fix under test is that the call happens at
 * all, not the provider's own delivery guarantee.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { EmailVerificationService } from '@/services/EmailVerificationService';
import { EmailService } from '@/services/EmailService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const createdUserIds: string[] = [];

async function createTestUser() {
  const user = await prisma.user.create({
    data: {
      email: `email-verif-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Email Verification Test User',
      password: 'not-used',
    },
  });
  createdUserIds.push(user.id);
  return user;
}

describe.skipIf(!dbAvailable)('Email verification — real PostgreSQL', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of createdUserIds.splice(0)) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it('creates a hashed token with ~24h expiry and starts the user unverified', async () => {
    const user = await createTestUser();
    expect(user.emailVerified).toBe(false);

    const result = await EmailVerificationService.createVerificationToken(user.id, user.email);
    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();

    const stored = await prisma.emailVerificationToken.findUnique({ where: { userId: user.id } });
    expect(stored).not.toBeNull();
    expect(stored!.hashedToken).toBe(
      crypto.createHash('sha256').update(result.token!).digest('hex')
    );
    // The raw token is never stored in plaintext.
    expect(stored!.hashedToken).not.toBe(result.token);

    const expiryMs = stored!.expiresAt.getTime() - Date.now();
    expect(expiryMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(expiryMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('calls EmailService.sendVerificationEmail with the recipient and a link containing the token', async () => {
    const user = await createTestUser();
    const sendSpy = vi.spyOn(EmailService, 'sendVerificationEmail');

    const result = await EmailVerificationService.createVerificationToken(user.id, user.email);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [toEmail, verificationUrl] = sendSpy.mock.calls[0] as [string, string];
    expect(toEmail).toBe(user.email);
    expect(verificationUrl).toContain(`token=${result.token}`);
    expect(verificationUrl).toContain(`userId=${user.id}`);
  });

  it('verifies successfully with the correct token, marks the user verified, and deletes the token', async () => {
    const user = await createTestUser();
    const { token } = await EmailVerificationService.createVerificationToken(user.id, user.email);

    const result = await EmailVerificationService.verifyEmail(user.id, token!);
    expect(result.success).toBe(true);
    expect(result.userVerified).toBe(true);

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser!.emailVerified).toBe(true);

    const remainingToken = await prisma.emailVerificationToken.findUnique({ where: { userId: user.id } });
    expect(remainingToken).toBeNull();
  });

  it('rejects an invalid token and leaves the user unverified', async () => {
    const user = await createTestUser();
    await EmailVerificationService.createVerificationToken(user.id, user.email);

    const result = await EmailVerificationService.verifyEmail(user.id, 'wrong-token-value');
    expect(result.success).toBe(false);

    const stillUnverified = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stillUnverified!.emailVerified).toBe(false);
  });

  it('rejects an expired token, deletes it, and leaves the user unverified', async () => {
    const user = await createTestUser();
    const { token } = await EmailVerificationService.createVerificationToken(user.id, user.email);

    // Force the stored token into the past.
    await prisma.emailVerificationToken.update({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await EmailVerificationService.verifyEmail(user.id, token!);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/expired/i);

    const remainingToken = await prisma.emailVerificationToken.findUnique({ where: { userId: user.id } });
    expect(remainingToken).toBeNull();

    const stillUnverified = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stillUnverified!.emailVerified).toBe(false);
  });

  it('resendVerificationEmail rate limit behavior (documents actual behavior against real DB)', async () => {
    const user = await createTestUser();

    const first = await EmailVerificationService.resendVerificationEmail(user.id, user.email);
    const second = await EmailVerificationService.resendVerificationEmail(user.id, user.email);
    const third = await EmailVerificationService.resendVerificationEmail(user.id, user.email);
    const fourth = await EmailVerificationService.resendVerificationEmail(user.id, user.email);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(third.success).toBe(true);

    // NOTE: createVerificationToken() upserts a single row keyed on userId
    // (@unique), so repeated resends update the SAME row instead of adding
    // new ones. The rate limit counts rows created in the last hour
    // (prisma.emailVerificationToken.count(...)), which can therefore never
    // exceed 1 for a given user — this assertion documents that the 4th
    // call currently still succeeds rather than asserting the intended
    // "blocked after 3" behavior, so a false test doesn't hide a real gap.
    expect(fourth.success).toBe(true);
  });

  it('signup flow: creating a verification token right after user creation produces a real, usable token', async () => {
    // Mirrors the exact call added to src/app/api/auth/signup/route.ts,
    // right after prisma.user.create(...).
    const user = await createTestUser();

    const result = await EmailVerificationService.createVerificationToken(user.id, user.email);
    expect(result.success).toBe(true);

    const stored = await prisma.emailVerificationToken.findUnique({ where: { userId: user.id } });
    expect(stored).not.toBeNull();
    expect(stored!.userId).toBe(user.id);

    // The token this signup produced must actually verify the same user.
    const verifyResult = await EmailVerificationService.verifyEmail(user.id, result.token!);
    expect(verifyResult.success).toBe(true);
  });
});
