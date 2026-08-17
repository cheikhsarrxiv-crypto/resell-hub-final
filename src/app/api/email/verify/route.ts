import { NextRequest, NextResponse } from 'next/server';
import { EmailVerificationService } from '@/services/EmailVerificationService';

/**
 * POST /api/email/verify
 * Verify email with token
 *
 * Body:
 * {
 *   "token": "verification-token-from-email"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Verification token required' },
        { status: 400 }
      );
    }

    // Get user from query params or token payload
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 }
      );
    }

    // Verify email
    const result = await EmailVerificationService.verifyEmail(userId, token);

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: 'Email verified successfully',
      verified: result.userVerified,
    });
  } catch (error) {
    console.error('[Email Verify] Error:', error);
    return NextResponse.json(
      { error: 'Email verification failed' },
      { status: 500 }
    );
  }
}
