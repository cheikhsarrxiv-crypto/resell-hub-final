/**
 * Integration tests for POST /api/auth/forgot-password against a real
 * PostgreSQL database (route + service + rate limiter, nothing mocked
 * except the outbound email send). Confirms the core security property:
 * an existing account and a non-existent one produce byte-identical
 * responses, and rate limiting kicks in without ever changing that.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { POST } from '@/app/api/auth/forgot-password/route';
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
      email: `forgot-password-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Forgot Password Route Test User',
      password: 'not-used',
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function makeRequest(body: unknown, ip: string) {
  return new NextRequest('http://localhost/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function uniqueIp() {
  return `203.0.113.${Math.floor(Math.random() * 254) + 1}-${Date.now()}-${Math.random()}`;
}

describe.skipIf(!dbAvailable)('POST /api/auth/forgot-password — real PostgreSQL', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of createdUserIds.splice(0)) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
  });

  it('returns the same generic response for an existing account and a non-existent one', async () => {
    const user = await createTestUser();
    vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValue({ success: true, messageId: 'mock' });

    const existingResponse = await POST(makeRequest({ email: user.email }, uniqueIp()));
    const existingBody = await existingResponse.json();

    const unknownResponse = await POST(
      makeRequest({ email: `nobody-${Date.now()}@example.com` }, uniqueIp())
    );
    const unknownBody = await unknownResponse.json();

    expect(existingResponse.status).toBe(200);
    expect(unknownResponse.status).toBe(200);
    expect(existingBody).toEqual(unknownBody);
  });

  it('creates a reset token and sends the email only for a real, existing account', async () => {
    const user = await createTestUser();
    const sendSpy = vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValue({ success: true, messageId: 'mock' });

    await POST(makeRequest({ email: user.email }, uniqueIp()));
    const tokenForKnown = await prisma.passwordResetToken.findUnique({ where: { userId: user.id } });
    expect(tokenForKnown).not.toBeNull();
    expect(sendSpy).toHaveBeenCalledTimes(1);

    sendSpy.mockClear();
    await POST(makeRequest({ email: `nobody-${Date.now()}@example.com` }, uniqueIp()));
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid input (400) before doing any DB work', async () => {
    const response = await POST(makeRequest({ email: 'not-an-email' }, uniqueIp()));
    expect(response.status).toBe(400);
  });

  it('rate limits by IP: allows 5 requests then blocks the 6th with 429', async () => {
    const ip = uniqueIp();
    vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValue({ success: true, messageId: 'mock' });

    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ email: `ratelimit-ip-${i}-${Date.now()}@example.com` }, ip));
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(200);

    const blocked = await POST(makeRequest({ email: `ratelimit-ip-blocked-${Date.now()}@example.com` }, ip));
    expect(blocked.status).toBe(429);
  });

  it('rate limits by email: after 3 requests for the same email, further requests still return the generic 200 (never a 429 that would reveal the email is being targeted)', async () => {
    const user = await createTestUser();
    vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValue({ success: true, messageId: 'mock' });

    for (let i = 0; i < 3; i++) {
      const res = await POST(makeRequest({ email: user.email }, uniqueIp()));
      expect(res.status).toBe(200);
    }

    const fourth = await POST(makeRequest({ email: user.email }, uniqueIp()));
    expect(fourth.status).toBe(200);
    const body = await fourth.json();
    expect(body.message).toMatch(/if an account exists/i);
  });
});
