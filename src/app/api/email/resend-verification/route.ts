import { NextRequest, NextResponse } from 'next/server';
import { EmailVerificationService } from '@/services/EmailVerificationService';
import { rateLimiter } from '@/lib/ratelimit';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/email/resend-verification
 * Resend verification email
 *
 * Requires authentication
 * Rate limited: 3 per hour
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Rate limiting (3 per hour per user)
    const rateLimitResult = await rateLimiter.check(
      session.user.email,
      'api'
    );

    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: 'Too many resend attempts. Please try again later.',
          retryAfter: Math.ceil(
            (rateLimitResult.resetAt.getTime() - Date.now()) / 1000
          ),
        },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil(
              (rateLimitResult.resetAt.getTime() - Date.now()) / 1000
            ).toString(),
          },
        }
      );
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, emailVerified: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Check if already verified
    if (user.emailVerified) {
      return NextResponse.json(
        { message: 'Email already verified' },
        { status: 200 }
      );
    }

    // Resend verification email
    const result = await EmailVerificationService.resendVerificationEmail(
      user.id,
      session.user.email
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: 'Verification email sent',
      remaining: Math.max(0, rateLimitResult.remaining - 1),
    });
  } catch (error) {
    console.error('[Resend Verification] Error:', error);
    return NextResponse.json(
      { error: 'Failed to resend verification email' },
      { status: 500 }
    );
  }
}
