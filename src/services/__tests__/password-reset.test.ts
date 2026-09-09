/**
 * Tests for password reset: token lifecycle, actual email dispatch, and
 * successful/failed reset outcomes — against a real PostgreSQL database
 * (no mocked DB), mirroring email-verification.test.ts's convention.
 * EmailService.sendPasswordResetEmail is spied on rather than asserting
 * real third-party delivery (EMAIL_PROVIDER is unset/'none' here).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PasswordResetService } from '@/services/PasswordResetService';
import { EmailService } from '@/services/EmailService';

const prisma = new PrismaClient();

let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

const createdUserIds: string[] = [];

async function createTestUser(password = 'original-password-1') {
  const user = await prisma.user.create({
    data: {
      email: `password-reset-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Password Reset Test User',
      password: await bcrypt.hash(password, 10),
    },
  });
  createdUserIds.push(user.id);
  return user;
}

describe.skipIf(!dbAvailable)('PasswordResetService — real PostgreSQL', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of createdUserIds.splice(0)) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it('generateToken produces distinct, sufficiently random tokens', () => {
    const a = PasswordResetService.generateToken();
    const b = PasswordResetService.generateToken();
    expect(a).not.toBe(b);
    // crypto.randomBytes(32).toString('hex') => 64 hex chars
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates a SHA-256-hashed token with ~1h expiry, never storing the raw token', async () => {
    const user = await createTestUser();

    const result = await PasswordResetService.createResetToken(user.id, user.email);
    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();

    const stored = await prisma.passwordResetToken.findUnique({ where: { userId: user.id } });
    expect(stored).not.toBeNull();
    expect(stored!.hashedToken).toBe(
      crypto.createHash('sha256').update(result.token!).digest('hex')
    );
    expect(stored!.hashedToken).not.toBe(result.token);

    const expiryMs = stored!.expiresAt.getTime() - Date.now();
    expect(expiryMs).toBeGreaterThan(59 * 60 * 1000);
    expect(expiryMs).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('calls EmailService.sendPasswordResetEmail with the recipient and a link containing the token', async () => {
    const user = await createTestUser();
    const sendSpy = vi.spyOn(EmailService, 'sendPasswordResetEmail');

    const result = await PasswordResetService.createResetToken(user.id, user.email);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [toEmail, resetUrl] = sendSpy.mock.calls[0] as [string, string];
    expect(toEmail).toBe(user.email);
    expect(resetUrl).toContain(`token=${result.token}`);
    expect(resetUrl).toContain(`userId=${user.id}`);
  });

  it('a new request invalidates the previous token (upsert overwrites the same row)', async () => {
    const user = await createTestUser();

    const first = await PasswordResetService.createResetToken(user.id, user.email);
    const afterFirst = await prisma.passwordResetToken.findUnique({ where: { userId: user.id } });

    const second = await PasswordResetService.createResetToken(user.id, user.email);
    const afterSecond = await prisma.passwordResetToken.findUnique({ where: { userId: user.id } });

    expect(afterSecond!.id).toBe(afterFirst!.id);
    expect(afterSecond!.hashedToken).not.toBe(afterFirst!.hashedToken);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);

    // The old (first) token must no longer work; only the new one does.
    const oldTokenAttempt = await PasswordResetService.resetPassword(
      user.id,
      first.token!,
      'new-password-1234'
    );
    expect(oldTokenAttempt.success).toBe(false);

    const newTokenAttempt = await PasswordResetService.resetPassword(
      user.id,
      second.token!,
      'new-password-1234'
    );
    expect(newTokenAttempt.success).toBe(true);
  });

  it('resets successfully with the correct token: password changes, passwordChangedAt is stamped, token is deleted', async () => {
    const user = await createTestUser('original-password-1');
    const { token } = await PasswordResetService.createResetToken(user.id, user.email);

    const before = Date.now();
    const result = await PasswordResetService.resetPassword(user.id, token!, 'brand-new-password-1');
    expect(result.success).toBe(true);

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser!.passwordChangedAt).not.toBeNull();
    expect(updatedUser!.passwordChangedAt!.getTime()).toBeGreaterThanOrEqual(before);

    const remainingToken = await prisma.passwordResetToken.findUnique({ where: { userId: user.id } });
    expect(remainingToken).toBeNull();
  });

  it('the old password no longer works after a successful reset', async () => {
    const user = await createTestUser('original-password-1');
    const { token } = await PasswordResetService.createResetToken(user.id, user.email);
    await PasswordResetService.resetPassword(user.id, token!, 'brand-new-password-1');

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    const oldPasswordStillValid = await bcrypt.compare('original-password-1', updatedUser!.password);
    expect(oldPasswordStillValid).toBe(false);
  });

  it('the new password works after a successful reset', async () => {
    const user = await createTestUser('original-password-1');
    const { token } = await PasswordResetService.createResetToken(user.id, user.email);
    await PasswordResetService.resetPassword(user.id, token!, 'brand-new-password-1');

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    const newPasswordValid = await bcrypt.compare('brand-new-password-1', updatedUser!.password);
    expect(newPasswordValid).toBe(true);
  });

  it('rejects an invalid token and leaves the password unchanged', async () => {
    const user = await createTestUser('original-password-1');
    await PasswordResetService.createResetToken(user.id, user.email);

    const result = await PasswordResetService.resetPassword(user.id, 'wrong-token-value', 'brand-new-password-1');
    expect(result.success).toBe(false);

    const stillUser = await prisma.user.findUnique({ where: { id: user.id } });
    const oldPasswordValid = await bcrypt.compare('original-password-1', stillUser!.password);
    expect(oldPasswordValid).toBe(true);
  });

  it('rejects a wrong userId (no matching token row) without leaking whether the token itself was valid', async () => {
    const user = await createTestUser();
    const { token } = await PasswordResetService.createResetToken(user.id, user.email);

    const result = await PasswordResetService.resetPassword('does-not-exist-user-id', token!, 'brand-new-password-1');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Invalid or expired reset link');
  });

  it('rejects an expired token, deletes it, and leaves the password unchanged', async () => {
    const user = await createTestUser('original-password-1');
    const { token } = await PasswordResetService.createResetToken(user.id, user.email);

    await prisma.passwordResetToken.update({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await PasswordResetService.resetPassword(user.id, token!, 'brand-new-password-1');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invalid or expired/i);

    const remainingToken = await prisma.passwordResetToken.findUnique({ where: { userId: user.id } });
    expect(remainingToken).toBeNull();

    const stillUser = await prisma.user.findUnique({ where: { id: user.id } });
    const oldPasswordValid = await bcrypt.compare('original-password-1', stillUser!.password);
    expect(oldPasswordValid).toBe(true);
  });

  it('rejects reusing an already-consumed token (single-use)', async () => {
    const user = await createTestUser('original-password-1');
    const { token } = await PasswordResetService.createResetToken(user.id, user.email);

    const first = await PasswordResetService.resetPassword(user.id, token!, 'brand-new-password-1');
    expect(first.success).toBe(true);

    const second = await PasswordResetService.resetPassword(user.id, token!, 'yet-another-password-1');
    expect(second.success).toBe(false);

    // Password stays what the first (successful) reset set it to.
    const finalUser = await prisma.user.findUnique({ where: { id: user.id } });
    const firstPasswordStillValid = await bcrypt.compare('brand-new-password-1', finalUser!.password);
    expect(firstPasswordStillValid).toBe(true);
  });
});
