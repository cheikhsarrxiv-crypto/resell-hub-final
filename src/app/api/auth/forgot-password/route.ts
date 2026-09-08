import { NextRequest, NextResponse } from 'next/server';
import { resetPasswordSchema } from '@/lib/validations';
import prisma from '@/lib/prisma';
import { rateLimiter, RateLimiterService } from '@/lib/ratelimit';
import { PasswordResetService } from '@/services/PasswordResetService';

// Identical response whether or not the email is a registered account —
// never let this endpoint reveal account existence.
const GENERIC_RESPONSE = {
  message:
    "If an account exists with this email address, we've sent a password reset link.",
};

/**
 * POST /api/auth/forgot-password
 * Request a password reset link.
 *
 * Public route (no auth required — the whole point is the user can't
 * log in). Rate limited by IP and by email to slow both enumeration and
 * abuse. Always returns the same generic response.
 */
export async function POST(request: NextRequest) {
  try {
    const clientIP = RateLimiterService.getClientIP(request);
    const ipLimit = await rateLimiter.checkForgotPasswordIP(clientIP);

    if (!ipLimit.success) {
      return NextResponse.json(
        {
          error: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil((ipLimit.resetAt.getTime() - Date.now()) / 1000),
        },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil((ipLimit.resetAt.getTime() - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    const data = await request.json();
    const result = resetPasswordSchema.safeParse(data);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.errors },
        { status: 400 }
      );
    }

    const email = result.data.email;

    const emailLimit = await rateLimiter.checkForgotPasswordEmail(email);
    if (!emailLimit.success) {
      // Same generic response even when rate limited by email — a 429
      // here would confirm the email is registered (only registered
      // emails could ever accumulate the count checkForgotPasswordEmail
      // tracks in practice, since we only reach here after this branch
      // regardless of whether the account exists — so instead we just
      // silently stop without sending, rather than answering 429).
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, deletedAt: true },
    });

    if (user && !user.deletedAt) {
      // Best-effort — never let a failure here change the response.
      await PasswordResetService.createResetToken(user.id, user.email);
    }

    return NextResponse.json(GENERIC_RESPONSE);
  } catch (error) {
    console.error('[Forgot Password] Error:', error);
    // Still generic — an internal error must not leak account existence
    // or any other detail.
    return NextResponse.json(GENERIC_RESPONSE);
  }
}
