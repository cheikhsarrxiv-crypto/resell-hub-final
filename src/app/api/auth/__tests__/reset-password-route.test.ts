/**
 * Integration tests for POST /api/auth/reset-password against a real
 * PostgreSQL database (route + service + rate limiter, nothing mocked).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { POST } from '@/app/api/auth/reset-password/route';
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
      email: `reset-password-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Reset Password Route Test User',
      password: await bcrypt.hash(password, 10),
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function makeRequest(userId: string, body: unknown, ip: string) {
  return new NextRequest(
    `http://localhost/api/auth/reset-password?userId=${encodeURIComponent(userId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }
  );
}

function uniqueIp() {
  return `198.51.100.${Math.floor(Math.random() * 254) + 1}-${Date.now()}-${Math.random()}`;
}

describe.skipIf(!dbAvailable)('POST /api/auth/reset-password — real PostgreSQL', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of createdUserIds.splice(0)) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it('resets the password with a valid token and userId', async () => {
    const user = await createTestUser('original-password-1');
    vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValue({ success: true, messageId: 'mock' });
    const { token } = await PasswordResetService.createResetToken(user.id, user.email);

    const response = await POST(
      makeRequest(user.id, { token, password: 'brand-new-password-1', confirmPassword: 'brand-new-password-1' }, uniqueIp())
    );

    expect(response.status).toBe(200);

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    const newPasswordValid = await bcrypt.compare('brand-new-password-1', updatedUser!.password);
    expect(newPasswordValid).toBe(true);
  });

  it('rejects mismatched password/confirmPassword with 400 (Zod refine)', async () => {
    const user = await createTestUser();
    vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValue({ success: true, messageId: 'mock' });
    const { token } = await PasswordResetService.createResetToken(user.id, user.email);

    const response = await POST(
      makeRequest(user.id, { token, password: 'brand-new-password-1', confirmPassword: 'different-password-1' }, uniqueIp())
    );

    expect(response.status).toBe(400);
  });

  it('rejects a missing userId query param with 400', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': uniqueIp() },
        body: JSON.stringify({ token: 'x', password: 'brand-new-password-1', confirmPassword: 'brand-new-password-1' }),
      })
    );
    expect(response.status).toBe(400);
  });

  it('rejects an invalid token with 400 and a generic message', async () => {
    const user = await createTestUser();
    vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValue({ success: true, messageId: 'mock' });
    await PasswordResetService.createResetToken(user.id, user.email);

    const response = await POST(
      makeRequest(user.id, { token: 'wrong-token', password: 'brand-new-password-1', confirmPassword: 'brand-new-password-1' }, uniqueIp())
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid or expired/i);
  });

  it('rejects reusing an already-consumed token', async () => {
    const user = await createTestUser();
    vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValue({ success: true, messageId: 'mock' });
    const { token } = await PasswordResetService.createResetToken(user.id, user.email);

    const first = await POST(
      makeRequest(user.id, { token, password: 'brand-new-password-1', confirmPassword: 'brand-new-password-1' }, uniqueIp())
    );
    expect(first.status).toBe(200);

    const second = await POST(
      makeRequest(user.id, { token, password: 'another-password-1', confirmPassword: 'another-password-1' }, uniqueIp())
    );
    expect(second.status).toBe(400);
  });

  it('rate limits by IP: allows 10 attempts then blocks the 11th with 429', async () => {
    const user = await createTestUser();
    vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValue({ success: true, messageId: 'mock' });
    const ip = uniqueIp();

    let lastStatus = 0;
    for (let i = 0; i < 10; i++) {
      // Deliberately wrong token each time — only exercising the IP rate
      // limiter, not consuming the real token.
      const res = await POST(
        makeRequest(user.id, { token: `wrong-${i}`, password: 'brand-new-password-1', confirmPassword: 'brand-new-password-1' }, ip)
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(400); // wrong token, but not yet rate limited

    const blocked = await POST(
      makeRequest(user.id, { token: 'wrong-again', password: 'brand-new-password-1', confirmPassword: 'brand-new-password-1' }, ip)
    );
    expect(blocked.status).toBe(429);
  });
});
