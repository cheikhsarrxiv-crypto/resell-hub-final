import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { EmailService } from './EmailService';

/**
 * Email Verification Service
 * Secure token-based email verification
 */

interface VerificationTokenResult {
  success: boolean;
  message: string;
  token?: string;
}

interface VerifyEmailResult {
  success: boolean;
  message: string;
  userVerified?: boolean;
}

export class EmailVerificationService {
  /**
   * Token expiration time (24 hours)
   */
  private static readonly TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

  /**
   * Generate secure verification token
   * Cryptographically secure random token
   */
  static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create verification email and token
   * Token stored in database with expiration
   */
  static async createVerificationToken(
    userId: string,
    email: string
  ): Promise<VerificationTokenResult> {
    try {
      // Generate token
      const token = this.generateToken();
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + this.TOKEN_EXPIRY_MS);

      // Store token in database
      await prisma.emailVerificationToken.upsert({
        where: { userId },
        update: {
          hashedToken,
          expiresAt,
          createdAt: new Date(),
        },
        create: {
          userId,
          hashedToken,
          expiresAt,
        },
      });

      console.log(`[EmailVerification] Token created for user: ${userId}`);

      // Send the verification email (does not fail token creation on send error —
      // the token is already persisted and can still be resent).
      const appUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const verificationUrl = `${appUrl}/verify-email?token=${token}&userId=${userId}`;
      const emailResult = await EmailService.sendVerificationEmail(email, verificationUrl);

      if (!emailResult.success) {
        console.error(
          `[EmailVerification] Failed to send verification email to ${email}:`,
          emailResult.error
        );
      }

      return {
        success: true,
        message: 'Verification token created',
        token, // Return unhashed token for email
      };
    } catch (error) {
      console.error('[EmailVerification] Token creation failed:', error);
      return {
        success: false,
        message: 'Failed to create verification token',
      };
    }
  }

  /**
   * Verify email using token
   * Token validated against hash + expiration
   */
  static async verifyEmail(
    userId: string,
    token: string
  ): Promise<VerifyEmailResult> {
    try {
      // Hash provided token
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      // Find and validate token
      const tokenRecord = await prisma.emailVerificationToken.findUnique({
        where: { userId },
      });

      if (!tokenRecord) {
        return {
          success: false,
          message: 'Verification token not found',
        };
      }

      // Check expiration
      if (new Date() > tokenRecord.expiresAt) {
        // Delete expired token
        await prisma.emailVerificationToken.delete({ where: { userId } });
        return {
          success: false,
          message: 'Verification token expired',
        };
      }

      // Check token hash (constant-time comparison)
      if (!this.timingSafeCompare(hashedToken, tokenRecord.hashedToken)) {
        return {
          success: false,
          message: 'Invalid verification token',
        };
      }

      // Mark user as verified
      await prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      });

      // Delete token
      await prisma.emailVerificationToken.delete({ where: { userId } });

      console.log(`[EmailVerification] Email verified for user: ${userId}`);

      return {
        success: true,
        message: 'Email verified successfully',
        userVerified: true,
      };
    } catch (error) {
      console.error('[EmailVerification] Verification failed:', error);
      return {
        success: false,
        message: 'Email verification failed',
      };
    }
  }

  /**
   * Check if user email is verified
   */
  static async isEmailVerified(userId: string): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { emailVerified: true },
      });
      return user?.emailVerified ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Resend verification email with rate limiting
   * Max 3 resends per hour per user
   */
  static async resendVerificationEmail(
    userId: string,
    email: string
  ): Promise<VerificationTokenResult> {
    try {
      // Rate limit check (max 3 per hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentAttempts = await prisma.emailVerificationToken.findFirst({
        where: {
          userId,
          createdAt: { gte: oneHourAgo },
        },
      });

      // Count how many tokens were created in last hour
      const tokenCount = await prisma.emailVerificationToken.count({
        where: {
          userId,
          createdAt: { gte: oneHourAgo },
        },
      });

      if (tokenCount >= 3) {
        console.warn(
          `[EmailVerification] Rate limit exceeded for user: ${userId}`
        );
        return {
          success: false,
          message: 'Too many verification attempts. Please try again later.',
        };
      }

      // Create new token
      return this.createVerificationToken(userId, email);
    } catch (error) {
      console.error('[EmailVerification] Resend failed:', error);
      return {
        success: false,
        message: 'Failed to resend verification email',
      };
    }
  }

  /**
   * Get remaining time until token expires
   */
  static async getTokenExpiryTime(userId: string): Promise<number | null> {
    try {
      const token = await prisma.emailVerificationToken.findUnique({
        where: { userId },
      });

      if (!token) {
        return null;
      }

      const remaining = token.expiresAt.getTime() - Date.now();
      return remaining > 0 ? remaining : null;
    } catch {
      return null;
    }
  }

  /**
   * Timing-safe string comparison
   * Prevents timing attacks
   */
  private static timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Delete token manually (e.g., on signup failure)
   */
  static async deleteToken(userId: string): Promise<void> {
    try {
      await prisma.emailVerificationToken.delete({ where: { userId } });
    } catch {
      // Token doesn't exist, ignore
    }
  }
}
