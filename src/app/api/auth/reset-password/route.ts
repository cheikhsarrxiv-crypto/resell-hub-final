import { NextRequest, NextResponse } from 'next/server';
import { resetPasswordWithTokenSchema } from '@/lib/validations';
import { rateLimiter, RateLimiterService } from '@/lib/ratelimit';
import { PasswordResetService } from '@/services/PasswordResetService';

/**
 * POST /api/auth/reset-password?userId=...
 * Body: { token, password, confirmPassword }
 *
 * Public route (the user is, by definition, not logged in). Rate limited
 * by IP. The userId comes from the emailed link's query param, mirroring
 * the existing /api/email/verify pattern — the token itself remains the
 * actual secret being validated.
 */
export async function POST(request: NextRequest) {
  try {
    const clientIP = RateLimiterService.getClientIP(request);
    const ipLimit = await rateLimiter.checkResetPasswordIP(clientIP);

    if (!ipLimit.success) {
      return NextResponse.json(
        {
          error: 'Too many attempts. Please try again later.',
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

    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    const data = await request.json();
    const result = resetPasswordWithTokenSchema.safeParse(data);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.errors },
        { status: 400 }
      );
    }

    const { token, password } = result.data;

    const resetResult = await PasswordResetService.resetPassword(userId, token, password);

    if (!resetResult.success) {
      return NextResponse.json({ error: resetResult.message }, { status: 400 });
    }

    return NextResponse.json({ message: resetResult.message });
  } catch (error) {
    console.error('[Reset Password] Error:', error);
    return NextResponse.json(
      { error: 'Failed to reset password' },
      { status: 500 }
    );
  }
}
